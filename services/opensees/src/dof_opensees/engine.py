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

import dataclasses
import math
import threading
import time
from dataclasses import dataclass, field

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
#: Load substeps of the last linear-fidelity attempt when Newton cycles on cable states.
LINEAR_SUBSTEPS = 10
#: Strain whose force (times the smallest member EA) is the absolute floor of
#: the equilibrium force scale. Far below any strain an analysis resolves.
FORCE_FLOOR_STRAIN = 1e-12

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
                results = {
                    component.id: _guarded(prepared, component, budget, warnings)
                    for component in _work_order(prepared)
                }
            finally:
                ops.wipe()
        outcomes = [results[component.id] for component in prepared.components]
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


def _work_order(prepared: PreparedModel) -> list[Component]:
    """Order in which components are analysed (results keep the contract order).

    The budget is shared, so an expensive component analysed first could
    starve cheap ones. Components whose verdict needs no solve go first:
    those with no free DOF (statics at zero displacement) and those with no
    support at all (``unsupported_component`` follows from statics). The rest
    follow by increasing free-DOF count, a proxy for cost that needs no
    OpenSees, ties by id so the order is deterministic. Each component is
    classified and solved in one go: splitting classification from solving
    would build every domain twice, and a component classified as a mechanism
    is never reported as a timeout anyway (see ``_analyse``).
    """
    def key(component: Component) -> tuple[int, int, str]:
        size = free_dofs(prepared, component)
        supported = any(prepared.joints[node_id].supported for node_id in component.node_ids)
        no_solve = size == 0 or not supported
        return (0 if no_solve else 1, size, component.id)

    return sorted(prepared.components, key=key)


def _guarded(prepared: PreparedModel, component: Component, budget: _Budget, warnings: list[str]) -> ComponentOutcome:
    counts = _Counts(*static_counts(prepared, component), free_dofs(prepared, component))
    try:
        return _analyse(prepared, component, budget, warnings, counts)
    except _IllConditioned as error:
        warnings.append(
            f"Component '{component.id}': a stiffness mode with scaled eigenvalue {error.eigenvalue:.1e} is too "
            "soft to tell from a mechanism (extreme stiffness ratio between members); no verdict is given."
        )
        return _unknown(component, counts, ["near_mechanism"])
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
    supported = any(prepared.joints[node_id].supported for node_id in component.node_ids)
    if budget.expired():
        if not supported:
            # Statics alone: nothing holds it. Shapes and counts need the
            # classification, which there is no time for.
            warnings.append(f"Component '{component.id}': unsupported; mode shapes were not computed (time budget).")
            data = StabilityData(stable=False, free_dofs=counts.linear_free_dofs)
            return ComponentOutcome(component, UNSTABLE, ["unsupported_component"], data, load_factor=0.0)
        if counts.linear_free_dofs != 0:
            return _unknown(component, counts, ["timeout"], load_factor=0.0)
        # No free DOF: no solve needed, carry on.
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

    reference, equations, free = _classify(prepared, component, domain, deformed=False)
    counts.reference_mechanisms = reference.mechanisms
    has_cables = any(prepared.members[m].kind == "cable" for m in component.member_ids)
    if not reference.positive_definite:
        # A mechanism held off on one side by slack cables, with the load
        # pushing the other way, may still be carried once the cables take
        # it up; only the solve can tell (DESIGN.md, cables are one-sided).
        if not _load_may_engage_cables(free, equations.load_vector(_reference_loads(domain))):
            return _instability(prepared, component, domain, equations, reference, counts, load_factor=0.0)
        if not _solve_linear(has_cables):
            return _instability(prepared, component, domain, equations, reference, counts, load_factor=0.0)
        codes = []
    else:
        codes = ["near_mechanism"] if reference.near_mechanism else []
        if not _solve_linear(has_cables):
            return _unknown(component, counts, ["not_converged"], load_factor=0.0, free=reference.free_dofs)
    state = _read(prepared, component, domain, deformed=False)

    if has_cables:
        # Slack cables have left the tangent: the final state may be a mechanism.
        final, equations, _ = _classify(prepared, component, domain, deformed=False)
        if not final.positive_definite:
            return _instability(prepared, component, domain, equations, final, counts, load_factor=1.0)
        if final.near_mechanism and "near_mechanism" not in codes:
            codes.append("near_mechanism")
    return _finish(prepared, component, state, codes, counts, reference.free_dofs, load_factor=1.0)


def _assess(domain: builder.Domain) -> tuple[stability.Assessment, builder.Equations]:
    matrix = tangent.extract_tangent()
    equations = builder.read_equations(domain, matrix.shape[0])
    return stability.assess(matrix, equations.translation_mask(), equations.load_vector(_reference_loads(domain))), equations


# --- cables are one-sided restraints (audit D3) ------------------------------
#
# The tension-only material has its full modulus at exactly zero strain, so a
# cable that is not in tension still stiffens the tangent OpenSees reports. But
# such a cable resists only motion that lengthens it. Classification therefore
# removes every cable that is not in tension, finds the null space of what is
# left, and asks whether some direction in it can be followed without
# lengthening any of those cables. If so, it is a mechanism; if every null
# direction lengthens at least one of them, the cables hold the structure in
# every direction, and it is not.

#: An elongation rate below this, for a unit-norm mode, is no elongation.
ELONGATION_TOLERANCE = 1e-9
#: Relative residual above which a cone-membership (NNLS) problem is infeasible.
FEASIBILITY_TOLERANCE = 1e-8


@dataclass(frozen=True)
class _SlackCable:
    start: int
    end: int
    #: Current unit direction from start to end.
    direction: np.ndarray
    #: Stiffness EA/L the tangent still holds for it (its strain is exactly at
    #: the kink), or 0 when its material is already in its slack branch.
    stiffness: float


@dataclass(frozen=True)
class _FreeDirection:
    vector: np.ndarray
    #: True when the opposite direction is free too (no slack cable changes length).
    two_sided: bool


#: Scaled eigenvalue below which a null mode is rounding noise: a mechanism.
#: Between this and ``stability.ZERO_EIGENVALUE`` a mode is too soft to be
#: told apart from a mechanism (audit D8).
ROUNDOFF_EIGENVALUE = 1e-13


class _IllConditioned(Exception):
    """A null mode lies in the band where mechanism and soft mode look alike."""

    def __init__(self, eigenvalue: float) -> None:
        super().__init__(eigenvalue)
        self.eigenvalue = eigenvalue


def _check_conditioning(assessment: stability.Assessment, matrix: np.ndarray) -> None:
    """Raise when a reported null mode is softer than zero but stiffer than roundoff.

    ``stability.assess`` calls a mode null when its eigenvalue in the
    unit-diagonal scaling is below ``ZERO_EIGENVALUE`` (1e-10). That scaling
    does not remove a stiffness ratio between members that share a node: a
    stiff member hanging on a soft one has a true, non-zero scaled eigenvalue
    of about (soft / stiff), measured as 2.5e-3 / r on a two-member
    cantilever with stiffness ratio r (5e-11 at r = 5e8). Genuine mechanisms
    over 700 generated and random models sat at or below 1e-15 almost
    always, but a continuous tail reached 1e-11, so no threshold separates
    the two. The scaled eigenvalue of each mode is its Rayleigh quotient,
    m^T K m / |m / s|^2 with s the scaling; between ROUNDOFF_EIGENVALUE (n
    times machine precision at the largest sizes) and ZERO_EIGENVALUE the
    verdict would be a guess, so none is given.
    """
    modes = assessment.translational_modes + assessment.rotational_modes
    if not modes:
        return
    symmetric = 0.5 * (matrix + matrix.T)
    diagonal = np.diag(symmetric)
    scale = np.where(diagonal > 0.0, 1.0 / np.sqrt(np.where(diagonal > 0.0, diagonal, 1.0)), 1.0)
    for mode in modes:
        quotient = float(mode @ symmetric @ mode) / float(np.sum((mode / scale) ** 2))
        if abs(quotient) > ROUNDOFF_EIGENVALUE:
            raise _IllConditioned(abs(quotient))


def _classify(prepared: PreparedModel, component: Component, domain: builder.Domain,
              deformed: bool) -> tuple[stability.Assessment, builder.Equations, list[_FreeDirection] | None]:
    """Classify the current tangent with cables treated as one-sided restraints.

    Returns the assessment, its equations, and the free directions when the
    structure is a mechanism held only by slack cables (None otherwise).
    Raises :class:`_IllConditioned` when a mechanism cannot be told apart from
    a very soft mode (audit D8).
    """
    matrix = tangent.extract_tangent()
    equations = builder.read_equations(domain, matrix.shape[0])
    mask, loads = equations.translation_mask(), equations.load_vector(_reference_loads(domain))
    full = stability.assess(matrix, mask, loads)
    _check_conditioning(full, matrix)
    slack = _slack_cables(prepared, component, domain, deformed)
    if not slack:
        return full, equations, None
    reduced_matrix = matrix.copy()
    for cable in slack:
        if cable.stiffness == 0.0:
            continue
        block = cable.stiffness * np.outer(cable.direction, cable.direction)
        start = equations.of_node[cable.start][:3]
        end = equations.of_node[cable.end][:3]
        for rows, columns, sign in ((start, start, 1.0), (end, end, 1.0), (start, end, -1.0), (end, start, -1.0)):
            for a, row in enumerate(rows):
                for b, column in enumerate(columns):
                    if row >= 0 and column >= 0:
                        reduced_matrix[row, column] -= sign * block[a, b]
    reduced = stability.assess(reduced_matrix, mask, loads)
    _check_conditioning(reduced, reduced_matrix)
    if not reduced.mechanisms:
        return full, equations, None
    free = _free_directions(reduced, equations, slack)
    if free is None:
        return full, equations, None  # Held by its cables in every direction.
    return _mechanism_assessment(reduced, free, mask, loads), equations, free


def _slack_cables(prepared: PreparedModel, component: Component, domain: builder.Domain,
                  deformed: bool) -> list[_SlackCable]:
    """Cables not in tension in the current state.

    Strain from the end nodes: small-displacement n . du / L under linear
    geometry, chord length change under corotational geometry, plus the
    initial strain. At the reference state it is the initial strain exactly.
    """
    result = []
    for member_id in component.member_ids:
        member = prepared.members[member_id]
        if member.kind != "cable":
            continue
        built = domain.members[member_id]
        start, end = built.nodes[0], built.nodes[-1]
        relative = np.array(ops.nodeDisp(end)[:3], dtype=float) - np.array(ops.nodeDisp(start)[:3], dtype=float)
        if deformed:
            chord = member.length * member.axes[0] + relative
            direction = chord / np.linalg.norm(chord)
            strain = float(np.linalg.norm(chord)) / member.length - 1.0 + member.initial_strain
        else:
            direction = member.axes[0]
            strain = float(direction @ relative) / member.length + member.initial_strain
        if strain > SLACK_STRAIN:
            continue  # In tension: a two-sided stiffness while it stays so.
        stiffness = member.properties.elastic_modulus * member.properties.area / member.length
        result.append(_SlackCable(start, end, direction, stiffness if strain >= 0.0 else 0.0))
    return result


def _free_directions(reduced: stability.Assessment, equations: builder.Equations,
                     slack: list[_SlackCable]) -> list[_FreeDirection] | None:
    """Null directions that lengthen no slack cable, or None if there are none.

    With V an orthonormal basis of the null space (k columns) and E the
    elongation rates of the slack cables along it (one row per cable,
    E[c] alpha = n_c . (u_end - u_start) for the motion V alpha), a direction
    is free when E alpha <= 0 with V alpha != 0.

    * Rows that are zero (cables the null space does not stretch) are dropped.
    * If E has a null space, those directions change no cable at all and are
      free both ways.
    * Otherwise E has full column rank, and by Stiemke's alternative a
      non-zero alpha with E alpha <= 0 exists unless some strictly positive y
      satisfies E^T y = 0. Such a y exists if and only if, for every cable i,
      -E[i] lies in the cone spanned by the other rows (sum the certificates).
      Each membership test is a non-negative least squares problem; when one
      is infeasible its residual r satisfies E[j] r <= 0 for the other rows
      and E[i] r < 0 (the NNLS optimality conditions are a Farkas
      certificate), so V r is a free direction that shortens cable i.

    Tolerances: elongation rates below ELONGATION_TOLERANCE (for unit modes)
    are zero; a membership residual above FEASIBILITY_TOLERANCE relative to
    |E[i]| means infeasible.
    """
    modes = reduced.translational_modes + reduced.rotational_modes
    basis, _ = np.linalg.qr(np.array(modes).T)

    def elongation(vector: np.ndarray, cable: _SlackCable) -> float:
        def translation(tag: int) -> np.ndarray:
            return np.array([vector[eq] if eq >= 0 else 0.0 for eq in equations.of_node[tag][:3]])
        return float(cable.direction @ (translation(cable.end) - translation(cable.start)))

    rates = np.array([[elongation(basis[:, j], cable) for j in range(basis.shape[1])] for cable in slack])
    rates = rates[np.max(np.abs(rates), axis=1) > ELONGATION_TOLERANCE] if rates.size else rates
    if rates.size == 0:
        return [_FreeDirection(basis[:, j], True) for j in range(basis.shape[1])]
    _, singular, right = np.linalg.svd(rates)
    rank = int(np.sum(singular > ELONGATION_TOLERANCE * singular[0]))
    if rank < basis.shape[1]:
        return [_FreeDirection(basis @ right[j], True) for j in range(rank, basis.shape[1])]
    for i in range(rates.shape[0]):
        others = np.delete(rates, i, axis=0).T
        target = -rates[i]
        weights = _nnls(others, target) if others.size else np.zeros(0)
        residual = target - (others @ weights if others.size else 0.0)
        if np.linalg.norm(residual) > FEASIBILITY_TOLERANCE * np.linalg.norm(target):
            return [_FreeDirection(basis @ residual, False)]
    return None


def _nnls(matrix: np.ndarray, target: np.ndarray) -> np.ndarray:
    """Lawson-Hanson non-negative least squares: argmin |A x - b| with x >= 0."""
    rows, columns = matrix.shape
    x = np.zeros(columns)
    passive = np.zeros(columns, dtype=bool)
    tolerance = 1e-12 * max(1.0, float(np.abs(matrix).max()) * float(np.abs(target).max()))
    for _ in range(3 * columns + 10):
        gradient = matrix.T @ (target - matrix @ x)
        if passive.all() or float(np.max(np.where(passive, -np.inf, gradient))) <= tolerance:
            break
        passive[int(np.argmax(np.where(passive, -np.inf, gradient)))] = True
        for _ in range(3 * columns + 10):
            trial = np.zeros(columns)
            trial[passive] = np.linalg.lstsq(matrix[:, passive], target, rcond=None)[0]
            if np.all(trial[passive] > 0.0):
                x = trial
                break
            blocking = passive & (trial <= 0.0)
            step = float(np.min(x[blocking] / (x[blocking] - trial[blocking])))
            x = x + step * (trial - x)
            passive &= x > tolerance
            x[~passive] = 0.0
    return x


def _mechanism_assessment(reduced: stability.Assessment, free: list[_FreeDirection], mask: np.ndarray,
                          loads: np.ndarray) -> stability.Assessment:
    """An assessment whose mechanism modes are the free directions."""
    result = stability.Assessment(
        free_dofs=reduced.free_dofs,
        negative_modes=list(reduced.negative_modes),
        near_mechanism=reduced.near_mechanism,
        min_eigenvalue=reduced.min_eigenvalue,
    )
    load_scale = float(np.max(np.abs(loads))) if loads.size else 0.0
    for direction in free:
        vector = direction.vector
        peak = float(np.max(np.abs(vector)))
        translation = float(np.max(np.abs(vector[mask]))) if mask.any() else 0.0
        loaded = load_scale > 0.0 and abs(float(vector @ loads)) > stability.LOADED_MODE * load_scale * peak
        result.mechanism_loaded |= loaded
        if translation > stability.ROTATION_ONLY * peak:
            result.translational_modes.append(vector / translation)
        else:
            result.rotational_modes.append(vector / peak)
            result.rotation_loaded |= loaded
    return result


def _load_may_engage_cables(free: list[_FreeDirection] | None, loads: np.ndarray) -> bool:
    """Whether the load pushes against the only free direction, so cables may take it up.

    A two-sided free direction, or a one-sided one the load does no work
    against, is a mechanism whatever the cables do.
    """
    if not free or any(direction.two_sided for direction in free):
        return False
    scale = float(np.max(np.abs(loads))) if loads.size else 0.0
    return all(
        float(direction.vector @ loads) < -stability.LOADED_MODE * scale * float(np.max(np.abs(direction.vector)))
        for direction in free
    )


def _solve_linear(has_cables: bool) -> bool:
    """One small-displacement solve. Cables are tension-only, so it iterates on their states.

    Initial strains that are not self-balanced at the reference geometry are
    simply part of this one solve under linear fidelity.

    Plain Newton can cycle between cable states on a piecewise-linear
    problem (seed 136: a guyed mast with unbalanced pretension cycled with an
    increment norm stuck at 0.18 m). Small-displacement equilibrium with
    tension-only cables minimises a convex energy, so any converged state is
    the solution, and the solve may retry with line search and then with
    load substeps; verification still checks the result.
    """
    attempts = [(("Linear",), 1)] if not has_cables else [
        (("Newton",), 1), (("NewtonLineSearch",), 1), (("NewtonLineSearch",), LINEAR_SUBSTEPS),
    ]
    for algorithm, steps in attempts:
        ops.wipeAnalysis()
        ops.system("BandGeneral")
        ops.numberer("RCM")
        ops.constraints("Transformation")
        if has_cables:
            ops.test("NormDispIncr", LINEAR_DISPLACEMENT_TOLERANCE, LINEAR_ITERATIONS)
        ops.algorithm(*algorithm)
        ops.integrator("LoadControl", 1.0 / steps)
        ops.analysis("Static")
        ops.setTime(0.0)
        if ops.analyze(steps) == 0:
            ops.reactions()
            return True
        # A failed static analyze reverts the domain to its last committed
        # state, which is rest (nothing was committed); the time is reset
        # above, so the next attempt starts from the reference state.
    return False


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
        # A rebuild starts a new load path (the driver's one-step fast path
        # falls back by rebuilding), so its first loss of stability gets its
        # own shape read.
        self._shape_read = False

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
        """Largest translation over every node but interior segment nodes.

        Interior nodes are left out so the value is comparable with the
        coarse linear preview (``_preview``), which has none; the recovery
        bound is about joints moving away, which this still measures.
        """
        return _peak(self.domain)


def _coarse_reference(prepared: PreparedModel,
                      component: Component) -> tuple[stability.Assessment, list[tuple[int, int]]]:
    """Dense classification of the coarse corotational build at its reference state.

    Cables are one-sided (``_classify``): a mechanism held off only by cables
    that are not in tension is reported as one, with the free direction as its
    mode, so the driver treats it as a mechanism (recovery when loaded).
    """
    coarse = builder.build(prepared, component, builder.COROTATIONAL)
    if coarse.free_dofs == 0:
        return stability.Assessment(free_dofs=0), []
    assessment, equations, _ = _classify(prepared, component, coarse, deformed=False)
    return assessment, list(equations.owners)


def _preview(prepared: PreparedModel, component: Component, coarse: builder.Domain,
             reference: stability.Assessment) -> tuple[dict[str, int], float | None]:
    """Elements per beam and the expected peak displacement, from a linear preview.

    The preview is one linear step (``algorithm Linear``, full load) on the
    coarse corotational domain that was just classified, so it needs no build
    and no tangent read of its own. Its tangent is the reference tangent,
    initial strains included, so a structure that only pretension stiffens
    still previews; tension-only cables are not iterated, which is good
    enough for sizing. Axial forces and end rotations are taken in the small-
    displacement sense from the nodal displacements (a corotational element
    would reinterpret a large linear displacement): N = EA/L x . du, plus half
    the member's axial self-weight, ``builder.required_segments`` turns them
    into counts.

    The peak is the largest translation magnitude over the same nodes the
    nonlinear ``peak_displacement`` uses (every node but interior segment
    nodes), so the driver can compare the two. Without a preview (a mechanism
    in the coarse reference, or a failed step) every beam gets
    ``builder.FALLBACK_SEGMENTS`` and the peak is None.
    """
    beams = [prepared.members[m] for m in component.member_ids if not prepared.members[m].axial]
    fallback = {member.id: builder.FALLBACK_SEGMENTS for member in beams}, None
    if not reference.positive_definite:
        return fallback
    ops.wipeAnalysis()
    ops.system("BandGeneral")
    ops.numberer("RCM")
    ops.constraints("Transformation")
    ops.algorithm("Linear")
    ops.integrator("LoadControl", 1.0)
    ops.analysis("Static")
    if ops.analyze(1) != 0:
        return fallback
    segments = {}
    for member in beams:
        built = coarse.members[member.id]
        start, end = (np.array(ops.nodeDisp(tag)[:3], dtype=float) for tag in (built.nodes[0], built.nodes[-1]))
        p = member.properties
        tension = p.elastic_modulus * p.area / member.length * float(member.axes[0] @ (end - start))
        along = abs(p.weight_per_length * member.axes[0][2]) * member.length / 2.0 if prepared.self_weight else 0.0
        compression = max(0.0, -tension + along)
        rotation = _chord_rotation(member, built, finite=False)
        if not (math.isfinite(compression) and math.isfinite(rotation)):
            return fallback
        segments[member.id] = builder.required_segments(member, compression, rotation)
    peak = _peak(coarse)
    return segments, peak if math.isfinite(peak) else None


def _peak(domain: builder.Domain) -> float:
    """Largest translation magnitude over every node but interior segment nodes."""
    return max(
        (float(np.linalg.norm(ops.nodeDisp(tag)[:3])) for tag, node in domain.nodes.items() if not node.interior),
        default=0.0,
    )


def _settings(expected_peak: float | None) -> nonlinear.Settings:
    """Driver settings, with the fast-path hint when the driver supports it.

    Guard: ``Settings.expected_peak_displacement`` is being added to the
    driver; until it exists the hint is not passed. Remove the guard once it
    has landed.
    """
    names = {item.name for item in dataclasses.fields(nonlinear.Settings)}
    if "expected_peak_displacement" in names:
        return nonlinear.Settings(expected_peak_displacement=expected_peak)
    return nonlinear.Settings()


def _demand(domain: builder.Domain, beams: list) -> dict[str, tuple[float, float]]:
    """(largest compressive axial force, largest end rotation relative to the chord) per beam.

    The compression is the most compressive axial force at either end of any
    element (``localForce``: tension is -N at the start, index 0, and N at
    the end, index 6), as a positive number.
    """
    result = {}
    for member in beams:
        built = domain.members[member.id]
        forces = [
            value
            for tag in built.elements
            for response in (ops.eleResponse(tag, "localForce"),)
            for value in (-float(response[0]), float(response[6]))
        ]
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
    # One coarse build serves the zero-DOF statics, the reference
    # classification (the only dense tangent read) and the linear preview;
    # the driver then builds the model it solves.
    coarse = builder.build(prepared, component, builder.COROTATIONAL)
    if coarse.free_dofs == 0:
        counts.reference_mechanisms = 0
        return _fully_restrained(prepared, component, coarse, counts)
    assessment, equations, _ = _classify(prepared, component, coarse, deformed=False)
    counts.reference_mechanisms = assessment.mechanisms
    reference = (assessment, list(equations.owners))
    if assessment.mechanisms and budget.expired():
        # The verified fact is the mechanism; never report it as a timeout.
        return _instability(prepared, component, coarse, equations, assessment, counts, load_factor=0.0)
    segments, expected_peak = _preview(prepared, component, coarse, assessment)
    outcome, problem = _solve_nonlinear(prepared, component, budget, counts, segments, reference, warnings,
                                        expected_peak, (coarse, equations))
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
    second, problem = _solve_nonlinear(prepared, component, budget, counts, refined, reference, warnings,
                                       expected_peak, (coarse, equations))
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
                     warnings: list[str], expected_peak: float | None,
                     coarse: tuple[builder.Domain, builder.Equations]) -> tuple[ComponentOutcome, ComponentProblem]:
    """One nonlinear solve with a given subdivision, mapped to a component outcome.

    The driver builds the domain itself; nothing is built here. ``coarse``
    is the classified coarse domain and its equations, used to report the
    reference mechanism if the solve cannot conclude.
    """
    problem = ComponentProblem(prepared, component, segments, reference)

    def reference_mechanism(codes: list[str]) -> ComponentOutcome:
        # A mechanism at the reference geometry is verified. When recovery
        # could not show otherwise in time, that is the verdict, not a timeout.
        return _instability(prepared, component, coarse[0], coarse[1], reference[0], counts,
                            load_factor=0.0, extra_codes=[code for code in codes if code != "timeout"])

    if budget.expired():
        if reference[0].mechanisms:
            return reference_mechanism([]), problem
        return _unknown(component, counts, ["timeout"], load_factor=0.0), problem

    try:
        outcome = nonlinear.solve(problem, budget.deadline(), _settings(expected_peak))
    finally:
        warnings.extend(problem.warnings)
    if outcome.state == "unknown" and "timeout" in outcome.reason_codes and reference[0].mechanisms:
        return reference_mechanism(outcome.reason_codes), problem
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
        if state.slack:
            # The driver's banded test cannot see an exactly singular tangent,
            # and a mechanism held only by slack cables is exactly singular.
            if domain.free_dofs <= DENSE_SHAPE_LIMIT:
                final, final_equations, _ = _classify(prepared, component, domain, deformed=True)
                if final.mechanisms:
                    return _instability(prepared, component, domain, final_equations, final, counts,
                                        load_factor=1.0, extra_codes=codes), problem
            else:
                warnings.append(
                    f"Component '{component.id}': cables are slack at full load and the system has "
                    f"{domain.free_dofs} equations (limit {DENSE_SHAPE_LIMIT}); whether the slack cables leave a "
                    "mechanism was not checked."
                )
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
    #: Beam element loads as OpenSees applies them: (intended total force,
    #: applied force, applied moment about the global origin), global axes.
    distributed: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = field(default_factory=list)
    #: Largest unbalanced nodal force and moment over every DOF that is not a
    #: support restraint (free DOFs, and fixes that are not supports).
    nodal_force: float = 0.0
    nodal_moment: float = 0.0
    #: Absolute floor for the force scale: FORCE_FLOOR_STRAIN times the
    #: smallest member EA, the force of a strain no analysis could resolve.
    force_floor: float = 0.0


def _nodal_unbalance(prepared: PreparedModel, domain: builder.Domain,
                     raw: dict[int, np.ndarray]) -> tuple[float, float]:
    """Largest nodal force and moment residual (audit D9).

    After ``ops.reactions()``, ``nodeReaction`` holds resisting minus applied
    force at every DOF, element loads included, so at a free DOF it is the
    residual of that equation (verified in OpenSeesPy 3.8; ``nodeUnbalance``
    only returns the applied nodal load and is no use here). A DOF tied to a
    joint by ``equalDOF``, or fixed on a duplicate because the joint has it
    fixed (``held``), shares the joint's equation, so the duplicate's value
    is added to the joint's before judging. Support restraints are
    reactions, not residuals, and are left out. Every other fix (a removed
    joint rotation, an axial member's own end rotations) must carry nothing,
    so it is judged like a free DOF: a force there would be artificial.
    """
    sums: dict[tuple[int, int], float] = {}
    for node in domain.nodes.values():
        for dof in range(1, 7):
            owner = node.retained if node.retained is not None and dof in node.tied + node.held else node.tag
            sums[(owner, dof)] = sums.get((owner, dof), 0.0) + float(raw[node.tag][dof - 1])
    force = moment = 0.0
    for (tag, dof), value in sums.items():
        joint_id = domain.nodes[tag].joint_id
        if joint_id is not None and prepared.joints[joint_id].restrained[dof - 1]:
            continue
        if dof <= 3:
            force = max(force, abs(value))
        else:
            moment = max(moment, abs(value))
    return force, moment


def _reference_loads(domain: builder.Domain) -> dict[int, np.ndarray]:
    """Nodal loads plus beam element loads lumped half to each element end.

    Only used to judge whether a load acts on a mode; the analysis itself
    applies the element loads exactly.
    """
    loads = {tag: load.copy() for tag, load in domain.loads.items()}
    for _, start, end, force in domain.distributed:
        for tag in (start, end):
            loads.setdefault(tag, np.zeros(6))[:3] += 0.5 * force
    return loads


def _read(prepared: PreparedModel, component: Component, domain: builder.Domain, deformed: bool) -> _State:
    ops.reactions()
    displacement = {tag: np.array(ops.nodeDisp(tag), dtype=float) for tag in domain.nodes}
    raw = {tag: np.array(ops.nodeReaction(tag), dtype=float) for tag in domain.nodes}
    nodal_force, nodal_moment = _nodal_unbalance(prepared, domain, raw)
    reactions = {}
    for node_id, tag in domain.joint_tags.items():
        joint = prepared.joints[node_id]
        if not joint.supported:
            continue
        reaction = raw[tag].copy()
        # Forces delivered through a duplicate node are reported on the duplicate.
        for duplicate in domain.duplicates_of(tag):
            # ``held`` DOFs are fixed on the duplicate instead of tied (see
            # builder._end_node); their reaction is the joint's support's.
            for dof in duplicate.tied + duplicate.held:
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
    distributed = []
    for tag, start, end, intended in domain.distributed:
        # The load an element carries is minus the sum of its own end forces
        # (the element is in equilibrium with its load by construction). Under
        # Corotational geometry the resultant of beamUniform stays along
        # global -Z but does not act at the deformed chord midpoint, so its
        # line of action is taken from the element rather than assumed; its
        # direction and size are still checked against the intended dead load.
        f = np.array(ops.eleResponse(tag, "globalForce"), dtype=float)
        applied = -(f[0:3] + f[6:9])
        moment = -(np.cross(positions[start], f[0:3]) + f[3:6] + np.cross(positions[end], f[6:9]) + f[9:12])
        distributed.append((intended, applied, moment))
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
        distributed=distributed,
        nodal_force=nodal_force,
        nodal_moment=nodal_moment,
        force_floor=FORCE_FLOOR_STRAIN * min(
            (prepared.members[m].properties.elastic_modulus * prepared.members[m].properties.area
             for m in component.member_ids),
            default=0.0,
        ),
    )


def _forces(axial: float = 0.0) -> dict:
    return {"axial": axial, "shear": 0.0, "torsion": 0.0, "momentStart": 0.0, "momentEnd": 0.0}


def _beam_forces(elements: list[int]) -> dict:
    """Per contract member: signed axial largest in magnitude, largest shear and torsion, end moments.

    ``localForce`` is [N, Vy, Vz, T, My, Mz] at the start then the end, as
    forces on the element; the axial force, tension positive, is -N at the
    start and N at the end. Both ends count, because self-weight along the
    member axis makes the axial force vary along an element. Shear is largest
    at an element end under nodal and uniform loads, so the end values give
    the largest along the member.
    """
    responses = [np.array(ops.eleResponse(tag, "localForce"), dtype=float) for tag in elements]
    axial = max((value for f in responses for value in (-f[0], f[6])), key=abs)
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

    OpenSees cannot analyse an empty system (it crashes the process). But it
    can evaluate the zero-displacement state at full load without one:
    ``setTime(1.0)`` puts the Linear time series at factor 1, and
    ``reactions()`` then forms every element's resisting force at zero
    displacement, including fixed-end forces of element loads and the
    initial-strain forces of axial members (verified in OpenSeesPy 3.8). So
    the results are read as after any solve.
    """
    ops.setTime(1.0)
    state = _read(prepared, component, domain, deformed=False)
    return _finish(prepared, component, state, [], counts, 0, load_factor=1.0)


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
    load_error = 0.0
    for intended, load, load_moment in state.distributed:
        # Applied as OpenSees applies it (see _read); the moment is shifted
        # from the origin to the centre.
        force += load
        moment += load_moment - np.cross(centre, load)
        applied_force += float(np.linalg.norm(intended))
        # Self-weight is a dead load: what the element carries must be the
        # intended w L along global -Z, whatever the member has done.
        load_error = max(load_error, float(np.linalg.norm(load - intended)))
    extent = np.ptp(np.array(list(positions.values())), axis=0) if positions else np.zeros(3)
    size = float(np.linalg.norm(extent)) or 1.0
    raw_moment_scale = max(applied_moment, reacted_moment, state.moment_scale)
    # The floor makes an unloaded, unstressed component pass: all its forces
    # are rounding noise, and noise divided by a noise-sized scale is not a
    # residual.
    force_scale = max(applied_force, reacted_force, state.force_scale, raw_moment_scale / size, state.force_floor)
    moment_scale = max(force_scale * size, raw_moment_scale)
    residuals = []
    for value, scale in ((np.linalg.norm(force), force_scale), (np.linalg.norm(moment), moment_scale),
                         (state.nodal_force, force_scale), (state.nodal_moment, moment_scale),
                         (load_error, force_scale)):
        if scale > 0.0:
            residuals.append(float(value) / scale)
        else:
            residuals.append(0.0 if value == 0.0 else math.inf)
    return max(residuals)
