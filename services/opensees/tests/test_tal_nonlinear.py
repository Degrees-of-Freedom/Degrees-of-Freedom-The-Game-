"""Tal's corotational fixtures (origin/main tests/test_nonlinear.py), ported to contract v2.

Independent dead-load equilibrium and stability fixtures for corotational
analysis, requested in her vocabulary: ``analysis: {type: 'corotational',
segmentsPerFrame}`` and member ``law``.
"""

import math

import pytest
from fastapi.testclient import TestClient

from dof_opensees.app import app
from helpers import EA, EI, FIXED, model

client = TestClient(app)


def solve(data, segments=8):
    response = client.post("/analyze", json={**data, "analysis": {"type": "corotational", "segmentsPerFrame": segments}})
    assert response.status_code == 200, response.text
    return response.json()


def column(load, lateral, segments):
    return solve(model({"base": (0, 0, 0), "tip": (0, 0, 12)}, [("base", "tip")],
                       {"base": FIXED}, {"tip": (lateral, 0, -load)}), segments)


def test_compression_amplifies_sway_to_beam_column_solution():
    length = 12
    critical = math.pi**2 * EI / (4 * length**2)
    compression = 0.55 * critical
    k = math.sqrt(compression / EI)
    # Beam-column equation EI*v'' + P*(v_tip-v) + H*(L-x) = 0.
    expected = 40 / compression * (math.tan(k * length)/k - length)
    errors = []
    for segments in [2, 8, 16]:
        result = column(compression, 40, segments)
        assert result["status"] == "success", result
        assert result["nonlinear"]["segmentsPerFrame"] == segments
        errors.append(abs(result["displacements"]["tip"][0]/expected - 1))
    print("Sway relative errors, 2/8/16 segments:", errors)
    assert errors[2] < errors[1] < errors[0]
    assert errors[2] < 0.01


def test_critical_load_from_loss_of_positive_tangent():
    # A perfectly straight cantilever stays in axial equilibrium above Euler
    # load. That equilibrium must fail the constrained final-tangent check.
    euler = math.pi**2 * EI / (4 * 12**2)
    bracket = [0.85, 1.15]
    for _ in range(8):
        ratio = sum(bracket)/2
        solution = column(euler*ratio, 0, 16)
        # v2 reports a verified `unstable` with the critical factor (v1: `unresolved`, "tangent").
        assert solution["status"] in {"success", "unstable"}, solution
        if solution["status"] == "unstable":
            assert "load_induced_instability" in solution["components"][0]["reasonCodes"], solution
        bracket[0 if solution["status"] == "success" else 1] = ratio
    assert abs(sum(bracket)/2 - 1) < 0.02
    print("Critical load bracket / Euler:", bracket)


def test_imperfect_compressed_column():
    # Stress-free sine imperfection in a pin-supported column. In the small
    # slope limit, the additional midpoint displacement is e0*P/(Pcr-P).
    length, initial, count = 20, 0.001, 16
    ratio = 0.45
    compression = ratio * math.pi**2 * EI / length**2
    nodes = {str(i): (length*i/count, initial*math.sin(math.pi*i/count), 0) for i in range(count+1)}
    supports = {"0": [True, True, True, True, False, False],
                str(count): [False, True, True, False, False, False]}
    members = [(str(i), str(i+1)) for i in range(count)]
    result = solve(model(nodes, members, supports, {str(count): (-compression, 0, 0)}), 2)
    assert result["status"] == "success", result
    measured = result["displacements"][str(count//2)][1]
    print("Imperfect-column midpoint measured / analytical (m):", measured, initial * ratio/(1-ratio))
    assert measured == pytest.approx(initial * ratio/(1-ratio), rel=.01)


def cable(rest):
    return {"kind": "cable", "elasticModulus": 160e9, "area": 0.00036, "restLength": rest}


def test_pretensioned_two_leg_cable_under_large_transverse_movement():
    span, reference_sag, sag = 2.0, 0.04, 0.23
    rest = math.hypot(span, reference_sag) * 0.9998
    # Exact force equilibrium at the deflected apex with two equal straight legs.
    final_length = math.hypot(span, sag)
    tension = 160e9 * .00036 * (final_length/rest - 1)
    load = 2 * tension * sag / final_length
    supports = {"l": FIXED, "r": FIXED, "m": [True, True, False, False, False, False]}
    data = model({"l": (-span, 0, 0), "m": (0, 0, -reference_sag), "r": (span, 0, 0)},
                 [("l", "m", "pinned", "pinned"), ("r", "m", "pinned", "pinned")],
                 supports, {"m": (0, 0, -load)})
    for member in data["members"]:
        member["law"] = cable(rest)
    result = solve(data)
    assert result["status"] == "success", result
    print("Two-leg sag measured / analytical (m):", reference_sag - result["displacements"]["m"][2], sag)
    assert result["displacements"]["m"][2] == pytest.approx(reference_sag - sag, rel=.01)
    assert result["memberForces"]["l-m"]["axial"] == pytest.approx(tension, rel=.01)
    assert result["reactions"]["l"][2] == pytest.approx(load/2, rel=.01)
    assert result["nonlinear"]["cableState"] == {"l-m": "taut", "r-m": "taut"}


@pytest.mark.parametrize("load", [-1e5, 1e5])
def test_cable_can_slacken_or_engage_alongside_a_frame(load):
    length = 2.0
    # Two distinct member IDs span the same supports in this analytical fixture.
    data = model({"a": (0, 0, 0), "b": (length, 0, 0)}, [("a", "b")], {"a": FIXED}, {"b": (load, 0, 0)})
    rest = length
    data["members"].append({"id": "stay", "startNodeId": "a", "endNodeId": "b",
                            "startFixity": "pinned", "endFixity": "pinned", "law": cable(rest)})
    result = solve(data)
    assert result["status"] == "success", result
    expected = load*length/(EA + (160e9*.00036 if load > 0 else 0))
    assert result["displacements"]["b"][0] == pytest.approx(expected, rel=.01)
    assert result["nonlinear"]["cableState"]["stay"] == ("taut" if load > 0 else "slack")
    assert result["memberForces"]["stay"]["axial"] >= 0


def test_fully_restrained_pretension_and_applied_load():
    data = model({"a": (0, 0, 0), "b": (2, 0, 0)}, [("a", "b", "pinned", "pinned")],
                 {"a": FIXED, "b": FIXED}, {"b": (2000, 0, 0)})
    data["members"][0]["law"] = cable(1.999)
    result = solve(data)
    assert result["status"] == "success", result
    tension = 160e9*.00036*(2/1.999 - 1)
    assert result["reactions"]["a"][0] == pytest.approx(-tension, rel=1e-6)
    assert result["reactions"]["b"][0] == pytest.approx(tension-2000, rel=1e-6)
    assert result["nonlinear"]["steps"] == 0


def test_initially_slack_single_cable_can_find_a_hanging_equilibrium():
    data = model({"a": (0, 0, 0), "b": (2, 0, 0)}, [("a", "b", "pinned", "pinned")],
                 {"a": FIXED}, {"b": (0, 0, -150)})
    data["members"][0]["law"] = cable(2.05)
    result = solve(data)
    assert result["status"] == "success", result
    expected = 2.05 * (1 + 150 / (160e9 * .00036))
    assert result["displacements"]["b"][0] == pytest.approx(-2, abs=1e-8)
    assert result["displacements"]["b"][2] == pytest.approx(-expected, rel=1e-6)
    assert result["memberForces"]["a-b"]["axial"] == pytest.approx(150, rel=1e-6)


def test_free_floating_net_load_has_bounded_unresolved_result():
    data = model({"a": (0, 0, 0), "b": (2, 0, 0)}, [("a", "b")], {}, {"b": (0, 0, -150)})
    result = solve(data)
    # v2 reports a verified `unstable` unsupported component (v1: `unresolved`); absent entries are empty maps.
    assert result["status"] == "unstable", result
    assert result["components"][0]["reasonCodes"] == ["unsupported_component"]
    assert result["reactions"] == {} and result["memberForces"] == {}


def test_legacy_analysis_explicitly_rejects_nonlinear_laws():
    data = model({"a": (0, 0, 0), "b": (2, 0, 0)}, [("a", "b", "pinned", "pinned")], {"a": FIXED})
    data["members"][0]["law"] = cable(2)
    result = client.post("/analyze", json=data).json()
    # v2 accepts a law at linear fidelity (same tension-only law, linearised; v1: `error`
    # "requires corotational"). The cable's free end is an unloaded mechanism: `unstable`.
    assert result["status"] == "unstable" and result["analysis"]["fidelity"] == "linear"
