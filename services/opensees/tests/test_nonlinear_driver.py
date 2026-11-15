"""Nonlinear driver against closed-form references.

Every expected value is derived in the comment next to it from the model's
own data; none is taken from a solver run. Gates from the solver criteria
(section 7): 2% on buckling loads, 1% on other nonlinear reference
quantities.

The problems are hand-built OpenSees models (``nonlinear_problems``), so a
failure here points at the driver, not at the engine.
"""

from __future__ import annotations

import math
import time

import numpy as np
import openseespy.opensees as ops
import pytest

import nonlinear_problems as nlp
from dof_opensees import nonlinear, stability

BUCKLING_GATE = 0.02
NONLINEAR_GATE = 0.01


def solve(problem: nlp.HandBuilt, **settings: float) -> nonlinear.Outcome:
    return nonlinear.solve(problem, time.monotonic() + 30.0, nonlinear.Settings(**settings))


def relative_error(value: float, expected: float) -> float:
    return abs(value / expected - 1.0)


# Segments per column: the smallest count that meets the 2% gate with
# elasticBeamColumn + Corotational (see the formulation study in the driver
# report): 8 per buckling half-wave length for pinned and cantilever columns,
# 16 for a fixed-fixed column, whose half-wave is half the member.
COLUMNS = [("pinned", 8), ("cantilever", 8), ("fixed", 16)]


# Columns -----------------------------------------------------------------


@pytest.mark.parametrize(("ends", "segments"), COLUMNS)
def test_perfect_column_beyond_euler_load_buckles_at_euler_load(ends: str, segments: int) -> None:
    # Euler: P_cr = pi^2 EI / (K L)^2 with K = 1 (pinned), 2 (cantilever),
    # 0.5 (fixed-fixed). The column is loaded with P = 2 P_cr, so the
    # critical load factor is P_cr / P = 0.5.
    pcr = nlp.euler_load(ends)
    problem = nlp.column(ends, segments, 2.0 * pcr)

    outcome = solve(problem)

    assert outcome.state == "unstable"
    assert outcome.reason_codes == ["load_induced_instability"]
    assert relative_error(outcome.load_factor, 0.5) <= BUCKLING_GATE
    # The buckling shape is a lateral translation, not axial motion; a
    # doubly symmetric section buckles in X and Y at once.
    assert outcome.assessment is not None and outcome.assessment.negative_modes
    for mode in outcome.assessment.negative_modes:
        _, dof = outcome.equation_dofs[int(np.argmax(np.abs(mode)))]
        assert dof in (1, 2)


@pytest.mark.parametrize(("ends", "segments"), COLUMNS)
def test_perfect_column_at_half_euler_load_is_stable(ends: str, segments: int) -> None:
    problem = nlp.column(ends, segments, 0.5 * nlp.euler_load(ends))

    outcome = solve(problem)

    assert outcome.state == "stable"
    assert outcome.reason_codes == []
    assert outcome.load_factor == 1.0
    assert outcome.assessment is not None and outcome.assessment.positive_definite


def test_imperfect_column_deflection_is_amplified_by_one_over_one_minus_p_over_pe() -> None:
    # A pin-ended column with initial bow e0 sin(pi z / L) under axial P has
    # total midspan offset e0 / (1 - P/Pe) (Timoshenko & Gere 1.11), so the
    # added deflection is e0 (P/Pe) / (1 - P/Pe). At P = Pe/2 that is e0.
    # 16 segments: the 2% gate's 8 segments under-predict this by about 2.5%
    # (study in the driver report), part of it the polygonal imperfection.
    e0 = nlp.COLUMN_LENGTH / 1000.0
    ratio = 0.5
    segments = 16
    problem = nlp.column("pinned", segments, ratio * nlp.euler_load("pinned"), bow=e0)

    outcome = solve(problem)

    assert outcome.state == "stable"
    midspan = ops.nodeDisp(segments // 2 + 1, 1)
    assert relative_error(midspan, e0 * ratio / (1.0 - ratio)) <= NONLINEAR_GATE


def test_cantilever_sway_under_vertical_and_small_lateral_load_matches_beam_column_formula() -> None:
    # Cantilever with axial compression P and tip lateral force H: with
    # k = sqrt(P / EI), EI y'' = P (d - y) + H (L - z), y(0) = y'(0) = 0,
    # gives the tip deflection d = H / (P k) (tan kL - kL) (Timoshenko & Gere
    # 1.4). It tends to H L^3 / 3EI as P -> 0. P is half the cantilever's
    # Euler load and H = P / 1000, so d / L is about 1e-3 and large-rotation
    # terms, of order (d / L)^2, are far below the gate.
    axial = 0.5 * nlp.euler_load("cantilever")
    lateral = 1.0e-3 * axial
    k = math.sqrt(axial / nlp.EI)
    length = nlp.COLUMN_LENGTH
    expected = lateral / (axial * k) * (math.tan(k * length) - k * length)
    segments = 8
    problem = nlp.column("cantilever", segments, axial, lateral=lateral)

    outcome = solve(problem)

    assert outcome.state == "stable"
    assert relative_error(ops.nodeDisp(segments + 1, 1), expected) <= NONLINEAR_GATE


def _elastica_tip(alpha: float) -> tuple[float, float]:
    """Tip of a cantilever elastica under a transverse tip load, alpha = P L^2 / EI.

    With arc length s in [0, 1] (units of L) and theta the slope from the
    original axis, the moment balance EI theta' = P (z_tip - z(s))
    differentiates to theta'' = -alpha cos(theta), with theta(0) = 0 and no
    tip moment, theta'(1) = 0. The position follows from x' = sin(theta),
    z' = cos(theta). Shooting on theta'(0) (in [0, alpha] because the moment
    arm is at most L) with classical RK4 on 500 steps, whose error (order
    h^4) is far below the gate. Returns the tip deflection and the axial
    shortening, both over L.
    """
    steps = 500
    h = 1.0 / steps

    def integrate(start_curvature: float) -> tuple[float, float, float, float]:
        theta, curvature, x, z = 0.0, start_curvature, 0.0, 0.0
        for _ in range(steps):
            # RK4 on (theta, theta', x, z); x and z depend on theta only.
            t1, c1 = theta, curvature
            t2, c2 = theta + 0.5 * h * c1, curvature - 0.5 * h * alpha * math.cos(t1)
            t3, c3 = theta + 0.5 * h * c2, curvature - 0.5 * h * alpha * math.cos(t2)
            t4, c4 = theta + h * c3, curvature - h * alpha * math.cos(t3)
            theta += h / 6.0 * (c1 + 2.0 * c2 + 2.0 * c3 + c4)
            curvature -= h / 6.0 * alpha * (math.cos(t1) + 2.0 * math.cos(t2) + 2.0 * math.cos(t3) + math.cos(t4))
            x += h / 6.0 * (math.sin(t1) + 2.0 * math.sin(t2) + 2.0 * math.sin(t3) + math.sin(t4))
            z += h / 6.0 * (math.cos(t1) + 2.0 * math.cos(t2) + 2.0 * math.cos(t3) + math.cos(t4))
        return theta, curvature, x, z

    lower, upper = 0.0, alpha
    for _ in range(40):
        middle = 0.5 * (lower + upper)
        if integrate(middle)[1] > 0.0:
            upper = middle
        else:
            lower = middle
    _, _, x, z = integrate(0.5 * (lower + upper))
    return x, 1.0 - z


def test_cantilever_large_deflection_matches_the_elastica() -> None:
    # alpha = P L^2 / EI = 2 deflects the tip by about half the length: a
    # large-rotation check of the corotational path and of step control.
    alpha = 2.0
    deflection, shortening = _elastica_tip(alpha)
    segments = 8
    problem = nlp.column("cantilever", segments, 0.0, lateral=alpha * nlp.EI / nlp.COLUMN_LENGTH**2)

    outcome = solve(problem)

    assert outcome.state == "stable"
    tip = ops.nodeDisp(segments + 1)
    assert relative_error(tip[0], deflection * nlp.COLUMN_LENGTH) <= NONLINEAR_GATE
    assert relative_error(-tip[2], shortening * nlp.COLUMN_LENGTH) <= NONLINEAR_GATE


# Cables ------------------------------------------------------------------


def test_taut_cable_shares_load_with_a_collinear_bar() -> None:
    # Load P along -X: the node moves u = -P a / (EA_cable + EA_bar), the
    # cable is stretched and carries EA u / a in tension. Both members have
    # the same EA, so u = -P a / (2 EA) and the cable force is P / 2. The
    # transverse bar only adds terms of order (u / a)^2 ~ 1e-9.
    load, span = 1000.0, 2.0
    problem = nlp.braced_cable(-load, span)

    outcome = solve(problem)

    assert outcome.state == "stable"
    assert relative_error(ops.nodeDisp(1, 1), -load * span / (2.0 * nlp.CABLE_EA)) <= NONLINEAR_GATE
    assert relative_error(ops.basicForce(1)[0], load / 2.0) <= NONLINEAR_GATE


def test_slack_cable_carries_no_compression_and_the_bar_carries_the_load() -> None:
    # Load P along +X would compress the cable, which goes slack: only the
    # collinear bar resists, in tension P, u = P a / EA_bar, and the cable
    # force is zero.
    load, span = 1000.0, 2.0
    problem = nlp.braced_cable(load, span)

    outcome = solve(problem)

    assert outcome.state == "stable"
    assert relative_error(ops.nodeDisp(1, 1), load * span / nlp.CABLE_EA) <= NONLINEAR_GATE
    assert ops.basicForce(1)[0] == 0.0
    assert relative_error(ops.basicForce(2)[0], load) <= NONLINEAR_GATE


def _pair_load(deflection: float, prestrain: float, span: float) -> float:
    """Transverse load in equilibrium with a straight cable pair deflected by ``deflection``.

    Each cable has length l = sqrt(a^2 + d^2), engineering strain (l - a)/a
    plus the initial strain, tension T = EA (eps0 + (l - a)/a), and the two
    vertical components balance the load: P = 2 T d / l.
    """
    stretched = math.hypot(span, deflection)
    tension = nlp.CABLE_EA * (prestrain + (stretched - span) / span)
    return 2.0 * tension * deflection / stretched


def _pair_deflection(load: float, prestrain: float, span: float) -> float:
    """Invert ``_pair_load`` by bisection; P(d) increases monotonically."""
    lower, upper = 0.0, span
    for _ in range(200):
        middle = 0.5 * (lower + upper)
        if _pair_load(middle, prestrain, span) < load:
            lower = middle
        else:
            upper = middle
    return 0.5 * (lower + upper)


def test_pretensioned_cable_pair_has_transverse_stiffness_two_n0_over_a() -> None:
    # Small deflection: the tension stays N0 to first order, so P = 2 N0 d / a.
    # With N0 = 10 kN, a = 2 m and P = 1 N, d = 1e-4 m; the strain change
    # (d/a)^2 / 2 ~ 1e-9 is negligible next to eps0 ~ 5e-4.
    n0, span, load = 10.0e3, 2.0, 1.0
    problem = nlp.straight_pair(load, n0 / nlp.CABLE_EA, span=span)

    outcome = solve(problem)

    assert outcome.state == "stable"
    assert outcome.reason_codes == []
    assert relative_error(-ops.nodeDisp(1, 2), load * span / (2.0 * n0)) <= NONLINEAR_GATE


def test_pretensioned_cable_pair_large_deflection_matches_exact_equilibrium() -> None:
    # Exact equilibrium of ``_pair_load`` for P = 2 kN: d is about 4% of the
    # span, where the small-deflection stiffness would be 25% off.
    n0, span, load = 10.0e3, 2.0, 2000.0
    prestrain = n0 / nlp.CABLE_EA
    expected = _pair_deflection(load, prestrain, span)
    problem = nlp.straight_pair(load, prestrain, span=span)

    outcome = solve(problem)

    assert outcome.state == "stable"
    assert relative_error(-ops.nodeDisp(1, 2), expected) <= NONLINEAR_GATE
    stretched = math.hypot(span, expected)
    tension = nlp.CABLE_EA * (prestrain + (stretched - span) / span)
    assert relative_error(ops.basicForce(1)[0], tension) <= NONLINEAR_GATE


def test_unpretensioned_cable_under_transverse_load_is_recovered_to_its_exact_equilibrium() -> None:
    # Without pretension the transverse stiffness at the reference state is
    # exactly zero: a loaded mechanism, solved through recovery. Choose the
    # deflection d = a / 20, inside the recovery limit of a / 10; the exact
    # two-bar equilibrium then gives T = EA (sqrt(a^2 + d^2) - a) / a and
    # P = 2 T d / sqrt(a^2 + d^2) (``_pair_load`` with eps0 = 0). The driver
    # must find that d and T back.
    span = 2.0
    deflection = span / 20.0
    load = _pair_load(deflection, 0.0, span)
    tension = nlp.CABLE_EA * (math.hypot(span, deflection) - span) / span
    problem = nlp.straight_pair(load, 0.0, span=span)

    outcome = solve(problem)

    assert outcome.state == "stable"
    assert outcome.reason_codes == ["geometrically_stiffened"]
    assert outcome.load_factor == 1.0
    assert outcome.assessment is not None and outcome.assessment.positive_definite
    assert relative_error(-ops.nodeDisp(1, 2), deflection) <= NONLINEAR_GATE
    assert relative_error(ops.basicForce(1)[0], tension) <= NONLINEAR_GATE
    assert relative_error(ops.basicForce(2)[0], tension) <= NONLINEAR_GATE


def test_recovered_domain_has_no_temporary_objects_and_results_can_be_read() -> None:
    span = 2.0
    load = _pair_load(span / 20.0, 0.0, span)
    problem = nlp.straight_pair(load, 0.0, span=span)

    outcome = solve(problem)

    assert outcome.state == "stable"
    assert list(ops.getNodeTags()) == problem.node_tags
    assert list(ops.getEleTags()) == problem.element_tags
    assert list(ops.getFixedNodes()) == problem.fixed_nodes
    assert list(ops.getNDF()) == problem.builder_ndf
    assert all(tag < problem.temp_tag_base for tag in ops.getNodeTags() + ops.getEleTags())
    # Reactions balance the load exactly when nothing artificial holds the
    # node: the two supports share the vertical load.
    ops.reactions()
    vertical = ops.nodeReaction(2, 2) + ops.nodeReaction(3, 2)
    assert relative_error(vertical, load) <= 1e-5


# Prestress that is not self-equilibrated at the reference geometry --------

GUY_PRESTRAIN = 4.34e-4  # as in the game's guyed mast fixture


def _guyed_mast_reference(load: float, prestrain: float, height: float = 12.0, offset: float = 6.0):
    """Top settlement, guy tension and mast force of ``nlp.guyed_mast``.

    By symmetry the top only moves down, by d. The mast shortens by d, so its
    compression is N = (EA_m / H) d. Each guy, of length l = sqrt(H^2 + b^2)
    and vertical direction cosine c = H / l, shortens by d c, so its tension
    is T = EA_g (eps0 - d c / l). Vertical equilibrium of the top,
    N = 2 T c + P, gives

        d = (2 c EA_g eps0 + P) / (EA_m / H + 2 c^2 EA_g / l).

    Small-displacement compatibility: the terms dropped are of relative order
    d / H (about 2e-5 here). The mast stays straight, so bending plays no part.
    """
    length = math.hypot(height, offset)
    c = height / length
    mast = nlp.E * nlp.MAST_A / height
    settlement = (2.0 * c * nlp.CABLE_EA * prestrain + load) / (mast + 2.0 * c**2 * nlp.CABLE_EA / length)
    tension = nlp.CABLE_EA * (prestrain - settlement * c / length)
    return settlement, tension, -(2.0 * tension * c + load)


@pytest.mark.parametrize("load", [0.0, 10.0e3])
def test_guyed_mast_prestress_compresses_the_mast_by_compatibility(load: float) -> None:
    settlement, tension, mast_force = _guyed_mast_reference(load, GUY_PRESTRAIN)
    segments = 6
    problem = nlp.guyed_mast(load, GUY_PRESTRAIN, segments=segments)

    outcome = solve(problem)

    assert outcome.state == "stable"
    assert outcome.reason_codes == []
    assert outcome.load_factor == 1.0
    top = segments + 1
    assert relative_error(-ops.nodeDisp(top, 2), settlement) <= NONLINEAR_GATE
    assert relative_error(ops.basicForce(segments + 1)[0], tension) <= NONLINEAR_GATE
    assert relative_error(ops.basicForce(segments + 2)[0], tension) <= NONLINEAR_GATE
    for element in range(1, segments + 1):
        assert relative_error(ops.basicForce(element)[0], mast_force) <= NONLINEAR_GATE


def test_prestress_that_buckles_the_mast_is_unstable_at_factor_zero() -> None:
    # With I = 1e-7 m^4 the mast's buckling load is at most the fixed-fixed
    # value 4 pi^2 EI / H^2 = 5.8 kN, whatever restraint the guys give the
    # top, while the guys alone compress it by 2 T c = 16 kN (reference
    # above). The prestressed equilibrium exists (the mast stays straight)
    # but is unstable before any load is applied.
    inertia = 1.0e-7
    assert -_guyed_mast_reference(0.0, GUY_PRESTRAIN)[2] > 2.0 * 4.0 * math.pi**2 * nlp.E * inertia / 12.0**2
    problem = nlp.guyed_mast(10.0e3, GUY_PRESTRAIN, inertia=inertia)

    outcome = solve(problem)

    assert outcome.state == "unstable"
    assert outcome.reason_codes == ["load_induced_instability"]
    assert outcome.load_factor == 0.0
    assert outcome.assessment is not None and not outcome.assessment.positive_definite


def _single_guy_equilibrium(prestrain: float) -> np.ndarray:
    """Displacement of node 1 of ``nlp.single_guy`` at its prestress equilibrium.

    Exact large-displacement equations of the three pin-jointed bars, solved
    with numpy (no OpenSees): a bar from fixed point p to node 1 at r has
    length l = |r - p|, force N = EA ((l - l0) / l0 + eps0), the cable
    carrying max(N, 0), and pulls node 1 by -N (r - p) / l. Newton on the
    sum of the three forces, with a central-difference Jacobian.
    """
    nodes = nlp.SINGLE_GUY_NODES
    start = np.array(nodes[1])
    members = [(np.array(nodes[2]), 0.0, False), (np.array(nodes[3]), 0.0, False), (np.array(nodes[4]), prestrain, True)]

    def residual(u: np.ndarray) -> np.ndarray:
        r = start + u
        total = np.zeros(2)
        for p, eps0, cable in members:
            l0, l = float(np.linalg.norm(start - p)), float(np.linalg.norm(r - p))
            force = nlp.CABLE_EA * ((l - l0) / l0 + eps0)
            total -= (max(force, 0.0) if cable else force) * (r - p) / l
        return total

    u = np.zeros(2)
    for _ in range(50):
        h = 1.0e-9
        jacobian = np.column_stack([(residual(u + h * e) - residual(u - h * e)) / (2 * h) for e in np.eye(2)])
        u = u - np.linalg.solve(jacobian, residual(u))
    return u


def test_one_sided_guy_moves_the_top_sideways_to_its_prestress_equilibrium() -> None:
    # The cable pulls node 1 towards (3, 0): down against the post and
    # sideways against the bar. Nothing is loaded; the result is the
    # prestress equilibrium alone.
    prestrain = 1.0e-3
    expected = _single_guy_equilibrium(prestrain)
    assert expected[0] > 0.0 and expected[1] < 0.0
    problem = nlp.single_guy(prestrain)

    outcome = solve(problem)

    assert outcome.state == "stable"
    displacement = ops.nodeDisp(1)
    assert relative_error(displacement[0], expected[0]) <= NONLINEAR_GATE
    assert relative_error(displacement[1], expected[1]) <= NONLINEAR_GATE


# Mechanisms and instability at the reference state ------------------------


def test_compressive_initial_strain_is_unstable_at_the_reference_state() -> None:
    # Two collinear bars with compressive initial strain have transverse
    # stiffness 2 N / a < 0 before any load: a negative direction at factor 0.
    problem = nlp.straight_pair(10.0, -1.0e-4, tension_only=False)

    outcome = solve(problem)

    assert outcome.state == "unstable"
    assert outcome.reason_codes == ["load_induced_instability"]
    assert outcome.load_factor == 0.0
    assert outcome.steps == 0


def test_loaded_mechanism_without_nearby_equilibrium_is_unstable() -> None:
    # A pin-jointed portal pushed sideways racks freely. Its only equilibrium
    # is the frame lying flat, displaced by about the post height, far
    # beyond the recovery limit, so recovery must be rejected.
    problem = nlp.four_bar(lateral=10.0e3, vertical=0.0)

    outcome = solve(problem)

    assert outcome.state == "unstable"
    assert outcome.reason_codes == []
    assert outcome.load_factor == 0.0
    assert outcome.assessment is not None
    assert outcome.assessment.mechanisms == 1 and outcome.assessment.mechanism_loaded
    assert outcome.steps > 0  # recovery was attempted


def test_unloaded_mechanism_is_unstable_without_recovery() -> None:
    # Vertical loads on the posts do no work on the sway mode.
    problem = nlp.four_bar(lateral=0.0, vertical=10.0e3)

    outcome = solve(problem)

    assert outcome.state == "unstable"
    assert outcome.reason_codes == []
    assert outcome.assessment is not None and not outcome.assessment.mechanism_loaded
    assert outcome.steps == 0 and outcome.iterations == 0
    assert problem.builds == 1


# Limit point, deadlines, failures ----------------------------------------


def _shallow_truss_limit_load(half_span: float, rise: float) -> float:
    """Largest load on the symmetric path of a von Mises truss.

    Apex lowered by w: bar length l = sqrt(a^2 + (h - w)^2), compression
    N = EA (l0 - l) / l0, and vertical equilibrium P = 2 N (h - w) / l.
    The maximum over 0 < w < h is found by dense sampling then golden
    section, far finer than the gate.
    """
    initial = math.hypot(half_span, rise)

    def load(w: float) -> float:
        length = math.hypot(half_span, rise - w)
        return 2.0 * nlp.CABLE_EA * (initial - length) / initial * (rise - w) / length

    samples = np.linspace(0.0, rise, 10001)
    best = int(np.argmax([load(w) for w in samples]))
    lower, upper = samples[max(best - 1, 0)], samples[min(best + 1, samples.size - 1)]
    golden = (math.sqrt(5.0) - 1.0) / 2.0
    for _ in range(100):
        left, right = upper - golden * (upper - lower), lower + golden * (upper - lower)
        if load(left) < load(right):
            lower = left
        else:
            upper = right
    return load(0.5 * (lower + upper))


@pytest.mark.parametrize("overload", [1.3, 2.0, 7.0])
def test_load_beyond_a_limit_point_is_not_converged_at_the_limit(overload: float) -> None:
    # Loaded beyond its limit load, the truss can only snap through, which
    # load control cannot follow and the service does not simulate. The last
    # verified factor must lie just below the limit factor 1 / overload. At 7
    # times the limit the very first step lands beyond the limit, where the
    # only equilibrium is the inverted truss: it must not be reported stable.
    half_span, rise = 2.0, 0.2
    limit = _shallow_truss_limit_load(half_span, rise)
    problem = nlp.shallow_truss(overload * limit, half_span, rise)

    outcome = solve(problem)

    assert outcome.state == "unknown"
    assert outcome.reason_codes == ["not_converged"]
    assert outcome.load_factor <= 1.0 / overload
    assert relative_error(outcome.load_factor, 1.0 / overload) <= NONLINEAR_GATE


def test_past_deadline_returns_timeout_without_work() -> None:
    problem = nlp.column("pinned", 8, 2.0 * nlp.euler_load("pinned"))
    started = time.perf_counter()

    outcome = nonlinear.solve(problem, time.monotonic() - 1.0)

    assert time.perf_counter() - started < 0.1
    assert outcome.state == "unknown"
    assert outcome.reason_codes == ["timeout"]
    assert problem.builds == 0


def test_deadline_passing_during_the_analysis_returns_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    # A clock that advances one unit per reading: the deadline passes after a
    # few checks, wherever they are, without depending on machine speed.
    class Clock:
        now = 0.0

        def monotonic(self) -> float:
            self.now += 1.0
            return self.now

    monkeypatch.setattr(nonlinear, "time", Clock())
    problem = nlp.column("pinned", 8, 2.0 * nlp.euler_load("pinned"))

    outcome = nonlinear.solve(problem, 6.5)

    assert outcome.state == "unknown"
    assert outcome.reason_codes == ["timeout"]
    assert 0.0 <= outcome.load_factor < 1.0


def test_unexpected_exception_is_a_solver_error_not_a_convergence_failure() -> None:
    class Failing(nlp.HandBuilt):
        def assess(self):  # type: ignore[override]
            raise RuntimeError("simulated programming error")

    reference = nlp.column("pinned", 4, 1.0)
    problem = Failing(reference.define, reference.recovery_displacement_limit)

    outcome = solve(problem)

    assert outcome.state == "unknown"
    assert outcome.reason_codes == ["solver_error"]


class _CholeskyOnly(nlp.HandBuilt):
    """Answers like the engine's fast test: not positive definite, no spectrum."""

    def __init__(self, base: nlp.HandBuilt, from_call: int) -> None:
        super().__init__(base.define, base.recovery_displacement_limit)
        self.calls = 0
        self.from_call = from_call

    def assess(self) -> stability.Assessment:  # type: ignore[override]
        self.calls += 1
        assessment = super().assess()
        if self.calls >= self.from_call and not assessment.positive_definite:
            return stability.Assessment(free_dofs=assessment.free_dofs, indefinite=True)
        return assessment


def test_indefinite_loaded_state_without_modes_still_brackets_the_critical_load() -> None:
    # Same reference as the perfect pinned column test: critical factor 0.5.
    # Every loaded assessment that is not positive definite comes back as
    # ``indefinite`` with empty mode lists.
    pcr = nlp.euler_load("pinned")
    problem = _CholeskyOnly(nlp.column("pinned", 8, 2.0 * pcr), from_call=2)

    outcome = solve(problem)

    assert outcome.state == "unstable"
    assert outcome.reason_codes == ["load_induced_instability"]
    assert relative_error(outcome.load_factor, 0.5) <= BUCKLING_GATE
    assert outcome.assessment is not None and outcome.assessment.indefinite


def test_indefinite_reference_state_is_not_loaded_on_as_if_stable() -> None:
    # Compressive initial strain makes the reference unstable; reported as
    # ``indefinite`` without its spectrum, the driver cannot name the
    # reference verdict and must not continue loading.
    problem = _CholeskyOnly(nlp.straight_pair(10.0, -1.0e-4, tension_only=False), from_call=1)

    outcome = solve(problem)

    assert outcome.state == "unknown"
    assert outcome.reason_codes == ["solver_error"]
    assert outcome.steps == 0


def test_component_without_free_dofs_is_stable_without_analysis() -> None:
    # OpenSees crashes the process on a system with no equations; the driver
    # must not get that far.
    outcome = solve(nlp.fully_fixed_bar(10.0))

    assert outcome.state == "stable"
    assert outcome.assessment is not None and outcome.assessment.free_dofs == 0


def test_same_problem_gives_the_same_outcome() -> None:
    def run() -> nonlinear.Outcome:
        return solve(nlp.column("pinned", 8, 2.0 * nlp.euler_load("pinned")))

    first, second = run(), run()

    assert (first.state, first.reason_codes, first.load_factor) == (
        second.state,
        second.reason_codes,
        second.load_factor,
    )
    assert (first.steps, first.iterations) == (second.steps, second.iterations)
    assert first.equation_dofs == second.equation_dofs
    assert first.assessment is not None and second.assessment is not None
    assert len(first.assessment.negative_modes) == len(second.assessment.negative_modes)
    for a, b in zip(first.assessment.negative_modes, second.assessment.negative_modes):
        assert np.array_equal(a, b)


# Cable at exactly zero strain at the reference (audit D2) -----------------


def test_cable_braced_portal_activates_its_cable_from_zero_strain() -> None:
    # Statics of the pin-jointed portal: only the diagonal cable can resist
    # the lateral load H, so its horizontal component carries it all:
    # T * (width / diagonal) = H, T = H * 5 / 4 = 1250 N for H = 1 kN on a
    # 4 x 3 frame. Second-order terms are of order the sway over the height
    # (about 1e-6). Every load step starts the branch check's return next to
    # the cable's kink at zero strain; it used to be read as a jump.
    problem = nlp.cable_braced_portal(1000.0)

    outcome = solve(problem)

    assert outcome.state == "stable"
    assert relative_error(ops.basicForce(4)[0], 1250.0) <= NONLINEAR_GATE


# One-step fast path ---------------------------------------------------------


def _cantilever_tip_linear(lateral: float) -> float:
    # Linear cantilever: tip deflection H L^3 / (3 EI).
    return lateral * nlp.COLUMN_LENGTH**3 / (3.0 * nlp.EI)


def test_fast_path_is_taken_on_a_lightly_loaded_cantilever() -> None:
    # Tip deflection about L / 4000: geometric effects of order (d / L)^2.
    lateral = 1.0e3
    expected = _cantilever_tip_linear(lateral)
    problem = nlp.column("cantilever", 8, 0.0, lateral=lateral)

    outcome = solve(problem, expected_peak_displacement=expected)

    assert outcome.state == "stable" and outcome.load_factor == 1.0
    assert outcome.steps <= 2 and outcome.iterations <= 6  # prestress stage + one step
    assert relative_error(ops.nodeDisp(9, 1), expected) <= NONLINEAR_GATE


def test_fast_path_with_a_wrong_expectation_falls_back_to_the_right_answer() -> None:
    lateral = 1.0e3
    truth = _cantilever_tip_linear(lateral)
    problem = nlp.column("cantilever", 8, 0.0, lateral=lateral)

    outcome = solve(problem, expected_peak_displacement=2.0 * truth)

    assert outcome.state == "stable"
    assert outcome.steps > 2  # careful stepping ran
    assert relative_error(ops.nodeDisp(9, 1), truth) <= NONLINEAR_GATE


def test_fast_path_is_refused_for_an_amplified_column_near_its_euler_load() -> None:
    # Bowed pin-ended column at 0.9 P_e. The linear solution has no lateral
    # response to an axial load: its peak is the axial shortening P L / EA.
    # The nonlinear added midspan deflection is e0 * 0.9 / 0.1 = 9 e0, so
    # the two cannot agree and the driver must step carefully.
    e0 = nlp.COLUMN_LENGTH / 1000.0
    axial = 0.9 * nlp.euler_load("pinned")
    shortening = axial * nlp.COLUMN_LENGTH / (nlp.E * nlp.COLUMN_A)
    problem = nlp.column("pinned", 16, axial, bow=e0)

    outcome = solve(problem, expected_peak_displacement=shortening)

    assert outcome.state == "stable"
    assert outcome.steps > 2
    assert relative_error(ops.nodeDisp(9, 1), 9.0 * e0) <= 0.05  # gate widened: 1/(1-a) magnifies mesh error tenfold


def test_fast_path_is_refused_for_a_perfect_column_past_its_euler_load() -> None:
    # Straight column at 2 P_e: one step converges on the straight primary
    # path and its peak (the shortening) agrees with the linear one, but the
    # tangent there is indefinite, so the fast path must still be refused.
    axial = 2.0 * nlp.euler_load("pinned")
    shortening = axial * nlp.COLUMN_LENGTH / (nlp.E * nlp.COLUMN_A)
    problem = nlp.column("pinned", 8, axial)

    outcome = solve(problem, expected_peak_displacement=shortening)

    assert outcome.state == "unstable"
    assert outcome.reason_codes == ["load_induced_instability"]
    assert relative_error(outcome.load_factor, 0.5) <= BUCKLING_GATE


def test_fast_path_is_refused_near_a_limit_point() -> None:
    # Von Mises truss at 0.95 of its limit load. Linear apex deflection:
    # P / k0 with k0 = 2 (EA / l0) (h / l0)^2, the vertical stiffness of the
    # two bars at the reference. Near the limit point the truss is far
    # softer than k0, so the nonlinear deflection is well above P / k0.
    half_span, rise = 2.0, 0.2
    load = 0.95 * _shallow_truss_limit_load(half_span, rise)
    length = math.hypot(half_span, rise)
    linear = load / (2.0 * nlp.CABLE_EA / length * (rise / length) ** 2)
    problem = nlp.shallow_truss(load, half_span, rise)

    outcome = solve(problem, expected_peak_displacement=linear)

    assert outcome.state == "stable"
    assert outcome.steps > 2
    assert -ops.nodeDisp(1, 2) > 1.5 * linear


# Engine level: beam end joined through a duplicate node (audit D1) ----------


def test_engine_propped_cantilever_with_a_ball_end_solves_at_nonlinear_fidelity() -> None:
    # Fixed at a, roller at b, P at midspan: R_b = 5 P / 16 (propped
    # cantilever). The end at b is a ball joint, a duplicate node tied to the
    # support by equalDOF; before the builder fix every nonlinear step
    # sequence failed there.
    from dof_opensees.engine import analyze
    from dof_opensees.schema import StructuralModel

    load = 20.0e3
    model = {
        "units": "SI",
        "nodes": [{"id": "a", "position": [0, 0, 0]}, {"id": "m", "position": [3, 0, 0]}, {"id": "b", "position": [6, 0, 0]}],
        "members": [{"id": "am", "startNodeId": "a", "endNodeId": "m"},
                    {"id": "mb", "startNodeId": "m", "endNodeId": "b", "endFixity": "pinned"}],
        "supports": [{"nodeId": "a", "restrained": [True] * 6},
                     {"nodeId": "b", "restrained": [False, True, True, False, False, False]}],
        "loads": [{"nodeId": "m", "force": [0, 0, -load], "moment": [0, 0, 0]}],
        "analysis": {"fidelity": "nonlinear", "timeoutMs": 20000},
    }  # fmt: skip

    result = analyze(StructuralModel.model_validate(model))

    assert result["status"] == "success"
    assert relative_error(result["reactions"]["b"][2], 5.0 * load / 16.0) <= NONLINEAR_GATE
