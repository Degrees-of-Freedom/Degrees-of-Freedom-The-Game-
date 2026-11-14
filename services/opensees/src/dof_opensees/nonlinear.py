"""Incremental-iterative nonlinear static driver.

This module knows nothing about the solver contract. It drives whatever
OpenSees domain a :class:`Problem` builds, following the procedure in
``DESIGN.md`` ("Nonlinear fidelity", "Recovery from a singular reference
state"), and reports an :class:`Outcome`.

Procedure, in short:

1. Build the reference state and classify its tangent. A negative direction
   is a load-induced instability at factor 0. A mechanism is either unloaded
   (unstable, named by the engine) or loaded (attempt the bounded recovery).
2. Otherwise load proportionally from 0 to 1 with ``LoadControl`` steps,
   Newton iterations (falling back to Newton with line search), and step
   halving on failure down to ``Settings.min_step``. Every step is checked
   to have stayed on its equilibrium branch (``_Driver.step``), so a
   snap-through past a limit point is reported ``not_converged`` rather
   than as a stable far-away equilibrium.
3. After every converged step classify the tangent. The first state that is
   not positive definite brackets a critical point together with the last
   positive definite state; bisection narrows the bracket to
   ``Settings.critical_factor_tolerance``.

Facts about OpenSeesPy 3.8 this relies on, checked on the target machine:

* A failed ``analyze`` reverts the domain to the last committed state,
  including the load factor, so a step can simply be retried smaller.
* A converged ``analyze`` commits; there is no un-commit. Going back to an
  earlier load factor therefore means stepping backwards (fine on the same
  equilibrium branch, which is how bisection moves) or rebuilding with
  ``Problem.build`` and stepping forward again (used after a rejected jump).
* ``testNorm`` returns the norm of every Newton correction of the last step.
* Analysing a domain with zero free DOFs crashes the process, so the driver
  counts free DOFs before anything reads a tangent.

Path independence: the structures this driver serves are elastic (linear
materials, tension-only cables, corotational geometry), so the equilibrium at
a load factor does not depend on how it was reached, only on which branch.
That is what makes backward stepping during bisection and replaying steps
after a rebuild legitimate.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Literal, Protocol

import numpy as np
import openseespy.opensees as ops

from . import stability, tangent


class Problem(Protocol):
    """One component, able to rebuild itself and describe its equations."""

    #: Node, element and material tags at or above this value are unused by
    #: the problem and free for temporary objects such as recovery springs.
    temp_tag_base: int
    #: Largest translation, in metres, that a recovered equilibrium may have
    #: and still be accepted as a stable structure.
    recovery_displacement_limit: float

    def build(self) -> None:
        """Wipe OpenSees and build the domain at its reference state.

        The full reference load must be defined in one ``Plain`` load pattern
        on a ``Linear`` time series, so that a ``LoadControl`` integrator
        scales it and the pseudo-time equals the load factor. No analysis
        objects are created. May be called many times; every call must give
        the same domain and the same tags.
        """

    def assess(self) -> stability.Assessment:
        """Classify the tangent stiffness of the domain at its current state.

        Replaces the analysis objects (see ``tangent.extract_tangent``), so
        the driver must set its analysis up again before the next step.
        """

    def equation_dofs(self) -> list[tuple[int, int]]:
        """``(node tag, dof)`` with dof in 1..6 for each equation of the last ``assess``.

        Lets the driver turn a mode vector into nodal directions, for example
        to place temporary springs.
        """

    def peak_displacement(self) -> float:
        """Largest nodal translation magnitude in the current state, in metres."""


@dataclass(frozen=True)
class Settings:
    """Bounds on the work the driver may do. Values are set by the driver's author."""

    #: Relative width of the final bracket on a critical load factor. The
    #: reported factor is the bracket midpoint, so its own error is at most
    #: half of this.
    critical_factor_tolerance: float = 0.01

    #: Load steps, as fractions of the full load. Elastic equilibria do not
    #: depend on the step size, so steps are large and only cut when Newton
    #: fails; a critical point inside a large step is still caught by the
    #: tangent check and bisection.
    initial_step: float = 0.25
    max_step: float = 0.5
    #: Smallest step before the driver gives up with ``not_converged``. Nine
    #: halvings from the initial step.
    min_step: float = 1.0e-3
    #: The step grows by this factor after a step that needed few iterations.
    step_growth: float = 2.0
    fast_iterations: int = 6

    #: Newton convergence: norm of the last correction (translations in m,
    #: rotations in rad) below this times the size of the model. Newton
    #: converges quadratically near a solution, so the residual left is far
    #: below the engine's 1e-5 equilibrium gate. Absolute force tolerances
    #: are avoided because load scales vary by orders of magnitude.
    displacement_tolerance: float = 1.0e-10
    max_iterations: int = 30

    #: A converged step whose increment and tangent predictor differ by more
    #: than this factor (see ``_Driver.jumped``) may have reached a distant
    #: equilibrium, for example by snapping through a limit point. Load
    #: control cannot follow that path and the service does not simulate
    #: dynamic snap-through, so the step is rejected and cut.
    jump_ratio: float = 10.0
    #: Undo and redo every load step to prove it stayed on its branch (see
    #: ``_Driver.step``). Only for experiments: without it a snap-through
    #: can be reported as a stable equilibrium.
    verify_branch: bool = True

    #: Upper bound on bisection steps, a guard only: the tolerance normally
    #: stops bisection after a handful.
    max_bisections: int = 40

    #: Recovery springs, as a fraction of the largest diagonal entry of the
    #: reference tangent (translational and rotational separately). They are
    #: softened by ``recovery_stage_ratio`` per stage down to
    #: ``recovery_final_ratio``, then removed. At 1e-10 of the stiffest entry
    #: a spring is below the threshold at which ``stability`` calls an
    #: eigenvalue zero, so removing it is a small final change.
    recovery_initial_ratio: float = 1.0e-2
    recovery_stage_ratio: float = 0.1
    recovery_final_ratio: float = 1.0e-10
    #: A stage that does not converge is retried with the square root of its
    #: reduction, at most this many times in a row.
    recovery_stage_retries: int = 3
    #: Mode entries smaller than this fraction of the largest entry do not
    #: get a spring.
    mode_participation: float = 1.0e-6


@dataclass
class Outcome:
    #: ``stable``: converged at full load with a positive definite tangent.
    #: ``unstable``: verified mechanism or verified loss of stability.
    #: ``unknown``: no verified conclusion (not converged, timeout).
    state: Literal["stable", "unstable", "unknown"]
    #: Contract reason codes that apply: ``load_induced_instability``,
    #: ``geometrically_stiffened``, ``not_converged``, ``timeout``. Mechanism
    #: naming (rigid body, internal, unsupported) is the engine's job.
    reason_codes: list[str] = field(default_factory=list)
    #: Last load factor in [0, 1] with a verified stable equilibrium. For
    #: ``load_induced_instability`` this is the critical factor estimate.
    load_factor: float = 0.0
    #: Tangent classification behind the verdict: at the final state when
    #: stable, at the first unstable state found when unstable, at the
    #: reference state for a mechanism.
    assessment: stability.Assessment | None = None
    #: Equations of ``assessment``, as returned by ``Problem.equation_dofs``.
    equation_dofs: list[tuple[int, int]] = field(default_factory=list)
    steps: int = 0
    iterations: int = 0


def solve(problem: Problem, deadline: float, settings: Settings = Settings()) -> Outcome:
    """Run the nonlinear analysis of one component.

    Args:
        problem: The component to analyse.
        deadline: ``time.monotonic()`` value after which the driver must stop
            and report ``unknown`` with ``timeout``.
        settings: Work bounds.

    When the outcome is ``stable`` the OpenSees domain is left at the
    full-load equilibrium, with no temporary objects in it, so the caller can
    read displacements, reactions and element forces. For any other outcome
    the state of the domain is unspecified.

    A component with no free DOFs is reported ``stable`` without analysis
    (OpenSees cannot analyse it); its reactions are the caller's to compute.
    """
    driver = _Driver(problem, deadline, settings)
    try:
        return driver.run()
    except _Timeout:
        return driver.unverified("timeout")
    except Exception:  # noqa: BLE001 - no exception may escape the solver (A08)
        return driver.unverified("not_converged")


class _Timeout(Exception):
    """The deadline passed; unwinds to ``solve``."""


# Results of one load step.
_FAILED = "failed"
_JUMPED = "jumped"

# Newton first, because it is cheapest when it converges; line search only
# when plain Newton fails on the same step.
_ALGORITHMS = (("Newton",), ("NewtonLineSearch",))


class _Driver:
    def __init__(self, problem: Problem, deadline: float, settings: Settings) -> None:
        self.problem = problem
        self.deadline = deadline
        self.settings = settings
        self.steps = 0
        self.iterations = 0
        self.tolerance = settings.displacement_tolerance
        # Last verified stable state, reported by unknown outcomes.
        self.verified_factor = 0.0
        self.verified_assessment: stability.Assessment | None = None
        self.verified_dofs: list[tuple[int, int]] = []
        # Load factors of the verified states along the main path, from 0.
        self.path = [0.0]
        self.next_tag = problem.temp_tag_base

    # Outcomes ----------------------------------------------------------

    def outcome(
        self,
        state: Literal["stable", "unstable", "unknown"],
        codes: list[str],
        factor: float,
        assessment: stability.Assessment | None,
        dofs: list[tuple[int, int]],
    ) -> Outcome:
        return Outcome(state, codes, factor, assessment, dofs, self.steps, self.iterations)

    def unverified(self, code: str) -> Outcome:
        return self.outcome("unknown", [code], self.verified_factor, self.verified_assessment, self.verified_dofs)

    def verified(self, factor: float, assessment: stability.Assessment, dofs: list[tuple[int, int]]) -> None:
        self.verified_factor = factor
        self.verified_assessment = assessment
        self.verified_dofs = dofs

    # Main procedure ----------------------------------------------------

    def run(self) -> Outcome:
        self.check_deadline()
        self.problem.build()
        if _free_dof_count() == 0:
            return self.outcome("stable", [], 1.0, stability.Assessment(free_dofs=0), [])
        # Convergence is judged on displacements, so scale the tolerance by
        # the size of the model to make it independent of units and scale.
        self.tolerance = self.settings.displacement_tolerance * _model_size()

        self.check_deadline()
        reference, dofs = self.assess()
        if reference.negative_modes:
            # Possible only with compressive initial strain.
            return self.outcome("unstable", ["load_induced_instability"], 0.0, reference, dofs)
        if reference.mechanisms:
            if reference.mechanism_loaded:
                return self.recover(reference, dofs)
            return self.outcome("unstable", [], 0.0, reference, dofs)
        self.verified(0.0, reference, dofs)
        return self.load_path()

    def load_path(self) -> Outcome:
        """Load from 0 to 1, checking the tangent after every step."""
        settings = self.settings
        factor = 0.0
        step = settings.initial_step
        while factor < 1.0:
            self.check_deadline()
            target = min(1.0, factor + step)
            if 1.0 - target < settings.min_step:
                target = 1.0
            result = self.step(target - factor)
            if result in (_FAILED, _JUMPED):
                if result == _JUMPED and not self.rebuild_to(factor):
                    return self.unverified("not_converged")
                step *= 0.5
                if step < settings.min_step:
                    # Limit point or failure of the iteration: no evidence
                    # which (DESIGN.md, nonlinear fidelity, item 4).
                    return self.unverified("not_converged")
                continue
            previous, factor = factor, target
            self.check_deadline()
            assessment, dofs = self.assess()
            # A negative direction is the usual sign of a passed critical
            # point. A null vector without one (a cable gone slack leaving a
            # node free, or a step landing exactly on a bifurcation) is
            # treated the same way: the loaded state is not stable, and the
            # factor where it stopped being so is the critical factor.
            if not assessment.positive_definite:
                return self.bracket(previous, factor, assessment, dofs)
            self.verified(factor, assessment, dofs)
            self.path.append(factor)
            if result <= settings.fast_iterations:
                step = min(settings.max_step, step * settings.step_growth)
        return self.outcome("stable", [], 1.0, self.verified_assessment, self.verified_dofs)

    def bracket(
        self, lower: float, upper: float, first: stability.Assessment, dofs: list[tuple[int, int]]
    ) -> Outcome:
        """Bisect a critical load factor known to lie in ``(lower, upper]``.

        ``lower`` has a verified positive definite tangent and ``upper`` a
        verified tangent that is not, so the bracket stays valid even if a
        bisection step cannot be completed; the driver then reports the
        midpoint of the bracket it has.
        """
        settings = self.settings
        current = upper
        for _ in range(settings.max_bisections):
            if upper - lower <= settings.critical_factor_tolerance * upper:
                break
            self.check_deadline()
            middle = 0.5 * (lower + upper)
            if not self.march(current, middle):
                break
            current = middle
            self.check_deadline()
            assessment, _ = self.assess()
            if assessment.positive_definite:
                lower = middle
            else:
                upper = middle
        return self.outcome("unstable", ["load_induced_instability"], 0.5 * (lower + upper), first, dofs)

    # Recovery ----------------------------------------------------------

    def recover(self, reference: stability.Assessment, dofs: list[tuple[int, int]]) -> Outcome:
        """Bounded recovery of a loaded mechanism (DESIGN.md, A05).

        Any failure leaves the verified fact, the mechanism at the reference
        geometry, as the verdict.
        """
        if self.equilibrate_without_springs(reference, dofs):
            self.check_deadline()
            assessment, final_dofs = self.assess()
            if assessment.positive_definite and not self.too_far():
                return self.outcome("stable", ["geometrically_stiffened"], 1.0, assessment, final_dofs)
        return self.outcome("unstable", [], 0.0, reference, dofs)

    def equilibrate_without_springs(self, reference: stability.Assessment, dofs: list[tuple[int, int]]) -> bool:
        """Springs on, full load, springs softened in stages and removed.

        True when the full-load equilibrium with no springs was reached
        within the displacement limit. The springs are gone afterwards
        whatever happens, so no temporary object survives into results.
        """
        held = _held_dofs(reference, dofs, self.settings.mode_participation)
        translational, rotational = _diagonal_scales()
        springs = _Springs(self, held, translational, rotational)
        try:
            ratio: float | None = self.settings.recovery_initial_ratio
            springs.set(ratio)
            if not self.march(0.0, 1.0) or self.too_far():
                return False
            while ratio > self.settings.recovery_final_ratio * (1.0 + 1e-9):
                ratio = self.soften(springs, ratio)
                if ratio is None or self.too_far():
                    return False
            springs.remove()
            return self.step(0.0) not in (_FAILED, _JUMPED)
        finally:
            springs.remove()

    def soften(self, springs: _Springs, ratio: float) -> float | None:
        """Soften the springs by one stage; return the new ratio, or None on failure.

        A failed stage is reverted by OpenSees, so it can be retried with a
        smaller reduction from the same equilibrium.
        """
        settings = self.settings
        reduction = settings.recovery_stage_ratio
        for _ in range(settings.recovery_stage_retries + 1):
            self.check_deadline()
            target = max(ratio * reduction, settings.recovery_final_ratio)
            springs.set(target)
            result = self.step(0.0)
            if result == _JUMPED:
                return None
            if result != _FAILED:
                return target
            reduction = math.sqrt(reduction)
        return None

    def too_far(self) -> bool:
        # Softening springs only lets the structure move further along the
        # load, so a state already beyond the limit will not come back. This
        # bounds the work spent on a collapsing mechanism.
        return self.problem.peak_displacement() > self.problem.recovery_displacement_limit

    # Stepping ----------------------------------------------------------

    def march(self, start: float, target: float) -> bool:
        """Move from ``start`` to ``target`` with adaptive steps, no tangent checks.

        Used where the tangent is checked by the caller or irrelevant:
        bisection moves, loading with recovery springs. Returns False if
        the target cannot be reached; a jump leaves the domain on another
        branch, so the caller must not continue from it.
        """
        settings = self.settings
        factor = start
        step = min(max(abs(target - start), settings.min_step), settings.max_step)
        while factor != target:
            self.check_deadline()
            increment = math.copysign(min(step, abs(target - factor)), target - factor)
            if abs(target - (factor + increment)) < settings.min_step:
                increment = target - factor
            result = self.step(increment)
            if result == _JUMPED:
                return False
            if result == _FAILED:
                step *= 0.5
                if step < settings.min_step:
                    return False
                continue
            factor = target if increment == target - factor else factor + increment
            if result <= settings.fast_iterations:
                step = min(settings.max_step, step * settings.step_growth)
        return True

    def rebuild_to(self, factor: float) -> bool:
        """Restore the verified state at ``factor`` after the domain left its branch.

        Replays exactly the verified steps that led there, which converged on
        the right branch before and, being deterministic, do so again.
        """
        self.problem.build()
        for start, end in zip(self.path, self.path[1:]):
            if end > factor:
                break
            if not isinstance(self.step(end - start), int):
                return False
        return True

    def step(self, increment: float) -> int | str:
        """One verified load step: Newton iterations used, ``_FAILED`` or ``_JUMPED``.

        ``_FAILED`` leaves the domain where it was. ``_JUMPED`` means the
        domain was committed to a state that is not known to be on the
        branch it started from, so the caller must rebuild or give up.

        Branch check: a converged step is undone by stepping back by the same
        load increment. On the same branch of an elastic structure that
        returns to the start state; after a snap-through it does not, because
        the snapped branch has its own equilibrium at the start load (or none
        nearby). Load control cannot tell the two apart any other way: from
        far enough below a limit point, a large step can snap through with a
        perfectly ordinary looking Newton iteration (seen on a von Mises
        truss loaded to 3 and 7 times its limit load). The check costs two
        more Newton solves per step and no tangent assessment. It is skipped
        for zero increments (recovery stages), whose change is in the
        springs, not the load.
        """
        before = _displacements()
        result = self.newton(increment, before)
        if not isinstance(result, int) or increment == 0.0 or not self.settings.verify_branch:
            return result
        after = _displacements()
        if not isinstance(self.newton(-increment, after), int):
            return _JUMPED
        returned = float(np.linalg.norm(_displacements() - before))
        if returned > 1.0e-3 * float(np.linalg.norm(after - before)) + 10.0 * self.tolerance:
            return _JUMPED
        # Back at the start state, verified; take the step again. A failure
        # here leaves the domain at the start state, like any failed step.
        again = self.newton(increment, _displacements())
        return result if isinstance(again, int) else again

    def newton(self, increment: float, before: np.ndarray) -> int | str:
        """One load step without the branch check."""
        for algorithm in _ALGORITHMS:
            self.setup(increment, algorithm)
            converged = ops.analyze(1) == 0
            iterations = int(ops.testIter())
            self.iterations += iterations
            if not converged:
                continue
            self.steps += 1
            norms = [float(value) for value in ops.testNorm()[: max(iterations, 1)]]
            moved = float(np.linalg.norm(_displacements() - before))
            if not all(math.isfinite(value) for value in norms) or not math.isfinite(moved):
                return _JUMPED
            if self.jumped(norms, moved):
                return _JUMPED
            return iterations
        return _FAILED

    def jumped(self, norms: list[float], moved: float) -> bool:
        """Did Newton reach an equilibrium unrelated to the tangent predictor?

        On a smooth path the converged increment is close to the first
        correction (the predictor). Two signs that it is not:

        * Later corrections add up to many times the predictor: the
          iteration wandered off, for example snapping through a limit point.
        * The predictor is many times the converged increment: the tangent
          at the start was nearly singular (a limit point), so the predictor
          was meaningless, and whatever Newton converged to is not known to
          be on the same branch. Seen on a von Mises truss stepping from its
          limit point: predictor 8e4 m, converged increment 0.36 m, which is
          the snapped-through state.

        ``moved`` is measured over all nodal DOFs, which counts equalDOF
        duplicates twice; the ratio is loose enough for that.
        """
        ratio = self.settings.jump_ratio
        first = norms[0]
        if first <= self.tolerance:
            return False
        return sum(norms) > ratio * first or first > ratio * moved

    def setup(self, increment: float, algorithm: tuple[str, ...]) -> None:
        ops.wipeAnalysis()
        # Sparse general solver: corotational tangents are not symmetric and
        # components can be large.
        ops.system("UmfPack")
        ops.numberer("RCM")
        ops.constraints("Transformation")
        ops.test("NormDispIncr", self.tolerance, self.settings.max_iterations, 0)
        ops.algorithm(*algorithm)
        ops.integrator("LoadControl", increment)
        ops.analysis("Static")

    def assess(self) -> tuple[stability.Assessment, list[tuple[int, int]]]:
        assessment = self.problem.assess()
        return assessment, self.problem.equation_dofs()

    def check_deadline(self) -> None:
        if time.monotonic() > self.deadline:
            raise _Timeout

    def new_tag(self) -> int:
        tag = self.next_tag
        self.next_tag += 1
        return tag


class _Springs:
    """Temporary grounded springs on the DOFs of the reference mechanism modes.

    Each held node gets an anchor node at the same position, fixed in every
    DOF, joined to it by one ``zeroLength`` element with a spring on each
    held global direction. The springs are diagonal, so they also stiffen
    held DOFs in directions outside the modes; that only changes the
    intermediate states, which never reach results.
    """

    def __init__(
        self, driver: _Driver, held: dict[int, list[int]], translational: float, rotational: float
    ) -> None:
        self.driver = driver
        self.held = held
        self.translational = translational
        self.rotational = rotational
        self.anchors: dict[int, int] = {}
        self.elements: list[int] = []
        builder_ndm, builder_ndf = ops.getNDM()[0], ops.getNDF()[0]
        try:
            for node in sorted(held):
                ndm, ndf = len(ops.nodeCoord(node)), len(ops.nodeDisp(node))
                # zeroLength needs both nodes to have the same DOF count.
                ops.model("basic", "-ndm", ndm, "-ndf", ndf)
                anchor = driver.new_tag()
                ops.node(anchor, *ops.nodeCoord(node))
                ops.fix(anchor, *([1] * ndf))
                self.anchors[node] = anchor
        finally:
            # Leave the model builder as the problem set it.
            ops.model("basic", "-ndm", builder_ndm, "-ndf", builder_ndf)

    def set(self, ratio: float) -> None:
        """Replace the springs with springs of ``ratio`` times the reference scales."""
        self.remove_elements()
        translation = self.driver.new_tag()
        rotation = self.driver.new_tag()
        ops.uniaxialMaterial("Elastic", translation, ratio * self.translational)
        ops.uniaxialMaterial("Elastic", rotation, ratio * self.rotational)
        for node, directions in sorted(self.held.items()):
            ndm = len(ops.nodeCoord(node))
            materials = [translation if direction <= ndm else rotation for direction in directions]
            element = self.driver.new_tag()
            ops.element("zeroLength", element, self.anchors[node], node, "-mat", *materials, "-dir", *directions)
            self.elements.append(element)

    def remove_elements(self) -> None:
        for element in self.elements:
            ops.remove("element", element)
        self.elements = []

    def remove(self) -> None:
        """Take every temporary object out of the domain. Safe to call twice."""
        self.remove_elements()
        for anchor in self.anchors.values():
            for dof in range(1, len(ops.nodeDisp(anchor)) + 1):
                ops.remove("sp", anchor, dof)
            ops.remove("node", anchor)
        self.anchors = {}


def _held_dofs(
    assessment: stability.Assessment, dofs: list[tuple[int, int]], participation: float
) -> dict[int, list[int]]:
    """Nodal directions that take part in any mechanism mode."""
    held: dict[int, set[int]] = {}
    for mode in assessment.translational_modes + assessment.rotational_modes:
        peak = float(np.max(np.abs(mode)))
        for index in np.flatnonzero(np.abs(mode) > participation * peak):
            node, dof = dofs[int(index)]
            held.setdefault(node, set()).add(dof)
    return {node: sorted(directions) for node, directions in held.items()}


def _diagonal_scales() -> tuple[float, float]:
    """Largest translational and rotational diagonal entries of the current tangent.

    Reads the tangent directly rather than through ``Problem`` because only
    these two scales are needed, not the equation order. Nodes on the
    constrained side of an ``equalDOF`` are skipped: their equation numbers
    are not reported reliably (see ``tangent.equation_numbers``).
    """
    matrix = tangent.extract_tangent()
    diagonal = np.abs(np.diag(matrix))
    constrained = set(ops.getConstrainedNodes())
    translational = rotational = 0.0
    for node in ops.getNodeTags():
        if node in constrained:
            continue
        ndm = len(ops.nodeCoord(node))
        for dof, equation in enumerate(tangent.equation_numbers(node)):
            if 0 <= equation < diagonal.size:
                if dof < ndm:
                    translational = max(translational, float(diagonal[equation]))
                else:
                    rotational = max(rotational, float(diagonal[equation]))
    # A pure rotation model or a pure translation model has only one scale;
    # an unused scale is never applied, but must be a valid material value.
    translational = translational or rotational or 1.0
    rotational = rotational or translational
    return translational, rotational


def _displacements() -> np.ndarray:
    """All nodal displacements, concatenated in tag order."""
    values = [value for node in ops.getNodeTags() for value in ops.nodeDisp(node)]
    return np.array(values, dtype=float)


def _free_dof_count() -> int:
    constrained = {node: set(ops.getConstrainedDOFs(node)) for node in ops.getConstrainedNodes()}
    fixed = {node: set(ops.getFixedDOFs(node)) for node in ops.getFixedNodes()}
    free = 0
    for node in ops.getNodeTags():
        blocked = fixed.get(node, set()) | constrained.get(node, set())
        free += len(ops.nodeDisp(node)) - len(blocked)
    return free


def _model_size() -> float:
    """Diagonal of the bounding box of all nodes, at least 1 m when degenerate."""
    coordinates = [ops.nodeCoord(node) for node in ops.getNodeTags()]
    if not coordinates:
        return 1.0
    width = max(len(c) for c in coordinates)
    points = np.array([list(c) + [0.0] * (width - len(c)) for c in coordinates])
    size = float(np.linalg.norm(points.max(axis=0) - points.min(axis=0)))
    return size if size > 0.0 else 1.0
