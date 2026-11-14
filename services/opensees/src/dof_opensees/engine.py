"""Analyse one ``StructuralModel`` request with OpenSees.

Orchestration only (see ``DESIGN.md``): ``model.prepare`` validates and
normalises the request and splits it into components; each component is
built (``builder``), classified at its reference state (``tangent`` +
``stability``), solved at linear fidelity here or handed to the nonlinear
driver (``nonlinear.solve``), verified, and read; ``results`` assembles the
contract body.

OpenSees holds one global model per process, so the whole request runs under
a lock and each component is built, analysed and read before the next one.
Run several worker processes to analyse requests concurrently.

No exception escapes :func:`analyze` for a schema-valid model: preparation
problems become ``error`` or ``unsupported`` results, an unexpected failure
inside a component makes that component ``unknown`` (with a warning), and
anything else becomes an ``error`` result.
"""

from __future__ import annotations

import math
import threading
import time
from dataclasses import dataclass

import numpy as np
import openseespy.opensees as ops

from . import __version__, builder, nonlinear, stability, tangent
from .model import ALIGNED, Component, Limits, PreparationError, PreparedModel, free_dofs, prepare, static_counts
from .results import (
    MARGINAL,
    STABLE,
    UNKNOWN,
    UNSTABLE,
    ComponentOutcome,
    Mode,
    StabilityData,
    assemble,
)
from .schema import StructuralModel

__all__ = ["Limits", "NONLINEAR_SEGMENTS", "analyze", "opensees_version", "solver_name"]

NONLINEAR_SEGMENTS = builder.NONLINEAR_SEGMENTS
#: Normalised global equilibrium residual above which results are rejected (criteria section 7).
EQUILIBRIUM_TOLERANCE = 1e-5
#: Largest displacement of an accepted recovered equilibrium, as a multiple of
#: the shortest member of the component. Provisional (DESIGN.md).
RECOVERY_DISPLACEMENT_LIMIT = 0.1
#: Mode-shape entries smaller than this, relative to the peak, are dropped.
MODE_PARTICIPATION = 1e-6
#: A null vector is a rigid motion when a rigid-body fit leaves this relative residual.
RIGID_FIT_TOLERANCE = 1e-6
#: A cable whose tension is at most this strain times EA is slack.
SLACK_STRAIN = 1e-12
#: A cable compressed by more than this strain violates its law.
CABLE_COMPRESSION_STRAIN = 1e-9
#: Convergence of the linear-fidelity iterations that settle cable states.
LINEAR_ITERATIONS = 100
LINEAR_DISPLACEMENT_TOLERANCE = 1e-12

_LOCK = threading.Lock()


def opensees_version() -> str:
    return str(ops.version())


def solver_name() -> str:
    return f"OpenSees {opensees_version()} / dof-opensees {__version__}"


def analyze(model: StructuralModel, limits: Limits = Limits()) -> dict:
    """Analyse a model and return an ``AnalysisResult`` as a JSON-ready dict."""
    started = time.perf_counter()
    try:
        prepared = prepare(model, limits)
    except PreparationError as error:
        return {"status": error.status, "message": error.message}
    except Exception as error:  # noqa: BLE001 - nothing may escape analyze
        return {"status": "error", "message": f"Internal error while preparing the model: {error}"}

    budget = _Budget(started, prepared.timeout_ms / 1000.0)
    warnings = list(prepared.warnings)
    try:
        with _LOCK:
            try:
                outcomes = [_guarded(prepared, component, budget, warnings) for component in prepared.components]
            finally:
                ops.wipe()
        return assemble(
            outcomes,
            fidelity=prepared.fidelity,
            solver=solver_name(),
            runtime_ms=(time.perf_counter() - started) * 1000.0,
            model_version=model.version,
            warnings=warnings,
            max_modes=limits.max_modes,
        )
    except Exception as error:  # noqa: BLE001
        return {"status": "error", "message": f"Internal error during analysis: {error}"}


# --- per component ------------------------------------------------------------


@dataclass(frozen=True)
class _Budget:
    """The request's time budget.

    Elapsed time is measured with ``perf_counter``: on Windows
    ``time.monotonic`` advances in steps of about 16 ms, too coarse to judge a
    budget of a few milliseconds. The driver's interface takes a monotonic
    deadline, so the remaining time is converted when it is handed over.
    """

    started: float
    seconds: float

    def remaining(self) -> float:
        return self.seconds - (time.perf_counter() - self.started)

    def expired(self) -> bool:
        return self.remaining() <= 0.0

    def deadline(self) -> float:
        return time.monotonic() + self.remaining()


@dataclass
class _Counts:
    """Mesh-independent bookkeeping for the stability report."""

    unknowns: int
    equations: int
    linear_free_dofs: int

    def indeterminacy(self, mechanisms: int) -> int:
        return self.unknowns - self.equations + mechanisms


def _guarded(prepared: PreparedModel, component: Component, budget: _Budget, warnings: list[str]) -> ComponentOutcome:
    counts = _Counts(*static_counts(prepared, component), free_dofs(prepared, component))
    try:
        return _analyse(prepared, component, budget, warnings, counts)
    except Exception as error:  # noqa: BLE001 - becomes `unknown` for this component only
        warnings.append(
            f"Component '{component.id}': internal failure ({type(error).__name__}: {error}); "
            "no conclusion was reached."
        )
        return _unknown(component, counts, [])


def _unknown(component: Component, counts: _Counts, codes: list[str], load_factor: float | None = None,
             residual: float | None = None, free: int | None = None) -> ComponentOutcome:
    data = StabilityData(
        stable=False,
        free_dofs=counts.linear_free_dofs if free is None else free,
        static_indeterminacy=counts.indeterminacy(0),
    )
    return ComponentOutcome(component, UNKNOWN, codes, data, load_factor=load_factor, residual=residual)


def _analyse(prepared: PreparedModel, component: Component, budget: _Budget, warnings: list[str],
             counts: _Counts) -> ComponentOutcome:
    if budget.expired():
        return _unknown(component, counts, ["timeout"], load_factor=0.0)
    if prepared.fidelity == "nonlinear":
        for member_id in component.member_ids:
            member = prepared.members[member_id]
            if any(end.representation == ALIGNED for end in member.ends):
                warnings.append(
                    f"Member '{member_id}': a connection is modelled with constraints on global axes, "
                    "which is exact only for small rotations of the joint."
                )
        return _analyse_nonlinear(prepared, component, budget, counts)
    return _analyse_linear(prepared, component, counts)


def _analyse_linear(prepared: PreparedModel, component: Component, counts: _Counts) -> ComponentOutcome:
    domain = builder.build(prepared, component, builder.LINEAR, 1)
    if domain.free_dofs == 0:
        return _fully_restrained(prepared, component, domain, counts)

    reference, equations = _assess(domain)
    if not reference.positive_definite:
        return _instability(prepared, component, domain, equations, reference, counts, load_factor=0.0)
    codes = ["near_mechanism"] if reference.near_mechanism else []

    has_cables = any(prepared.members[m].kind == "cable" for m in component.member_ids)
    if not _solve_linear(has_cables):
        return _unknown(component, counts, ["not_converged"], load_factor=0.0, free=reference.free_dofs)
    state = _read(prepared, component, domain, deformed=False)

    if has_cables:
        # Slack cables have left the tangent: the final state may be a mechanism.
        final, equations = _assess(domain)
        if not final.positive_definite:
            return _instability(prepared, component, domain, equations, final, counts, load_factor=1.0)
        if final.near_mechanism:
            codes.append("near_mechanism")
    return _finish(prepared, component, state, codes, counts, reference.free_dofs, load_factor=1.0)


def _assess(domain: builder.Domain) -> tuple[stability.Assessment, builder.Equations]:
    matrix = tangent.extract_tangent()
    equations = builder.read_equations(domain, matrix.shape[0])
    return stability.assess(matrix, equations.translation_mask(), equations.load_vector(domain.loads)), equations


def _solve_linear(has_cables: bool) -> bool:
    """One small-displacement solve. Cables are tension-only, so it iterates on their states."""
    ops.wipeAnalysis()
    ops.system("BandGeneral")
    ops.numberer("RCM")
    ops.constraints("Transformation")
    if has_cables:
        ops.test("NormDispIncr", LINEAR_DISPLACEMENT_TOLERANCE, LINEAR_ITERATIONS)
        ops.algorithm("Newton")
    else:
        ops.algorithm("Linear")
    ops.integrator("LoadControl", 1.0)
    ops.analysis("Static")
    if ops.analyze(1) != 0:
        return False
    ops.reactions()
    return True


class ComponentProblem:
    """A component as the nonlinear driver sees it (``nonlinear.Problem``)."""

    def __init__(self, prepared: PreparedModel, component: Component) -> None:
        self.prepared = prepared
        self.component = component
        self.temp_tag_base = builder.tag_bound(prepared, component, builder.NONLINEAR_SEGMENTS)
        lengths = [prepared.members[member_id].length for member_id in component.member_ids]
        self.recovery_displacement_limit = RECOVERY_DISPLACEMENT_LIMIT * min(lengths) if lengths else 0.0
        self.domain: builder.Domain | None = None
        self._equations: builder.Equations | None = None

    def build(self) -> None:
        self.domain = builder.build(self.prepared, self.component, builder.COROTATIONAL, builder.NONLINEAR_SEGMENTS)
        self._equations = None

    def assess(self) -> stability.Assessment:
        if self.domain.free_dofs == 0:
            # OpenSees crashes the process when asked to analyse an empty system.
            self._equations = builder.Equations(0, {tag: [-1] * 6 for tag in self.domain.nodes}, [])
            return stability.assess(np.zeros((0, 0)), np.zeros(0, dtype=bool), np.zeros(0))
        result, self._equations = _assess(self.domain)
        return result

    def equation_dofs(self) -> list[tuple[int, int]]:
        return list(self._equations.owners) if self._equations else []

    def peak_displacement(self) -> float:
        return max((float(np.linalg.norm(ops.nodeDisp(tag)[:3])) for tag in self.domain.nodes), default=0.0)


def _analyse_nonlinear(prepared: PreparedModel, component: Component, budget: _Budget,
                       counts: _Counts) -> ComponentOutcome:
    problem = ComponentProblem(prepared, component)
    problem.build()
    if problem.domain.free_dofs == 0:
        return _fully_restrained(prepared, component, problem.domain, counts)

    outcome = nonlinear.solve(problem, budget.deadline(), nonlinear.Settings())
    domain = problem.domain
    assessment = outcome.assessment
    equations = builder.equations_from_owners(domain, outcome.equation_dofs) if assessment is not None else None
    codes = [code for code in outcome.reason_codes]

    if outcome.state == "stable":
        if assessment is not None and assessment.near_mechanism:
            codes.append("near_mechanism")
        state = _read(prepared, component, domain, deformed=True)
        free = assessment.free_dofs if assessment is not None else domain.free_dofs
        return _finish(prepared, component, state, codes, counts, free, load_factor=1.0)
    if outcome.state == "unstable" and assessment is not None and not assessment.positive_definite:
        return _instability(prepared, component, domain, equations, assessment, counts,
                            load_factor=outcome.load_factor, extra_codes=codes)
    free = assessment.free_dofs if assessment is not None else domain.free_dofs
    if outcome.state == "unstable":
        # Verified by the driver but without a matrix to show: report the verdict alone.
        data = StabilityData(stable=False, free_dofs=free, static_indeterminacy=counts.indeterminacy(0))
        return ComponentOutcome(component, UNSTABLE, codes, data, load_factor=outcome.load_factor)
    return _unknown(component, counts, codes, load_factor=outcome.load_factor, free=free)


# --- instability --------------------------------------------------------------


def _instability(prepared: PreparedModel, component: Component, domain: builder.Domain,
                 equations: builder.Equations, assessment: stability.Assessment, counts: _Counts,
                 load_factor: float, extra_codes: list[str] | None = None) -> ComponentOutcome:
    codes = list(extra_codes or [])
    shapes = (
        [(vector, "translation") for vector in assessment.translational_modes]
        + [(vector, "rotation") for vector in assessment.rotational_modes]
        + [(vector, _kind(vector, equations)) for vector in assessment.negative_modes]
    )
    modes, participants = [], set()
    for vector, kind in shapes:
        mode, nodes = _mode(vector, kind, equations, domain, component)
        modes.append(mode)
        participants |= nodes
    if assessment.mechanisms:
        codes.append(_mechanism_reason(prepared, component, domain, equations, assessment))
    elif assessment.negative_modes and "load_induced_instability" not in codes:
        codes.append("load_induced_instability")
    data = StabilityData(
        stable=False,
        free_dofs=assessment.free_dofs,
        translational=len(assessment.translational_modes),
        rotational=len(assessment.rotational_modes),
        static_indeterminacy=counts.indeterminacy(assessment.mechanisms),
        unstable_node_ids=[node_id for node_id in component.node_ids if node_id in participants],
        modes=modes,
    )
    return ComponentOutcome(component, UNSTABLE, codes, data, load_factor=load_factor)


def _kind(vector: np.ndarray, equations: builder.Equations) -> str:
    mask = equations.translation_mask()
    peak = float(np.max(np.abs(vector))) if vector.size else 0.0
    moves = mask.any() and float(np.max(np.abs(vector[mask]))) > stability.ROTATION_ONLY * peak
    return "translation" if moves else "rotation"


def _mode(vector: np.ndarray, kind: str, equations: builder.Equations, domain: builder.Domain,
          component: Component) -> tuple[Mode, set[str]]:
    """Mode shape per contract node, scaled so the largest node value is 1.

    Member nodes (duplicates, unattached ends, segment nodes) are not contract
    nodes, so they are not shown, but a joint whose member end moves takes part.
    """
    rows = slice(0, 3) if kind == "translation" else slice(3, 6)

    def values(tag: int) -> np.ndarray:
        return np.array([vector[eq] if eq >= 0 else 0.0 for eq in equations.of_node[tag]])

    joints = {node_id: values(tag) for node_id, tag in domain.joint_tags.items()}
    peak = max((float(np.linalg.norm(v[rows])) for v in joints.values()), default=0.0)
    if peak == 0.0:
        peak = float(np.max(np.abs(vector))) or 1.0
    shape = {
        node_id: [float(x) / peak for x in v]
        for node_id, v in joints.items()
        if float(np.max(np.abs(v))) > MODE_PARTICIPATION * peak
    }
    participants = set(shape)
    largest = float(np.max(np.abs(vector))) if vector.size else 0.0
    for node in domain.nodes.values():
        if node.at_joint in domain.joint_tags and float(np.max(np.abs(values(node.tag)))) > MODE_PARTICIPATION * largest:
            participants.add(node.at_joint)
    ordered_shape = {node_id: shape[node_id] for node_id in component.node_ids if node_id in shape}
    return Mode(kind, ordered_shape), participants


def _mechanism_reason(prepared: PreparedModel, component: Component, domain: builder.Domain,
                      equations: builder.Equations, assessment: stability.Assessment) -> str:
    if not any(prepared.joints[node_id].supported for node_id in component.node_ids):
        return "unsupported_component"
    restrained = [
        (domain.joint_tags[node_id], dof + 1)
        for node_id in component.node_ids
        for dof in range(6)
        if prepared.joints[node_id].restrained[dof]
    ]
    vectors = assessment.translational_modes + assessment.rotational_modes
    if all(_is_rigid_motion(vector, equations, domain, restrained) for vector in vectors):
        return "rigid_body_mechanism"
    return "internal_mechanism"


def _is_rigid_motion(vector: np.ndarray, equations: builder.Equations, domain: builder.Domain,
                     restrained: list[tuple[int, int]]) -> bool:
    """Whether the mode is u = a + w x r, theta = w over the whole component.

    Every DOF in the system takes part, and so do the support-restrained DOFs,
    with value zero: a rigid motion the supports allow must leave them still.
    Removed (irrelevant) rotations take no part, since they mean nothing.
    """
    centre = np.mean([node.position for node in domain.nodes.values()], axis=0)
    dofs = list(equations.owners) + restrained
    values = np.concatenate([vector, np.zeros(len(restrained))])
    rows = np.zeros((len(dofs), 6))
    for row, (tag, dof) in enumerate(dofs):
        r = domain.nodes[tag].position - centre
        rows[row, dof - 1] = 1.0
        if dof <= 3:
            # Coefficients of w in (w x r) along this axis.
            rows[row, 3:] = ((0.0, r[2], -r[1]), (-r[2], 0.0, r[0]), (r[1], -r[0], 0.0))[dof - 1]
    solution, *_ = np.linalg.lstsq(rows, values, rcond=None)
    residual = float(np.linalg.norm(rows @ solution - values))
    return residual <= RIGID_FIT_TOLERANCE * float(np.linalg.norm(values))


# --- results ------------------------------------------------------------------


@dataclass
class _State:
    """Results read from the domain, keyed by contract ids."""

    displacements: dict[str, np.ndarray]
    reactions: dict[str, np.ndarray]
    forces: dict[str, dict]
    #: Node tag -> position used for moments (deformed under nonlinear fidelity).
    positions: dict[int, np.ndarray]
    loads: dict[int, np.ndarray]
    joint_tags: dict[str, int]
    slack: list[str]
    #: Cables whose force is compressive beyond rounding.
    violations: list[str]
    #: Largest member force and moment magnitudes, floors for the equilibrium scales.
    force_scale: float
    moment_scale: float = 0.0


def _read(prepared: PreparedModel, component: Component, domain: builder.Domain, deformed: bool) -> _State:
    ops.reactions()
    displacement = {tag: np.array(ops.nodeDisp(tag), dtype=float) for tag in domain.nodes}
    raw = {tag: np.array(ops.nodeReaction(tag), dtype=float) for tag in domain.nodes}
    reactions = {}
    for node_id, tag in domain.joint_tags.items():
        joint = prepared.joints[node_id]
        if not joint.supported:
            continue
        reaction = raw[tag].copy()
        # Forces delivered through a duplicate node are reported on the duplicate.
        for duplicate in domain.duplicates_of(tag):
            for dof in duplicate.tied:
                reaction[dof - 1] += raw[duplicate.tag][dof - 1]
        reactions[node_id] = np.where(joint.restrained, reaction, 0.0)

    forces, slack, violations, scale, moment_scale = {}, [], [], 0.0, 0.0
    for member_id in component.member_ids:
        member = prepared.members[member_id]
        built = domain.members[member_id]
        if member.axial:
            axial = float(ops.basicForce(built.elements[0])[0])
            entry = _forces(axial=axial)
            if member.kind == "cable":
                stiffness = member.properties.elastic_modulus * member.properties.area
                if axial < -CABLE_COMPRESSION_STRAIN * stiffness:
                    violations.append(member_id)
                if axial <= SLACK_STRAIN * stiffness:
                    entry.update(axial=0.0, state="slack")
                    slack.append(member_id)
                else:
                    entry["state"] = "active"
        else:
            entry = _beam_forces(built.elements)
        forces[member_id] = entry
        scale = max(scale, abs(entry["axial"]), entry["shear"])
        moment_scale = max(moment_scale, entry["torsion"], entry["momentStart"], entry["momentEnd"])

    positions = {
        tag: node.position + (displacement[tag][:3] if deformed else 0.0) for tag, node in domain.nodes.items()
    }
    return _State(
        displacements={node_id: displacement[tag] for node_id, tag in domain.joint_tags.items()},
        reactions=reactions,
        forces=forces,
        positions=positions,
        loads=domain.loads,
        joint_tags=domain.joint_tags,
        slack=slack,
        violations=violations,
        force_scale=scale,
        moment_scale=moment_scale,
    )


def _forces(axial: float = 0.0) -> dict:
    return {"axial": axial, "shear": 0.0, "torsion": 0.0, "momentStart": 0.0, "momentEnd": 0.0}


def _beam_forces(elements: list[int]) -> dict:
    """Per contract member: signed axial largest in magnitude, largest shear and torsion, end moments.

    ``localForce`` is [N, Vy, Vz, T, My, Mz] at the start then the end, as
    forces on the element; the end-node N is the axial force, tension positive.
    """
    responses = [np.array(ops.eleResponse(tag, "localForce"), dtype=float) for tag in elements]
    axial = max((f[6] for f in responses), key=abs)
    return {
        "axial": float(axial),
        "shear": float(max(max(math.hypot(f[1], f[2]), math.hypot(f[7], f[8])) for f in responses)),
        "torsion": float(max(max(abs(f[3]), abs(f[9])) for f in responses)),
        "momentStart": float(math.hypot(responses[0][4], responses[0][5])),
        "momentEnd": float(math.hypot(responses[-1][10], responses[-1][11])),
    }


def _fully_restrained(prepared: PreparedModel, component: Component, domain: builder.Domain,
                      counts: _Counts) -> ComponentOutcome:
    """A component with no free DOF: nothing moves, so statics alone gives the answer.

    OpenSees cannot analyse an empty system. Members do not deform, so beams
    and springs carry nothing and axial members carry only their initial
    strain; each support reacts its own load and those member forces.
    """
    owner = {tag: node.joint_id or _joint_of(domain, node) for tag, node in domain.nodes.items()}
    totals = {node_id: np.zeros(6) for node_id in component.node_ids}
    for tag, load in domain.loads.items():
        totals[owner[tag]] += load
    forces, slack = {}, []
    for member_id in component.member_ids:
        member = prepared.members[member_id]
        axial = 0.0
        if member.axial:
            axial = member.properties.elastic_modulus * member.properties.area * member.initial_strain
            if member.kind == "cable":
                axial = max(axial, 0.0)
            pull = np.zeros(6)
            pull[:3] = axial * member.axes[0]
            # Tension pulls the start node towards the end and the end node back.
            built = domain.members[member_id]
            totals[owner[built.nodes[0]]] += pull
            totals[owner[built.nodes[-1]]] -= pull
        entry = _forces(axial=axial)
        if member.kind == "cable":
            entry["state"] = "active" if axial > 0.0 else "slack"
            if axial <= 0.0:
                slack.append(member_id)
        forces[member_id] = entry
    reactions = {
        node_id: np.where(prepared.joints[node_id].restrained, -totals[node_id], 0.0)
        for node_id in component.node_ids
        if prepared.joints[node_id].supported
    }
    state = _State(
        displacements={node_id: np.zeros(6) for node_id in component.node_ids},
        reactions=reactions,
        forces=forces,
        positions={tag: node.position for tag, node in domain.nodes.items()},
        loads=domain.loads,
        joint_tags=domain.joint_tags,
        slack=slack,
        violations=[],
        force_scale=max((abs(f["axial"]) for f in forces.values()), default=0.0),
    )
    return _finish(prepared, component, state, [], counts, 0, load_factor=1.0)


def _joint_of(domain: builder.Domain, node: builder.Node) -> str:
    for joint_id, tag in domain.joint_tags.items():
        if tag == node.retained:
            return joint_id
    raise RuntimeError(f"Node {node.tag} belongs to no joint.")


def _finish(prepared: PreparedModel, component: Component, state: _State, codes: list[str], counts: _Counts,
            free: int, load_factor: float) -> ComponentOutcome:
    """Verify a solved state (DESIGN.md, Verification) and turn it into results."""
    data = StabilityData(stable=True, free_dofs=free, static_indeterminacy=counts.indeterminacy(0))
    numbers = [state.displacements.values(), state.reactions.values()]
    finite = all(np.all(np.isfinite(v)) for group in numbers for v in group) and all(
        math.isfinite(value) for entry in state.forces.values() for value in entry.values() if not isinstance(value, str)
    )
    if not finite:
        data.stable = False
        return ComponentOutcome(component, UNKNOWN, codes + ["non_finite_result"], data, load_factor=load_factor)

    residual = _equilibrium_residual(state)
    if residual > EQUILIBRIUM_TOLERANCE or state.violations:
        data.stable = False
        return ComponentOutcome(component, UNKNOWN, codes + ["equilibrium_not_verified"], data,
                                load_factor=load_factor, residual=residual)

    if state.slack:
        codes.append("cable_slack")
    limit = prepared.displacement_limit
    if limit is not None and any(np.linalg.norm(v[:3]) > limit for v in state.displacements.values()):
        codes.append("excessive_deformation")
    marginal = "near_mechanism" in codes or "excessive_deformation" in codes
    return ComponentOutcome(
        component,
        MARGINAL if marginal else STABLE,
        codes,
        data,
        load_factor=load_factor,
        residual=residual,
        displacements={k: [float(x) for x in v] for k, v in state.displacements.items()},
        reactions={k: [float(x) for x in v] for k, v in state.reactions.items()},
        member_forces=state.forces,
    )


def _equilibrium_residual(state: _State) -> float:
    """Applied loads plus reactions, normalised (DESIGN.md, Verification).

    Moments are taken about the centroid of the component's nodes rather than
    the global origin: the check is the same when forces balance, but a
    component far from the origin would otherwise inflate a tiny force
    residual into a large moment residual.

    Scales: forces against the largest of the total applied force, the total
    reaction force, the largest member force and the moment scale divided by
    the component size; moments against the largest of the force scale times
    the size, the total applied and reacted moments and the largest member
    moment. So a component loaded only by a torque, or a self-equilibrated
    prestressed one, is judged against its own force level rather than
    against rounding noise.
    """
    positions = state.positions
    centre = np.mean(list(positions.values()), axis=0) if positions else np.zeros(3)
    force, moment = np.zeros(3), np.zeros(3)
    applied_force = applied_moment = reacted_force = reacted_moment = 0.0
    for tag, load in state.loads.items():
        arm = positions[tag] - centre
        force += load[:3]
        moment += np.cross(arm, load[:3]) + load[3:]
        applied_force += float(np.linalg.norm(load[:3]))
        applied_moment += float(np.linalg.norm(load[3:]))
    for node_id, reaction in state.reactions.items():
        arm = positions[state.joint_tags[node_id]] - centre
        force += reaction[:3]
        moment += np.cross(arm, reaction[:3]) + reaction[3:]
        reacted_force += float(np.linalg.norm(reaction[:3]))
        reacted_moment += float(np.linalg.norm(reaction[3:]))
    extent = np.ptp(np.array(list(positions.values())), axis=0) if positions else np.zeros(3)
    size = float(np.linalg.norm(extent)) or 1.0
    raw_moment_scale = max(applied_moment, reacted_moment, state.moment_scale)
    force_scale = max(applied_force, reacted_force, state.force_scale, raw_moment_scale / size)
    moment_scale = max(force_scale * size, raw_moment_scale)
    residuals = []
    for value, scale in ((np.linalg.norm(force), force_scale), (np.linalg.norm(moment), moment_scale)):
        if scale > 0.0:
            residuals.append(float(value) / scale)
        else:
            residuals.append(0.0 if value == 0.0 else math.inf)
    return max(residuals)
