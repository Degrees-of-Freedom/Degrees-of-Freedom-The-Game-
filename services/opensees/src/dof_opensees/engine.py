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
from .model import (
    ALIGNED,
    FREE,
    RELEASE,
    Component,
    Limits,
    PreparationError,
    PreparedModel,
    free_dofs,
    prepare,
    static_counts,
)
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

__all__ = ["Limits", "analyze", "opensees_version", "solver_name"]

#: Largest system for which the buckling shape is read with a dense tangent at a
#: loaded state; above it the instability is reported without its shape.
DENSE_SHAPE_LIMIT = 1500
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
    #: Mechanism count of the reference classification, once it has completed.
    reference_mechanisms: int | None = None

    def indeterminacy(self) -> int:
        """Static indeterminacy from the reference classification.

        Always the reference mechanism count, whatever the final state: the
        count is a property of the structure, not of the load. 0 when the
        reference classification did not complete (for example a timeout
        before it), since there is no count to use; such components are
        never ``stable``. Never negative: under nonlinear fidelity the
        reference tangent includes pretension, which can stiffen a kinematic
        mechanism the force-unknown count does not see, and the true
        redundancy is then still at least zero.
        """
        if self.reference_mechanisms is None:
            return 0
        return max(0, self.unknowns - self.equations + self.reference_mechanisms)


def _guarded(prepared: PreparedModel, component: Component, budget: _Budget, warnings: list[str]) -> ComponentOutcome:
    counts = _Counts(*static_counts(prepared, component), free_dofs(prepared, component))
    try:
        return _analyse(prepared, component, budget, warnings, counts)
    except Exception as error:  # noqa: BLE001 - becomes `unknown` for this component only
        warnings.append(
            f"Component '{component.id}': internal failure ({type(error).__name__}: {error}); "
            "no conclusion was reached."
        )
        return _unknown(component, counts, ["solver_error"])


def _unknown(component: Component, counts: _Counts, codes: list[str], load_factor: float | None = None,
             residual: float | None = None, free: int | None = None) -> ComponentOutcome:
    data = StabilityData(
        stable=False,
        free_dofs=counts.linear_free_dofs if free is None else free,
        static_indeterminacy=counts.indeterminacy(),
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
        return _analyse_nonlinear(prepared, component, budget, counts, warnings)
    return _analyse_linear(prepared, component, counts)


def _analyse_linear(prepared: PreparedModel, component: Component, counts: _Counts) -> ComponentOutcome:
    domain = builder.build(prepared, component, builder.LINEAR)
    if domain.free_dofs == 0:
        counts.reference_mechanisms = 0
        return _fully_restrained(prepared, component, domain, counts)

    reference, equations = _assess(domain)
    counts.reference_mechanisms = reference.mechanisms
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
    """A component as the nonlinear driver sees it (``nonlinear.Problem``).

    Two-tier stability assessment, so a finely subdivided model never needs
    a dense tangent read on the load path:

    * At the reference state (load factor 0) the tangent is classified with
      the dense spectrum, on a coarse corotational build with one element per
      beam. Mechanisms are kinematic and do not depend on subdivision, and the
      initial strains are present so pretension stiffening counts. The coarse
      build has the same joint, duplicate and end node tags as the fine one,
      so the equations reported with it place recovery springs on the right
      nodes of the fine domain. Computed once and cached.
    * At loaded states a banded Cholesky step (``tangent.is_positive_definite``)
      decides. When it fails for the first time, and the system is small
      enough, the dense tangent is read once for the buckling shape; otherwise
      the assessment is only flagged ``indefinite``.
    """

    def __init__(self, prepared: PreparedModel, component: Component, segments: dict[str, int],
                 reference: tuple[stability.Assessment, list[tuple[int, int]]] | None = None) -> None:
        self.prepared = prepared
        self.component = component
        self.segments = segments
        self.temp_tag_base = builder.tag_bound(prepared, component, segments)
        lengths = [prepared.members[member_id].length for member_id in component.member_ids]
        self.recovery_displacement_limit = RECOVERY_DISPLACEMENT_LIMIT * min(lengths) if lengths else 0.0
        self.domain: builder.Domain | None = None
        self.reference: stability.Assessment | None = reference[0] if reference else None
        self.warnings: list[str] = []
        self._reference_owners: list[tuple[int, int]] = list(reference[1]) if reference else []
        self._owners: list[tuple[int, int]] = []
        self._shape_read = False
        #: (compression, chord-relative end rotation) per beam after a stable solve.
        self.demand: dict[str, tuple[float, float]] = {}

    def build(self) -> None:
        self.domain = builder.build(self.prepared, self.component, builder.COROTATIONAL, self.segments)
        self._owners = []

    def assess(self) -> stability.Assessment:
        size = self.domain.free_dofs
        if size == 0:
            # OpenSees crashes the process when asked to analyse an empty system.
            self._owners = []
            return stability.Assessment(free_dofs=0)
        if ops.getTime() == 0.0:
            return self._reference_assessment()
        self._owners = []
        if tangent.is_positive_definite():
            return stability.Assessment(free_dofs=size)
        if not self._shape_read:
            self._shape_read = True
            if size <= DENSE_SHAPE_LIMIT:
                assessment, equations = _assess(self.domain)
                self._owners = list(equations.owners)
                return assessment
            self.warnings.append(
                f"Component '{self.component.id}': the instability shape was not computed because the system "
                f"has {size} equations (limit {DENSE_SHAPE_LIMIT})."
            )
        return stability.Assessment(free_dofs=size, indefinite=True)

    def _reference_assessment(self) -> stability.Assessment:
        if self.reference is None:
            self.reference, self._reference_owners = _coarse_reference(self.prepared, self.component)
            self.build()  # Back to the fine domain, at its reference state.
        self._owners = list(self._reference_owners)
        return self.reference

    def equation_dofs(self) -> list[tuple[int, int]]:
        return list(self._owners)

    def peak_displacement(self) -> float:
        return max((float(np.linalg.norm(ops.nodeDisp(tag)[:3])) for tag in self.domain.nodes), default=0.0)


def _coarse_reference(prepared: PreparedModel,
                      component: Component) -> tuple[stability.Assessment, list[tuple[int, int]]]:
    """Dense classification of the coarse corotational build at its reference state."""
    coarse = builder.build(prepared, component, builder.COROTATIONAL)
    if coarse.free_dofs == 0:
        return stability.Assessment(free_dofs=0), []
    assessment, equations = _assess(coarse)
    return assessment, list(equations.owners)


def _preview_segments(prepared: PreparedModel, component: Component,
                      reference: stability.Assessment) -> dict[str, int]:
    """Elements per beam from the linear solve of the component.

    The linear solve is the cheap preview anyway; its axial forces at full
    load size the subdivision (``builder.required_segments``). Without a
    preview (a mechanism in the coarse reference, or a failed solve) every
    beam gets ``builder.FALLBACK_SEGMENTS``.

    The preview reads no tangent of its own: the coarse corotational
    reference already classified the component, and a second dense read
    would double the cost of a large component. The linear system can still
    be singular where only pretension stiffens it; then the solve fails or
    gives meaningless forces, which at worst over-subdivide (counts are
    clamped), and non-finite forces fall back.
    """
    beams = [prepared.members[m] for m in component.member_ids if not prepared.members[m].axial]
    fallback = {member.id: builder.FALLBACK_SEGMENTS for member in beams}
    if not reference.positive_definite:
        return fallback
    domain = builder.build(prepared, component, builder.LINEAR)
    if domain.free_dofs == 0:
        return {member.id: 1 for member in beams}
    has_cables = any(prepared.members[m].kind == "cable" for m in component.member_ids)
    if not _solve_linear(has_cables):
        return fallback
    demand = _demand(domain, beams)
    if not all(math.isfinite(value) for pair in demand.values() for value in pair):
        return fallback
    return {member.id: builder.required_segments(member, *demand[member.id]) for member in beams}


def _demand(domain: builder.Domain, beams: list) -> dict[str, tuple[float, float]]:
    """(largest compressive axial force, largest end rotation relative to the chord) per beam.

    The compression is positive N from the end-node axial force of each
    element (``localForce`` index 6, tension positive).
    """
    result = {}
    for member in beams:
        built = domain.members[member.id]
        forces = [float(ops.eleResponse(tag, "localForce")[6]) for tag in built.elements]
        finite = domain.geometry == builder.COROTATIONAL
        result[member.id] = (max(0.0, -min(forces)), _chord_rotation(member, built, finite))
    return result


def _chord_rotation(member, built: builder.BuiltMember, finite: bool) -> float:
    """Largest bending rotation of either member end relative to the member's chord, in radians.

    From the nodal displacements of the member's own end nodes (the first and
    last node along it, which carry the member end's rotation for every
    representation except a moment release):

    1. The chord rotation omega. With x the original member axis and
       du = u_end - u_start (translations):
       - linear preview (``finite`` false): the small-rotation value
         omega = x cross du / L, consistent with the small-rotation nodal
         rotations of a linear solve (a finite formula applied to a large
         linear displacement would understate it: atan(2/3) instead of 2/3);
       - corotational result (``finite`` true): the rotation taking x to the
         deformed chord d = L x + du,
         omega = (x cross d^) / |x cross d^| * atan2(|x cross d^|, x . d^).
    2. At each end, the relative rotation is the nodal rotation minus omega,
       with its component about the chord (twist, which does not bend the
       member) removed.
    3. At a moment-release end the element sits on the joint node, whose
       rotation about a released axis has nothing to do with the member, so
       the components about the released local axes are removed as well.
    4. The result is the larger magnitude of the two ends.

    Subtracting rotation vectors is exact for small rotations and a fair
    estimate for moderate ones, which is all a segment count needs. Under
    linear fidelity the nodal rotations are the small-rotation values, so
    this is the linear end rotation the rotation rule is calibrated on.
    """
    start, end = (np.array(ops.nodeDisp(tag), dtype=float) for tag in (built.nodes[0], built.nodes[-1]))
    axis = member.axes[0]
    chord = member.length * axis + end[:3] - start[:3]
    norm = float(np.linalg.norm(chord))
    if not norm > 0.0:
        return math.inf
    if finite:
        direction = chord / norm
        cross = np.cross(axis, direction)
        sine = float(np.linalg.norm(cross))
        omega = cross / sine * math.atan2(sine, float(axis @ direction)) if sine > 0.0 else np.zeros(3)
    else:
        direction = axis
        omega = np.cross(axis, end[:3] - start[:3]) / member.length
    largest = 0.0
    for member_end, displacement in ((member.start, start), (member.end, end)):
        relative = displacement[3:] - omega
        relative -= (relative @ direction) * direction
        if member_end.representation == RELEASE:
            for law_index, local in ((4, member.axes[1]), (5, member.axes[2])):
                if member_end.laws[law_index] == FREE:
                    relative -= (relative @ local) * local
        largest = max(largest, float(np.linalg.norm(relative)))
    return largest


def _analyse_nonlinear(prepared: PreparedModel, component: Component, budget: _Budget,
                       counts: _Counts, warnings: list[str]) -> ComponentOutcome:
    reference = _coarse_reference(prepared, component)
    counts.reference_mechanisms = reference[0].mechanisms
    segments = _preview_segments(prepared, component, reference[0])
    outcome, problem = _solve_nonlinear(prepared, component, budget, counts, segments, reference, warnings)
    if outcome.state != STABLE and outcome.state != MARGINAL:
        return outcome

    # Size the subdivision again from the actual forces and rotations, and refine once.
    beams = [prepared.members[m] for m in component.member_ids if not prepared.members[m].axial]
    short = _short_members(problem, beams)
    if not short:
        return outcome
    refined = {
        member.id: max(segments[member.id], builder.required_segments(member, *problem.demand[member.id]))
        for member in beams
    }
    second, problem = _solve_nonlinear(prepared, component, budget, counts, refined, reference, warnings)
    if second.state == UNKNOWN and "timeout" in second.reason_codes:
        warnings.append(
            f"Component '{component.id}': refining the subdivision of {_names(short)} ran out of time; "
            "results are from the coarser subdivision."
        )
        return outcome
    if second.state in (STABLE, MARGINAL):
        still_short = _short_members(problem, beams)
        if still_short:
            warnings.append(
                f"Component '{component.id}': {_names(still_short)} may need more beam segments than were used "
                "for the 1% accuracy target."
            )
    return second


def _short_members(problem: ComponentProblem, beams: list) -> list[str]:
    return [
        member.id for member in beams
        if builder.required_segments(member, *problem.demand.get(member.id, (0.0, 0.0))) > problem.segments[member.id]
    ]


def _names(member_ids: list[str]) -> str:
    shown = ", ".join(f"'{member_id}'" for member_id in member_ids[:5])
    return f"member(s) {shown}" + (", ..." if len(member_ids) > 5 else "")


def _solve_nonlinear(prepared: PreparedModel, component: Component, budget: _Budget, counts: _Counts,
                     segments: dict[str, int], reference: tuple[stability.Assessment, list[tuple[int, int]]],
                     warnings: list[str]) -> tuple[ComponentOutcome, ComponentProblem]:
    """One nonlinear solve with a given subdivision, mapped to a component outcome."""
    problem = ComponentProblem(prepared, component, segments, reference)
    problem.build()
    if problem.domain.free_dofs == 0:
        return _fully_restrained(prepared, component, problem.domain, counts), problem
    if budget.expired():
        return _unknown(component, counts, ["timeout"], load_factor=0.0), problem

    try:
        outcome = nonlinear.solve(problem, budget.deadline(), nonlinear.Settings())
    finally:
        warnings.extend(problem.warnings)
    domain = problem.domain
    assessment = outcome.assessment
    equations = builder.equations_from_owners(domain, outcome.equation_dofs) if assessment is not None else None
    codes = list(outcome.reason_codes)

    if outcome.state == "stable":
        reference = problem.reference
        if reference is not None and reference.positive_definite and reference.near_mechanism:
            # Taken from the coarse reference only, so it does not depend on the mesh.
            codes.append("near_mechanism")
        state = _read(prepared, component, domain, deformed=True)
        beams = [prepared.members[m] for m in component.member_ids if not prepared.members[m].axial]
        problem.demand = _demand(domain, beams)
        return _finish(prepared, component, state, codes, counts, domain.free_dofs, load_factor=1.0), problem
    if outcome.state == "unstable" and assessment is not None and (
        assessment.mechanisms or assessment.negative_modes
    ):
        return _instability(prepared, component, domain, equations, assessment, counts,
                            load_factor=outcome.load_factor, extra_codes=codes), problem
    free = assessment.free_dofs if assessment is not None else domain.free_dofs
    if outcome.state == "unstable":
        # Verified by the driver, but no shape to show (indefinite without a
        # dense read): report the verdict alone.
        data = StabilityData(stable=False, free_dofs=free, static_indeterminacy=counts.indeterminacy())
        return ComponentOutcome(component, UNSTABLE, codes, data, load_factor=outcome.load_factor), problem
    return _unknown(component, counts, codes, load_factor=outcome.load_factor, free=free), problem


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
        static_indeterminacy=counts.indeterminacy(),
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
    data = StabilityData(stable=True, free_dofs=free, static_indeterminacy=counts.indeterminacy())
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
