"""Contract-level acceptance tests for geometrically nonlinear analysis.

These tests judge the service against mechanics, not against itself. Every
expected value comes from ``accept_nonlinear_models``, where it is derived
from a closed form or an independent numerical solution of the governing
equation; none is taken from a solver run. Gates are those of the solver
criteria, section 7:

- 1 % relative error on nonlinear reference quantities (``NONLINEAR_GATE``),
- 2 % on buckling loads (``BUCKLING_GATE``),
- 0.1 % on linear analytical quantities (``LINEAR_GATE``),
- normalised equilibrium residual <= 1e-5 for valid equilibria (``RESIDUAL_GATE``).

Reading of the contract used throughout: a reaction is the force and moment
the support applies to the structure, so applied loads plus reactions sum to
zero (gravity gives a positive vertical reaction). Under nonlinear fidelity
moment balance is taken at deformed positions, under linear fidelity at
reference positions.
"""

from __future__ import annotations

import copy
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from accept_nonlinear_models import (  # noqa: E402
    COLUMN_EA,
    COLUMN_EI,
    COLUMN_LENGTH,
    beam_column_flexibility,
    beam_with_tie_model,
    bowed_column_model,
    bowed_column_reference,
    cable_pair_model,
    cable_pair_reference,
    column_buckling_model,
    euler_load,
    independent_cantilever,
    leaning_portal_model,
    model,
    pin_jointed_frame_model,
    sway_cantilever_model,
    taut_cable_model,
)

from dof_opensees.engine import analyze  # noqa: E402
from dof_opensees.schema import StructuralModel  # noqa: E402

NONLINEAR_GATE = 0.01
BUCKLING_GATE = 0.02
LINEAR_GATE = 0.001
RESIDUAL_GATE = 1e-5
MECHANISM_CODES = {"internal_mechanism", "rigid_body_mechanism", "unsupported_component"}

# Recovery from a singular reference state is the hardest case; it gets a
# larger budget than the 2 s service default (criteria section 6 allows
# "difficult states <= 2 s or explicit unresolved", but the gate here is
# correctness, not speed).
HARD_CASE_TIMEOUT_MS = 10_000


# --- helpers ---------------------------------------------------------------------


def run(model_dict: dict) -> dict:
    return analyze(StructuralModel.model_validate(model_dict))


def describe(result: dict) -> str:
    """Short context for failure messages."""
    parts = [f"status={result.get('status')!r}"]
    if "message" in result:
        parts.append(f"message={result['message']!r}")
    for comp in result.get("components", []):
        parts.append(
            f"component {comp['id']}: state={comp['state']!r} reasons={comp['reasonCodes']} "
            f"loadFactor={comp.get('loadFactor')} residual={comp.get('residual')}"
        )
    return "; ".join(parts)


def gate(actual: float, expected: float, rel: float, what: str) -> None:
    """Assert ``actual`` within relative ``rel`` of ``expected``, saying by how much it missed."""
    err = abs(actual - expected) / abs(expected) if expected else float("inf")
    assert actual == pytest.approx(expected, rel=rel), (
        f"{what}: got {actual:.6g}, expected {expected:.6g}; relative error {err:.3%} exceeds the {rel:.1%} gate"
    )


def near_zero(actual: float, scale: float, what: str, rel: float = 1e-6) -> None:
    assert abs(actual) <= rel * scale, f"{what}: got {actual:.3g}, expected 0 within {rel * scale:.3g} ({rel:g} of {scale:.3g})"


def component_of(result: dict, node_id: str) -> dict:
    for comp in result["components"]:
        if node_id in comp["nodeIds"]:
            return comp
    raise AssertionError(f"no component contains node {node_id!r}; {describe(result)}")


def expect_status(result: dict, status: str) -> None:
    assert result["status"] == status, f"expected status {status!r}; {describe(result)}"


def expect_valid(result: dict, node_id: str, state: str = "stable") -> dict:
    comp = component_of(result, node_id)
    assert comp["state"] == state, f"component of {node_id!r} should be {state!r}; {describe(result)}"
    assert comp["resultsValid"], f"component of {node_id!r} should have valid results; {describe(result)}"
    return comp


def check_hygiene(result: dict) -> None:
    """Invalid components have no entries; valid components have them all (contract AnalysisBody)."""
    for comp in result["components"]:
        if comp["resultsValid"]:
            for nid in comp["nodeIds"]:
                assert nid in result["displacements"], f"valid component {comp['id']}: node {nid!r} has no displacement"
            for mid in comp["memberIds"]:
                assert mid in result["memberForces"], f"valid component {comp['id']}: member {mid!r} has no forces"
        else:
            leaked = [n for n in comp["nodeIds"] if n in result["displacements"]]
            assert not leaked, f"invalid component {comp['id']} ({comp['state']}) reports displacements for {leaked}"
            leaked = [n for n in comp["nodeIds"] if n in result["reactions"]]
            assert not leaked, f"invalid component {comp['id']} ({comp['state']}) reports reactions for {leaked}"
            leaked = [m for m in comp["memberIds"] if m in result["memberForces"]]
            assert not leaked, f"invalid component {comp['id']} ({comp['state']}) reports member forces for {leaked}"


def check_equilibrium(model_dict: dict, result: dict, comp: dict, deformed: bool = True) -> None:
    """Residual gate plus an independent force and moment balance of one valid component.

    Force balance: sum of applied loads and reactions on the component's nodes,
    normalised by the larger of total applied force and total reaction force.
    Moment balance about the origin, at deformed positions under nonlinear
    fidelity, normalised by that force scale times the component's size plus
    the applied and reacted moments.
    """
    assert comp["resultsValid"], f"component {comp['id']} is not valid; {describe(result)}"
    residual = comp.get("residual")
    assert residual is not None, f"component {comp['id']}: no residual reported for a valid equilibrium"
    assert residual <= RESIDUAL_GATE, f"component {comp['id']}: residual {residual:.3g} exceeds the {RESIDUAL_GATE:g} gate"

    nodes = set(comp["nodeIds"])
    position = {n["id"]: np.array(n["position"], float) for n in model_dict["nodes"]}
    if deformed:
        for nid, disp in result["displacements"].items():
            if nid in position:
                position[nid] = position[nid] + np.array(disp[:3], float)

    force = np.zeros(3)
    moment = np.zeros(3)
    force_scale = moment_extra = reaction_scale = 0.0
    for item in model_dict["loads"]:
        if item["nodeId"] in nodes:
            f = np.array(item["force"], float)
            m = np.array(item["moment"], float)
            force += f
            moment += np.cross(position[item["nodeId"]], f) + m
            force_scale += np.linalg.norm(f)
            moment_extra += np.linalg.norm(m)
    for nid, reaction in result["reactions"].items():
        if nid in nodes:
            f = np.array(reaction[:3], float)
            m = np.array(reaction[3:], float)
            force += f
            moment += np.cross(position[nid], f) + m
            reaction_scale += np.linalg.norm(f)
            moment_extra += np.linalg.norm(m)
    scale = max(force_scale, reaction_scale)
    if scale == 0:
        return
    coords = np.array([position[n] for n in nodes])
    size = float(np.linalg.norm(coords.max(axis=0) - coords.min(axis=0))) or 1.0
    force_error = float(np.linalg.norm(force)) / scale
    moment_error = float(np.linalg.norm(moment)) / (scale * size + moment_extra)
    assert force_error <= RESIDUAL_GATE, (
        f"component {comp['id']}: reactions do not balance applied loads in force, "
        f"normalised imbalance {force_error:.3g} > {RESIDUAL_GATE:g} (imbalance {force})"
    )
    assert moment_error <= RESIDUAL_GATE, (
        f"component {comp['id']}: reactions do not balance applied loads in moment"
        f"{' at deformed positions' if deformed else ''}, normalised imbalance {moment_error:.3g} > {RESIDUAL_GATE:g}"
    )


def strip_runtime(result: dict) -> dict:
    stripped = copy.deepcopy(result)
    stripped.get("analysis", {}).pop("runtimeMs", None)
    return stripped


# --- 0. the references themselves ---------------------------------------------------


def test_references_are_self_consistent():
    """Checks of the independent references only; the solver is not called.

    Each reference is checked against a limit it must reproduce, so an error
    in the helper shows up here rather than as a solver failure.
    """
    # Beam-column flexibility tends to the first-order cantilever value as P -> 0.
    first_order = COLUMN_LENGTH**3 / (3 * COLUMN_EI)
    gate(beam_column_flexibility(1e-6 * euler_load("fixed_free"), COLUMN_EI, COLUMN_LENGTH), first_order, 1e-6, "beam-column flexibility at P -> 0")
    # ... and blows up at the fixed-free Euler load (u = pi/2).
    assert beam_column_flexibility(0.999 * euler_load("fixed_free"), COLUMN_EI, COLUMN_LENGTH) > 100 * first_order

    # The polygonal bow reference is within 0.5 % of the closed-form amplification
    # (the 16-chord polygon's first sine coefficient is 0.32 % below e0) and its
    # Fourier series has converged.
    for alpha in (0.25, 0.5, 0.75):
        ref = bowed_column_reference(alpha)
        gate(ref["delta_mid"], ref["closed_form"], 0.005, f"polygon bow vs e0*a/(1-a) at alpha={alpha}")
        gate(ref["delta_mid"], bowed_column_reference(alpha, kmax=401)["delta_mid"], 1e-6, "bow series convergence")

    # Cable pair: the bisection root satisfies both equilibrium and the
    # constitutive law, and without load the pretension is EA * eps0.
    ea = 160e9 * 1e-4
    for p, eps0 in ((5200.0, 2e-3), (2000.0, 0.0)):
        ref = cable_pair_reference(p, eps0)
        gate(2 * ref["T"] * ref["d"] / ref["l"], p, 1e-9, "cable pair vertical equilibrium")
        gate(ref["T"], ea * (eps0 + (ref["l"] - 5.0) / 5.0), 1e-12, "cable pair constitutive law")
    assert cable_pair_reference(1e-9, 2e-3)["T"] == pytest.approx(ea * 2e-3, rel=1e-6)


# --- 1. column buckling through the contract -------------------------------------------

BUCKLING_CASES = [
    ("pinned", 1),
    ("pinned", 3),  # same column as three collinear contract members: mesh independence
    ("fixed_free", 1),
    ("fixed_fixed", 1),
    ("skew_fixed_free", 1),
]


@pytest.mark.parametrize("load_ratio", [2.0, 1.25])
@pytest.mark.parametrize(("case", "segments"), BUCKLING_CASES)
def test_column_above_euler_load_is_unstable_at_critical_factor(case, segments, load_ratio):
    """Perfect column at load_ratio * P_cr: unstable, load_induced_instability, loadFactor = P_cr / P.

    Reference: Euler, P_cr = pi^2 EI / (K L)^2 with K = 1, 2, 0.5 (see
    accept_nonlinear_models.K_FACTOR for how the supports realise each end).
    """
    model_dict, info = column_buckling_model(case, load_ratio, segments)
    result = run(model_dict)
    expect_status(result, "unstable")
    comp = component_of(result, info["top"])
    assert comp["state"] == "unstable", describe(result)
    assert "load_induced_instability" in comp["reasonCodes"], f"missing load_induced_instability; {describe(result)}"
    assert not comp["resultsValid"], describe(result)
    assert comp.get("loadFactor") is not None, f"no loadFactor for a load-induced instability; {describe(result)}"
    gate(comp["loadFactor"], info["Pcr"] / info["P"], BUCKLING_GATE, f"{case} ({segments} member) critical load factor")
    check_hygiene(result)


@pytest.mark.parametrize(("case", "segments"), BUCKLING_CASES)
def test_column_below_euler_load_is_stable(case, segments):
    """Perfect column at P_cr / 2: success, straight, axial force -P, shortening P L / EA (to 1 %)."""
    model_dict, info = column_buckling_model(case, 0.5, segments)
    result = run(model_dict)
    expect_status(result, "success")
    comp = expect_valid(result, info["top"])
    check_equilibrium(model_dict, result, comp)
    check_hygiene(result)
    axis = info["axis"]
    disp = np.array(result["displacements"][info["top"]][:3])
    along = float(disp @ axis)
    lateral = float(np.linalg.norm(disp - along * axis))
    # Every end condition leaves the top free along the axis, so it shortens by P L / EA.
    gate(-along, info["P"] * info["length"] / COLUMN_EA, NONLINEAR_GATE, f"{case} top shortening")
    near_zero(lateral, info["length"], f"{case} lateral top displacement of a perfect column")
    for mid in info["memberIds"]:
        gate(result["memberForces"][mid]["axial"], -info["P"], NONLINEAR_GATE, f"{case} axial force in {mid}")


# --- 2. compressed imperfect column ------------------------------------------------------


@pytest.mark.parametrize("alpha", [0.25, 0.5, 0.75])
def test_bowed_column_midspan_amplification(alpha):
    """Half-sine bowed pin-ended column at alpha * P_e.

    Reference: additional midspan deflection e0 * alpha / (1 - alpha), evaluated
    mode by mode for the modelled 16-chord polygon (bowed_column_reference).
    Also the midspan bending moment P * (e0 + delta), from equilibrium of the
    lower half about the midspan section (horizontal reactions are zero: both
    supports and the load line are on x = 0).
    """
    model_dict, info = bowed_column_model(alpha)
    ref = bowed_column_reference(alpha)
    result = run(model_dict)
    expect_status(result, "success")
    comp = expect_valid(result, info["mid"])
    check_equilibrium(model_dict, result, comp)
    check_hygiene(result)
    ux = result["displacements"][info["mid"]][0]
    gate(ux, ref["delta_mid"], NONLINEAR_GATE, f"bowed column midspan deflection at P/Pe={alpha} (closed form {ref['closed_form']:.6g})")
    near_zero(result["displacements"][info["mid"]][1], COLUMN_LENGTH, "bowed column out-of-plane midspan displacement")
    below, above = info["midMembers"]
    moment = info["P"] * ref["total_mid"]
    gate(result["memberForces"][below]["momentEnd"], moment, NONLINEAR_GATE, f"midspan moment (end of {below}) at P/Pe={alpha}")
    gate(result["memberForces"][above]["momentStart"], moment, NONLINEAR_GATE, f"midspan moment (start of {above}) at P/Pe={alpha}")


# --- 3. sway: beam-column second-order response ----------------------------------------------


@pytest.mark.parametrize("alpha", [0.3, 0.6])
def test_sway_cantilever_second_order(alpha):
    """Fixed-base column, P = alpha * P_cr down and H lateral at the top.

    Reference: D = H L^3/(3EI) * 3 (tan u - u)/u^3, base moment H L + P D =
    H tan(u)/k, u = L sqrt(P/EI) (Timoshenko and Gere, sec. 1.11).
    """
    model_dict, info = sway_cantilever_model(alpha)
    result = run(model_dict)
    expect_status(result, "success")
    assert result["analysis"]["fidelity"] == "nonlinear", "the contract default fidelity is nonlinear"
    comp = expect_valid(result, "top")
    check_equilibrium(model_dict, result, comp)
    check_hygiene(result)
    sway = result["displacements"]["top"][0]
    gate(sway, info["sway_nonlinear"], NONLINEAR_GATE, f"tip sway at P/Pcr={alpha}")
    # Base moment, two ways: the support reaction about Y and the member end moment.
    gate(-result["reactions"]["base"][4], info["base_moment_nonlinear"], NONLINEAR_GATE, f"base reaction moment MY at P/Pcr={alpha}")
    gate(result["memberForces"]["col"]["momentStart"], info["base_moment_nonlinear"], NONLINEAR_GATE, f"column base moment at P/Pcr={alpha}")
    gate(result["reactions"]["base"][0], -info["H"], NONLINEAR_GATE, "base shear")
    gate(result["reactions"]["base"][2], info["P"], NONLINEAR_GATE, "base vertical reaction")


@pytest.mark.parametrize("alpha", [0.3, 0.6])
def test_sway_cantilever_linear_fidelity_is_first_order(alpha):
    """Same cantilever under linear fidelity: first-order D = H L^3/(3EI), M = H L, to the linear gate.

    The nonlinear reference differs from these by the amplification
    3 (tan u - u)/u^3 (1.42 and 2.48 here), so passing both tests proves the
    fidelity switch changes the analysis.
    """
    model_dict, info = sway_cantilever_model(alpha, fidelity="linear")
    result = run(model_dict)
    expect_status(result, "success")
    assert result["analysis"]["fidelity"] == "linear"
    comp = expect_valid(result, "top")
    check_equilibrium(model_dict, result, comp, deformed=False)
    gate(result["displacements"]["top"][0], info["sway_linear"], LINEAR_GATE, f"linear tip sway at P/Pcr={alpha}")
    gate(result["displacements"]["top"][2], -info["shortening_linear"], LINEAR_GATE, "linear shortening")
    gate(-result["reactions"]["base"][4], info["base_moment_linear"], LINEAR_GATE, "linear base moment")
    assert info["sway_nonlinear"] > 1.4 * info["sway_linear"]


def test_leaning_column_portal_second_order():
    """Sway column tied to a leaning (pin-ended, axial-only) column that destabilises it.

    Reference: D1 = H f / (1 - g f) with f the beam-column flexibility of
    column 1 under P1 and g = P2 / (L (1 - c)), link tension T = g D1, base
    moment of column 1 (H + T) tan(u1)/k1 (derivation in
    accept_nonlinear_models.leaning_portal_model).
    """
    model_dict, info = leaning_portal_model()
    result = run(model_dict)
    expect_status(result, "success")
    comp = expect_valid(result, "c1")
    check_equilibrium(model_dict, result, comp)
    check_hygiene(result)
    gate(result["displacements"]["c1"][0], info["D1"], NONLINEAR_GATE, "sway column top displacement")
    gate(result["displacements"]["c2"][0], info["D2"], NONLINEAR_GATE, "leaning column top displacement")
    gate(result["memberForces"]["link"]["axial"], info["T"], NONLINEAR_GATE, "link tension")
    gate(result["memberForces"]["col1"]["momentStart"], info["M1"], NONLINEAR_GATE, "sway column base moment")
    gate(-result["reactions"]["a1"][0], info["H"] + info["T"], NONLINEAR_GATE, "sway column base shear")
    gate(result["reactions"]["a2"][0], info["T"], NONLINEAR_GATE, "leaning column base shear")
    gate(result["memberForces"]["col2"]["axial"], -info["P2"], NONLINEAR_GATE, "leaning column axial force")


# --- 5. cables ------------------------------------------------------------------------------


def test_taut_cable_carries_tension():
    """Hanging cable, T = W, elongation W L / EA; state active, no cable_slack."""
    model_dict, info = taut_cable_model()
    result = run(model_dict)
    expect_status(result, "success")
    comp = expect_valid(result, "bot")
    check_equilibrium(model_dict, result, comp)
    forces = result["memberForces"]["cab"]
    assert forces.get("state") == "active", f"taut cable state {forces.get('state')!r}"
    assert "cable_slack" not in comp["reasonCodes"], describe(result)
    gate(forces["axial"], info["W"], NONLINEAR_GATE, "taut cable tension")
    gate(-result["displacements"]["bot"][2], info["elongation"], NONLINEAR_GATE, "taut cable elongation")
    gate(result["reactions"]["top"][2], info["W"], NONLINEAR_GATE, "anchor reaction")


@pytest.mark.parametrize("fidelity", [None, "linear"])
def test_compressed_cable_goes_slack_and_beam_carries_load(fidelity):
    """Cantilever with a tie below its tip, loaded down: the tie is slack, the beam alone carries P.

    Reference: tip P L^3/(3EI), base moment P L, cable force exactly 0, anchor
    reaction 0. Cables are tension-only at both fidelities (contract).
    """
    model_dict, info = beam_with_tie_model(-1, fidelity)
    result = run(model_dict)
    expect_status(result, "success")
    comp = expect_valid(result, "b")
    check_equilibrium(model_dict, result, comp, deformed=fidelity is None)
    check_hygiene(result)
    assert "cable_slack" in comp["reasonCodes"], f"slack cable not reported; {describe(result)}"
    assert "cable_slack" in result["analysis"]["reasonCodes"], "component reason codes not in the analysis union"
    tie = result["memberForces"]["tie"]
    assert tie.get("state") == "slack", f"tie state {tie.get('state')!r}, expected 'slack'"
    assert tie["axial"] == 0.0, f"slack cable axial force {tie['axial']!r}, expected exactly 0"
    gate(result["displacements"]["b"][2], info["tip"], NONLINEAR_GATE, "beam tip deflection with slack tie")
    gate(result["memberForces"]["beam"]["momentStart"], info["base_moment"], NONLINEAR_GATE, "beam base moment with slack tie")
    near_zero(float(np.linalg.norm(result["reactions"]["c"][:3])), info["P"], "slack tie anchor reaction")


def test_cable_activates_in_tension():
    """Same structure loaded up: the tie stretches and shares the load in proportion to stiffness.

    Reference: tip P / (k_b + k_c), T = k_c * tip, with k_b = 3EI/L^3 and k_c = EA/h.
    """
    model_dict, info = beam_with_tie_model(+1)
    result = run(model_dict)
    expect_status(result, "success")
    comp = expect_valid(result, "b")
    check_equilibrium(model_dict, result, comp)
    assert "cable_slack" not in comp["reasonCodes"], describe(result)
    tie = result["memberForces"]["tie"]
    assert tie.get("state") == "active", f"tie state {tie.get('state')!r}, expected 'active'"
    gate(tie["axial"], info["T"], NONLINEAR_GATE, "tie tension")
    gate(result["displacements"]["b"][2], info["tip"], NONLINEAR_GATE, "beam tip deflection with active tie")
    gate(result["reactions"]["c"][2], -info["T"], NONLINEAR_GATE, "tie anchor reaction")


def test_pretensioned_cable_pair_nonlinear_equilibrium():
    """Two collinear pretensioned cables, transverse load at the joint.

    Reference: exact two-bar equilibrium P = 2 T d / l with
    T = EA (eps0 + (l - a)/a), solved by bisection (cable_pair_reference).
    The pretension-only linear estimate P a / (2 EA eps0) = 0.41 m is 62 %
    off the exact 0.25 m, so this checks geometric nonlinearity.
    """
    model_dict, ref = cable_pair_model(5200.0, 2e-3)
    result = run(model_dict)
    expect_status(result, "success")
    comp = expect_valid(result, "b")
    check_equilibrium(model_dict, result, comp)
    check_hygiene(result)
    disp = result["displacements"]["b"]
    gate(-disp[2], ref["d"], NONLINEAR_GATE, "pretensioned pair sag")
    near_zero(disp[0], ref["d"], "pretensioned pair joint UX (symmetry)", rel=1e-4)
    for mid in ("left", "right"):
        forces = result["memberForces"][mid]
        assert forces.get("state") == "active", f"{mid} cable state {forces.get('state')!r}"
        gate(forces["axial"], ref["T"], NONLINEAR_GATE, f"pretensioned pair tension in {mid}")
    gate(-result["reactions"]["a"][0], ref["Rx"], NONLINEAR_GATE, "anchor a horizontal reaction")
    gate(result["reactions"]["a"][2], ref["Rz"], NONLINEAR_GATE, "anchor a vertical reaction")
    gate(result["reactions"]["c"][0], ref["Rx"], NONLINEAR_GATE, "anchor c horizontal reaction")


def test_unpretensioned_cable_pair_is_recovered_from_singular_reference():
    """Straight slack-free cable pair with no pretension: singular at the reference state.

    A transverse load stiffens it (A04, A05). Expected: success, reason
    geometrically_stiffened, and the exact solution of
    P = 2 T d / l, T = EA (l - a)/a (bisection). Larger time budget: see
    HARD_CASE_TIMEOUT_MS.
    """
    model_dict, ref = cable_pair_model(2000.0, 0.0, timeout_ms=HARD_CASE_TIMEOUT_MS)
    result = run(model_dict)
    expect_status(result, "success")
    comp = expect_valid(result, "b")
    assert "geometrically_stiffened" in comp["reasonCodes"], f"missing geometrically_stiffened; {describe(result)}"
    check_equilibrium(model_dict, result, comp)
    check_hygiene(result)
    gate(-result["displacements"]["b"][2], ref["d"], NONLINEAR_GATE, "unpretensioned pair sag")
    for mid in ("left", "right"):
        forces = result["memberForces"][mid]
        assert forces.get("state") == "active", f"{mid} cable state {forces.get('state')!r}"
        gate(forces["axial"], ref["T"], NONLINEAR_GATE, f"unpretensioned pair tension in {mid}")
    gate(result["reactions"]["a"][2], ref["Rz"], NONLINEAR_GATE, "anchor a vertical reaction")


# --- 6. mechanisms ----------------------------------------------------------------------------


@pytest.mark.parametrize("loading", ["lateral", "vertical", "none"])
def test_pin_jointed_frame_mechanism_is_unstable(loading):
    """Unbraced pin-jointed portal: a sway mechanism, loaded laterally, vertically or not at all.

    No stable equilibrium near the reference exists in any case (lateral: the
    sway is driven directly; vertical: the P-delta of a mechanism has negative
    stiffness; none: an unloaded mechanism is not stable, A03). It must be
    reported unstable with a mechanism reason, never as a stable collapsed or
    "stiffened" shape, and without results.
    """
    model_dict = pin_jointed_frame_model(loading)
    model_dict["analysis"] = {"timeoutMs": HARD_CASE_TIMEOUT_MS}
    result = run(model_dict)
    expect_status(result, "unstable")
    comp = component_of(result, "m_c")
    assert comp["state"] == "unstable", describe(result)
    assert not comp["resultsValid"], describe(result)
    assert MECHANISM_CODES & set(comp["reasonCodes"]), f"no mechanism reason code; {describe(result)}"
    assert "geometrically_stiffened" not in comp["reasonCodes"], describe(result)
    assert comp["stability"]["mechanisms"] >= 1, f"mechanism count {comp['stability']['mechanisms']}"
    assert not comp["stability"]["stable"]
    check_hygiene(result)


def test_mechanism_does_not_invalidate_independent_stable_component():
    """A06 with nonlinear fidelity: a laterally loaded mechanism next to an unrelated cantilever.

    Cantilever reference: tip P L^3/(3EI), base moment P L.
    """
    frame = pin_jointed_frame_model("lateral")
    k_nodes, k_members, k_supports, k_loads, info = independent_cantilever(offset_x=20.0)
    model_dict = model(
        frame["nodes"] + k_nodes,
        frame["members"] + k_members,
        frame["supports"] + k_supports,
        frame["loads"] + k_loads,
        timeout_ms=HARD_CASE_TIMEOUT_MS,
    )
    result = run(model_dict)
    expect_status(result, "unstable")
    assert component_of(result, "m_c")["state"] == "unstable", describe(result)
    comp = expect_valid(result, "k_tip")
    check_equilibrium(model_dict, result, comp)
    check_hygiene(result)
    gate(result["displacements"]["k_tip"][2], info["tip"], NONLINEAR_GATE, "independent cantilever tip deflection")
    gate(result["reactions"]["k_base"][2], info["P"], NONLINEAR_GATE, "independent cantilever vertical reaction")
    gate(result["memberForces"]["k_beam"]["momentStart"], info["M"], NONLINEAR_GATE, "independent cantilever base moment")


# --- 8. determinism ---------------------------------------------------------------------------

DETERMINISM_CASES = {
    "bowed_column": lambda: bowed_column_model(0.5)[0],
    "buckled_column": lambda: column_buckling_model("pinned", 2.0)[0],
    "unpretensioned_cables": lambda: cable_pair_model(2000.0, 0.0, timeout_ms=HARD_CASE_TIMEOUT_MS)[0],
    "slack_tie": lambda: beam_with_tie_model(-1)[0],
}


@pytest.mark.parametrize("case", sorted(DETERMINISM_CASES))
def test_repeated_analysis_is_identical(case):
    """Same model twice: identical results apart from wall-clock runtime (turn criteria, replay)."""
    first = strip_runtime(run(DETERMINISM_CASES[case]()))
    second = strip_runtime(run(DETERMINISM_CASES[case]()))
    assert first == second, f"{case}: two runs of the same model differ"
