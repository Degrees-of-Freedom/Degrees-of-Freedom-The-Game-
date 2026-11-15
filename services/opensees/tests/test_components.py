"""The same physical region must return its isolated response next to a mechanism."""
import pytest
from fastapi.testclient import TestClient

from dof_opensees.app import app
from dof_opensees.engine import Limits, analyze
from dof_opensees.schema import StructuralModel
from helpers import FIXED, model

client = TestClient(app)
bar = model({"base": (0, 0, 0), "tip": (2, 0, 0)}, [("base", "tip")],
            {"base": FIXED}, {"tip": (0, 0, -1000)})


def combine(a, b):
    return {**a, **{k: a[k] + b[k] for k in ("nodes", "members", "supports", "loads")}}


def post(data):
    response = client.post("/analyze", json=data)
    assert response.status_code == 200
    return response.json()


@pytest.mark.parametrize("nonlinear", [False, True])
@pytest.mark.parametrize("loaded", [False, True])
def test_coincident_free_component_cannot_erase_or_attract_the_cantilever_load(nonlinear, loaded):
    # One coordinate coincides with the supported region but the node IDs differ.
    free = model({"free": (2, 0, 0), "end": (2, 2, 0)}, [("free", "end")],
                 loads={"end": (0, 0, -500)} if loaded else {})
    good = {**bar, **({"analysis": {"type": "corotational", "segmentsPerFrame": 4}} if nonlinear else {})}
    baseline = post(good)
    mixed = post(combine(good, free))
    assert "reactions" not in mixed
    scopes = {tuple(c["memberIds"]): c["result"] for c in mixed["components"]}
    assert scopes[("base-tip",)] == baseline
    assert baseline["reactions"]["base"][2] == pytest.approx(1000)
    assert baseline["reactions"]["base"][4] == pytest.approx(-2000, rel=1e-5)
    bad = scopes[("free-end",)]
    assert mixed["status"] == bad["status"] == ("unresolved" if nonlinear else "unstable")
    assert {"reactions", "displacements", "memberForces"}.isdisjoint(bad)
    if not nonlinear:
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
    assert result["status"] == "unresolved"
    assert result["components"][0]["result"] == post(bar)
    assert result["components"][1]["result"]["status"] == "error"
    assert "corotational" in result["components"][1]["result"]["message"]
    data["members"][1]["endNodeId"] = "unknown"
    invalid = post(data)
    assert invalid["status"] == "error" and "components" not in invalid
    overflow = model({"x": (0, 0, 0)}, [], {"x": FIXED}, {"x": (1e308, 0, 0)})
    overflow["loads"] *= 2
    assert post(combine(bar, overflow))["components"][1]["result"] == post(bar)


def test_independent_components_share_the_request_equation_and_mode_budgets():
    second = model({"base2": (3, 0, 0), "tip2": (4, 0, 0)}, [("base2", "tip2")], {"base2": FIXED})
    data = StructuralModel.model_validate(combine(bar, second))
    result = analyze(data, limits=Limits(max_linear_equations=6))
    assert [s["result"]["status"] for s in result["components"]] == ["success", "unresolved"]
    assert "dense analysis limit" in result["components"][1]["result"]["message"]
    free = data.model_copy(update={"supports": []})
    result = analyze(free, limits=Limits(max_modes=2))
    assert len(result["stability"]["modes"]) == 2
    assert sum(len(s["result"]["stability"]["modes"]) for s in result["components"]) == 2
    assert result["stability"]["mechanisms"] == 12


def test_nonlinear_newton_attempts_are_bounded_over_all_regions():
    second = model({"base2": (3, 0, 0), "tip2": (4, 0, 0)}, [("base2", "tip2")], {"base2": FIXED})
    data = combine(bar, second)
    data["analysis"] = {"type": "corotational", "segmentsPerFrame": 2}
    single = post({**bar, "analysis": data["analysis"]})
    limit = single["nonlinear"]["steps"]
    result = analyze(StructuralModel.model_validate(data), limits=Limits(max_nonlinear_attempts=limit))
    first, other = (s["result"] for s in result["components"])
    assert first == single
    assert other["status"] == "unresolved"
    assert "increment budget" in other["message"]
