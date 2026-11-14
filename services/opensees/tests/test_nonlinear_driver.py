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
from dof_opensees import nonlinear

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


def test_unexpected_failure_becomes_not_converged() -> None:
    class Failing(nlp.HandBuilt):
        def assess(self):  # type: ignore[override]
            raise RuntimeError("simulated OpenSees failure")

    reference = nlp.column("pinned", 4, 1.0)
    problem = Failing(reference.define, reference.recovery_displacement_limit)

    outcome = solve(problem)

    assert outcome.state == "unknown"
    assert outcome.reason_codes == ["not_converged"]


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
