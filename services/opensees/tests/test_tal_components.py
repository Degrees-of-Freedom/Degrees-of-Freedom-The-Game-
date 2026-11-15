"""Tal's component tests (origin/main tests/test_components.py), ported to contract v2.

The same physical region must return its isolated response next to a
mechanism. In v2 every component carries its own verdict in ``components``
and the whole-model fields hold the entries of the valid components only, so
the per-scope ``result`` objects of v1 are compared as v2 components and
top-level entries instead.
"""
import pytest
from fastapi.testclient import TestClient

from dof_opensees.app import app
from dof_opensees.engine import Limits, analyze
from dof_opensees.schema import StructuralModel
from helpers import FIXED, component, model

client = TestClient(app)
bar = model({"base": (0, 0, 0), "tip": (2, 0, 0)}, [("base", "tip")],
            {"base": FIXED}, {"tip": (0, 0, -1000)})


def combine(a, b):
    return {**a, **{k: a[k] + b[k] for k in ("nodes", "members", "supports", "loads")}}


def post(data):
    response = client.post("/analyze", json=data)
    assert response.status_code == 200
    return response.json()


def entries(result, node_ids, member_ids):
    """The top-level result entries of one component."""
    return (
        {k: v for k, v in result["displacements"].items() if k in node_ids},
        {k: v for k, v in result["reactions"].items() if k in node_ids},
        {k: v for k, v in result["memberForces"].items() if k in member_ids},
    )


@pytest.mark.parametrize("nonlinear", [False, True])
@pytest.mark.parametrize("loaded", [False, True])
def test_coincident_free_component_cannot_erase_or_attract_the_cantilever_load(nonlinear, loaded):
    # One coordinate coincides with the supported region but the node IDs differ.
    free = model({"free": (2, 0, 0), "end": (2, 2, 0)}, [("free", "end")],
                 loads={"end": (0, 0, -500)} if loaded else {})
    good = {**bar, **({"analysis": {"type": "corotational", "segmentsPerFrame": 4}} if nonlinear else {})}
    baseline = post(good)
    mixed = post(combine(good, free))
    # v2 keeps the valid component's entries at top level beside an unstable one; v1 dropped them.
    assert set(mixed["reactions"]) == {"base"}
    scopes = {tuple(c["memberIds"]): c for c in mixed["components"]}
    assert scopes[("base-tip",)] == component(baseline, "base")
    assert entries(mixed, {"base", "tip"}, {"base-tip"}) == entries(baseline, {"base", "tip"}, {"base-tip"})
    assert baseline["reactions"]["base"][2] == pytest.approx(1000)
    assert baseline["reactions"]["base"][4] == pytest.approx(-2000, rel=1e-5)
    bad = scopes[("free-end",)]
    # v2 reports the unsupported part as a verified `unstable` mechanism at both fidelities (v1: `unresolved` nonlinear).
    assert mixed["status"] == "unstable" and bad["state"] == "unstable"
    assert "unsupported_component" in bad["reasonCodes"]
    assert not bad["resultsValid"]
    assert {"free", "end"}.isdisjoint(mixed["displacements"]) and {"free", "end"}.isdisjoint(mixed["reactions"])
    assert "free-end" not in mixed["memberForces"]
    # v1 asserted the next two at linear fidelity only; v2 reports the reference mechanism at both.
    assert set(bad["stability"]["unstableNodeIds"]) == {"free", "end"}
    assert mixed["stability"]["mechanisms"] == bad["stability"]["mechanisms"]


@pytest.mark.parametrize("nonlinear", [False, True])
def test_independent_successes_retain_legacy_aggregate_and_scoped_quantities(nonlinear):
    second = model({"anchor": (2, 0, 0)}, [], {"anchor": FIXED}, {"anchor": (0, 0, 200)})
    data = combine(bar, second)
    if nonlinear:
        data["analysis"] = {"type": "corotational"}
    result = post(data)
    assert result["status"] == "success"
    assert len(result["components"]) == 2
    assert result["reactions"]["base"][2] == pytest.approx(1000)
    assert result["reactions"]["anchor"][2] == -200
    assert set(result["memberForces"]) == {"base-tip"}
    assert set(result["displacements"]) == {"anchor", "base", "tip"}


def test_unavailable_law_and_overflow_are_scoped_but_dangling_identity_is_global():
    cable = model({"l": (2, 0, 0), "r": (3, 0, 0)}, [("l", "r", "pinned", "pinned")], {"l": FIXED})
    cable["members"][0]["law"] = {"kind": "cable", "elasticModulus": 2e11, "area": .001, "restLength": 1}
    data = combine(bar, cable)
    data["nodes"].append({"id": "unused", "position": [4, 0, 0]})
    result = post(data)
    assert result["inactiveNodeIds"] == ["unused"]
    # v2 accepts a law at linear fidelity too (v1: `error`, "requires corotational"); the cable's
    # free end is then a verified unloaded mechanism, so the request is `unstable`, not `unresolved`.
    assert result["status"] == "unstable"
    assert result["components"][0] == post(bar)["components"][0]
    assert result["components"][1]["state"] == "unstable"
    assert result["components"][1]["memberIds"] == ["l-r"]
    data["members"][1]["endNodeId"] = "unknown"
    invalid = post(data)
    assert invalid["status"] == "error" and "components" not in invalid
    overflow = model({"x": (0, 0, 0)}, [], {"x": FIXED}, {"x": (1e308, 0, 0)})
    overflow["loads"] *= 2
    # v2 maps invalid input to `error` for the whole request (v1 scoped the error to that region).
    combined = post(combine(bar, overflow))
    assert combined["status"] == "error" and "combined force or moment" in combined["message"]


def test_independent_components_share_the_request_equation_and_mode_budgets():
    second = model({"base2": (3, 0, 0), "tip2": (4, 0, 0)}, [("base2", "tip2")], {"base2": FIXED})
    data = StructuralModel.model_validate(combine(bar, second))
    result = analyze(data, limits=Limits(max_linear_equations=6))
    # v2 states: `stable` and `unknown` (v1 scope statuses `success` and `unresolved`).
    assert [c["state"] for c in result["components"]] == ["stable", "unknown"]
    assert result["components"][1]["reasonCodes"] == ["not_converged"]
    assert any("dense analysis limit" in warning for warning in result["warnings"])
    free = data.model_copy(update={"supports": []})
    result = analyze(free, limits=Limits(max_modes=2))
    assert len(result["stability"]["modes"]) == 2
    assert sum(len(c["stability"]["modes"]) for c in result["components"]) == 2
    assert result["stability"]["mechanisms"] == 12


def test_nonlinear_newton_attempts_are_bounded_over_all_regions():
    second = model({"base2": (3, 0, 0), "tip2": (4, 0, 0)}, [("base2", "tip2")], {"base2": FIXED})
    data = combine(bar, second)
    data["analysis"] = {"type": "corotational", "segmentsPerFrame": 2}
    single = post({**bar, "analysis": data["analysis"]})
    limit = single["nonlinear"]["steps"]
    result = analyze(StructuralModel.model_validate(data), limits=Limits(max_nonlinear_attempts=limit))
    first, other = result["components"]
    assert first == component(single, "base")
    assert entries(result, {"base", "tip"}, {"base-tip"}) == entries(single, {"base", "tip"}, {"base-tip"})
    # v2: the unfinished component is `unknown` with `not_converged` (v1: scope `unresolved`).
    assert other["state"] == "unknown" and other["reasonCodes"] == ["not_converged"]
    assert any("increment budget" in warning for warning in result["warnings"])
