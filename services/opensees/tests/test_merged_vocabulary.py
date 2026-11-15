"""The merge of Tal's engine into v2: her request vocabulary, deterministic limits and result extras.

See DESIGN.md, "Request vocabulary", "Work limits" and "Result extras".
"""

import copy
import itertools
import math
import time

import pytest
from fastapi.testclient import TestClient

from dof_opensees.app import app
from dof_opensees.engine import Limits, analyze
from dof_opensees.schema import StructuralModel
from helpers import EA, EI, FIXED, model

client = TestClient(app)
COROTATIONAL = {"type": "corotational"}
CABLE_EA = 160e9 * 0.00036


def solve(data, limits=Limits()):
    return analyze(StructuralModel.model_validate(data), limits=limits)


def cable_law(rest):
    return {"kind": "cable", "elasticModulus": 160e9, "area": 0.00036, "restLength": rest}


def without_runtime(result):
    result = copy.deepcopy(result)
    result.get("analysis", {}).pop("runtimeMs", None)
    return result


# --- fidelity ---------------------------------------------------------------


BAR = model({"a": (0, 0, 0), "b": (4, 0, 0)}, [("a", "b")], {"a": FIXED}, {"b": (0, 0, -100.0)})


@pytest.mark.parametrize("analysis, fidelity", [
    (None, "linear"),
    ({}, "linear"),
    ({"selfWeight": False}, "linear"),
    ({"fidelity": "linear"}, "linear"),
    ({"fidelity": "nonlinear"}, "nonlinear"),
    ({"type": "corotational"}, "nonlinear"),
    ({"type": "corotational", "fidelity": "nonlinear", "segmentsPerFrame": 3}, "nonlinear"),
])
def test_nonlinear_is_opt_in(analysis, fidelity):
    data = dict(BAR) if analysis is None else {**BAR, "analysis": analysis}
    result = solve(data)
    assert result["status"] == "success"
    assert result["analysis"]["fidelity"] == fidelity
    assert ("nonlinear" in result) == (fidelity == "nonlinear")


@pytest.mark.parametrize("analysis, fragment", [
    ({"type": "corotational", "fidelity": "linear"}, "corotational analysis is nonlinear"),
    ({"segmentsPerFrame": 4}, "nonlinear analysis only"),
    ({"fidelity": "linear", "segmentsPerFrame": 4}, "nonlinear analysis only"),
])
def test_contradictory_analysis_options_are_errors(analysis, fragment):
    result = solve({**BAR, "analysis": analysis})
    assert result["status"] == "error" and fragment in result["message"]


@pytest.mark.parametrize("analysis", [{"type": "linear"}, {"type": "corotational", "segmentsPerFrame": 0},
                                      {"type": "corotational", "segmentsPerFrame": 33},
                                      {"type": "corotational", "segmentsPerFrame": 2.5}])
def test_malformed_analysis_options_are_schema_errors(analysis):
    assert client.post("/analyze", json={**BAR, "analysis": analysis}).status_code == 422


def test_fixed_segments_override_adaptive_subdivision():
    # A 12 m column at 0.55 of its Euler load: adaptive subdivision refines it.
    euler = math.pi**2 * EI / (4 * 12**2)
    column = model({"base": (0, 0, 0), "tip": (0, 0, 12)}, [("base", "tip")], {"base": FIXED},
                   {"tip": (40, 0, -0.55 * euler)})
    adaptive = solve({**column, "analysis": COROTATIONAL})
    fixed = solve({**column, "analysis": {**COROTATIONAL, "segmentsPerFrame": 3}})
    assert adaptive["status"] == fixed["status"] == "success"
    # Adaptive: the largest count used, from the rule ceil(29 sqrt(rho)) with rho = 0.55 / 4.
    assert adaptive["nonlinear"]["segmentsPerFrame"] == math.ceil(29 * math.sqrt(0.55 / 4))
    assert fixed["nonlinear"]["segmentsPerFrame"] == 3
    assert any("segmentsPerFrame 3 may be fewer" in warning for warning in fixed["warnings"])


# --- member laws ------------------------------------------------------------


def frame_law():
    return {"kind": "frame", "elasticModulus": 2.0e11, "shearModulus": 8.0e10, "area": 0.01,
            "iy": 2.0e-5, "iz": 5.0e-5, "torsionConstant": 3.0e-5}


def test_frame_law_is_a_beam_with_those_properties():
    law = frame_law()
    properties = {"elasticModulus": law["elasticModulus"], "shearModulus": law["shearModulus"], "area": law["area"],
                  "inertiaY": law["iy"], "inertiaZ": law["iz"], "torsionConstant": law["torsionConstant"]}
    by_law = copy.deepcopy(BAR)
    by_law["members"][0]["law"] = law
    by_properties = copy.deepcopy(BAR)
    by_properties["members"][0]["properties"] = properties
    both = copy.deepcopy(by_law)
    both["members"][0].update(properties=properties, kind="beam")
    results = [without_runtime(solve(item)) for item in (by_law, by_properties, both)]
    assert results[0] == results[1] == results[2]
    # Default local axes of a member along X: local Y is global Z, so a load along Z bends about local Z (Iz).
    expected = 100.0 * 4**3 / (3 * law["elasticModulus"] * law["iz"])
    assert results[0]["displacements"]["b"][2] == pytest.approx(-expected, rel=1e-9)


@pytest.mark.parametrize("change, fragment", [
    ({"kind": "brace"}, "gives kind 'brace'"),
    ({"initialStrain": 1e-4}, "gives initialStrain"),
    ({"properties": {"elasticModulus": 1.0e11, "shearModulus": 8.0e10, "area": 0.00036, "inertiaY": 1e-6,
                     "inertiaZ": 1e-6, "torsionConstant": 1e-6}}, "disagree on elasticModulus"),
])
def test_law_with_disagreeing_fields_is_an_error(change, fragment):
    data = model({"a": (0, 0, 0), "b": (2, 0, 0)}, [("a", "b", "pinned", "pinned")], {"a": FIXED}, {"b": (1e3, 0, 0)})
    data["members"][0].update(law=cable_law(2.0), **change)
    result = solve(data)
    assert result["status"] == "error" and fragment in result["message"]


def test_cable_law_with_agreeing_fields_is_accepted():
    data = model({"a": (0, 0, 0), "b": (2, 0, 0)}, [("a", "b", "pinned", "pinned")], {"a": FIXED, "b": FIXED},
                 {"b": (1e3, 0, 0)})
    data["members"][0]["law"] = cable_law(1.999)
    agreeing = copy.deepcopy(data)
    agreeing["members"][0].update(kind="cable", initialStrain=0.0, properties={
        "elasticModulus": 160e9, "shearModulus": 1.0, "area": 0.00036, "inertiaY": 1.0, "inertiaZ": 1.0,
        "torsionConstant": 1.0})
    assert without_runtime(solve(agreeing)) == without_runtime(solve(data))


@pytest.mark.parametrize("analysis", [None, COROTATIONAL])
def test_cable_law_force_is_ea_times_engineering_strain_on_the_rest_length(analysis):
    # A hanger: top fixed, bottom node guided vertically, hanging load W. Exact
    # nonlinear answer: l = L0 (1 + W / EA); linear: the same law linearised at l = L.
    length, rest, weight = 3.0, 2.999, 2.0e4
    data = model({"top": (0, 0, length), "bottom": (0, 0, 0)}, [("top", "bottom", "pinned", "pinned")],
                 {"top": FIXED, "bottom": [True, True, False, True, True, True]}, {"bottom": (0, 0, -weight)})
    data["members"][0]["law"] = cable_law(rest)
    if analysis:
        data["analysis"] = analysis
    result = solve(data)
    assert result["status"] == "success"
    stretched = rest * (1 + weight / CABLE_EA)
    assert result["memberForces"]["top-bottom"]["axial"] == pytest.approx(weight, rel=1e-9)
    assert result["memberForces"]["top-bottom"]["state"] == "active"
    assert -result["displacements"]["bottom"][2] == pytest.approx(stretched - length, rel=1e-6 if analysis else 1e-3)


@pytest.mark.parametrize("analysis", [None, COROTATIONAL])
def test_cable_law_is_slack_below_its_rest_length_at_both_fidelities(analysis):
    # A strut and a cable side by side; the cable is longer than the span and the
    # strut is pushed shorter, so the cable carries nothing.
    data = model({"a": (0, 0, 0), "b": (2, 0, 0)}, [("a", "b")], {"a": FIXED}, {"b": (-1e4, 0, 0)})
    data["members"].append({"id": "stay", "startNodeId": "a", "endNodeId": "b", "law": cable_law(2.01)})
    if analysis:
        data["analysis"] = analysis
    result = solve(data)
    assert result["status"] == "success"
    assert result["memberForces"]["stay"] == {**result["memberForces"]["stay"], "axial": 0.0, "state": "slack"}
    assert result["displacements"]["b"][0] == pytest.approx(-1e4 * 2 / EA, rel=1e-3)
    assert "cable_slack" in result["components"][0]["reasonCodes"]
    if analysis:
        assert result["nonlinear"]["cableState"] == {"stay": "slack"}


def test_far_recovery_is_still_refused_for_a_frame_mechanism():
    # A pin-jointed portal pushed sideways racks over to a far-away equilibrium.
    # Only cable-only components may accept a recovered state beyond 0.1 x the
    # shortest member; this one has beams, so it stays an unstable mechanism.
    data = model({"a": (0, 0, 0), "b": (0, 0, 3), "c": (4, 0, 3), "d": (4, 0, 0)},
                 [("a", "b", "pinned", "pinned"), ("b", "c", "pinned", "pinned"), ("c", "d", "pinned", "pinned")],
                 {"a": [True, True, True, True, False, True], "d": [True, True, True, True, False, True]},
                 {"b": (1e3, 0, -1e4), "c": (0, 0, -1e4)}, COROTATIONAL)
    result = solve(data)
    assert result["status"] == "unstable", result
    part = result["components"][0]
    assert "geometrically_stiffened" not in part["reasonCodes"]
    assert part["loadFactor"] == 0.0 and result["displacements"] == {}


# --- result extras ----------------------------------------------------------


def test_inactive_nodes_are_listed_and_get_no_placeholders():
    data = copy.deepcopy(BAR)
    data["nodes"].append({"id": "spare", "position": [9, 9, 9]})
    for analysis in (None, COROTATIONAL):
        result = solve({**data, **({"analysis": analysis} if analysis else {})})
        assert result["inactiveNodeIds"] == ["spare"]
        # Absent means unavailable: no zero displacement for a node that was not analysed (v1 gave one).
        assert "spare" not in result["displacements"] and "spare" not in result["reactions"]
    assert "inactiveNodeIds" not in solve(BAR)


def test_nonlinear_report_fields():
    result = solve({**BAR, "analysis": COROTATIONAL})
    report = result["nonlinear"]
    assert set(report) == {"segmentsPerFrame", "steps", "forceResidual", "momentResidual", "nodalResidual",
                           "cableState"}
    assert report["steps"] >= 1 and report["cableState"] == {}
    assert max(report["forceResidual"], report["momentResidual"], report["nodalResidual"]) <= 1e-5
    assert report["segmentsPerFrame"] == 1  # a lightly loaded cantilever needs no refinement


def test_nonlinear_report_is_absent_unless_the_analysis_succeeded():
    euler = math.pi**2 * EI / (4 * 12**2)
    column = model({"base": (0, 0, 0), "tip": (0, 0, 12)}, [("base", "tip")], {"base": FIXED},
                   {"tip": (0, 0, -1.3 * euler)}, COROTATIONAL)
    result = solve(column)
    assert result["status"] == "unstable" and "nonlinear" not in result


# --- deterministic limits ---------------------------------------------------


def hard_model():
    """Three components, each needing many Newton attempts: buckling, a recovered cable and a slack cable."""
    euler = math.pi**2 * EI / (4 * 12**2)
    column = model({"base": (0, 0, 0), "tip": (0, 0, 12)}, [("base", "tip")], {"base": FIXED},
                   {"tip": (0, 0, -1.25 * euler)})
    span, sag = 2.0, 0.04
    rest = math.hypot(span, sag) * 0.9998
    net = model({"l": (10 - span, 0, 0), "m": (10, 0, -sag), "r": (10 + span, 0, 0)},
                [("l", "m", "pinned", "pinned"), ("r", "m", "pinned", "pinned")],
                {"l": FIXED, "r": FIXED, "m": [True, True, False, False, False, False]}, {"m": (0, 0, -8e4)})
    for member in net["members"]:
        member["law"] = cable_law(rest)
    data = {**column, **{key: column[key] + net[key] for key in ("nodes", "members", "supports", "loads")}}
    return {**data, "analysis": COROTATIONAL}


def test_results_do_not_depend_on_machine_load(monkeypatch):
    """The same hard model twice under heavy artificial delay, and once without: identical results.

    Every clock read advances by 1000 s, as if the machine were overloaded. With
    no ``timeoutMs`` no clock decides anything, so nothing may change but the
    reported runtime.
    """
    reference = without_runtime(solve(hard_model()))
    assert reference["status"] == "unstable"
    assert any(c["state"] == "stable" for c in reference["components"])

    def slow(clock):
        ticks = itertools.count()
        start = clock()
        return lambda: start + 1000.0 * next(ticks)

    with monkeypatch.context() as patch:
        patch.setattr(time, "perf_counter", slow(time.perf_counter))
        patch.setattr(time, "monotonic", slow(time.monotonic))
        delayed = [solve(hard_model()) for _ in range(2)]
    # One artificial tick is 1000 s; allow for float rounding of the difference.
    assert delayed[0]["analysis"]["runtimeMs"] >= 0.999e6  # the delay was seen
    assert [without_runtime(result) for result in delayed] == [reference, reference]
    assert "timeout" not in reference["analysis"]["reasonCodes"]


def test_attempt_budget_is_shared_and_reproducible():
    data = hard_model()
    full = solve(data)
    for budget in (0, 3, 10):
        limited = [without_runtime(solve(data, Limits(max_nonlinear_attempts=budget))) for _ in range(2)]
        assert limited[0] == limited[1]
        unknown = [c for c in limited[0]["components"] if c["state"] == "unknown"]
        assert unknown and all(c["reasonCodes"] == ["not_converged"] for c in unknown)
        assert limited[0]["status"] in ("unstable", "unresolved")
    assert all(c["state"] != "unknown" for c in full["components"])


def test_wall_clock_limit_still_applies_when_requested():
    data = hard_model()
    data["analysis"] = {**COROTATIONAL, "timeoutMs": 1e-6}
    result = solve(data)
    assert result["status"] in ("unstable", "unresolved") and "timeout" in result["analysis"]["reasonCodes"]
