"""Arithmetic and native range boundaries at the normal analysis endpoint."""

import json

import pytest
from fastapi.testclient import TestClient

from dof_opensees import engine
from dof_opensees.app import app
from dof_opensees.schema import StructuralModel
from helpers import FIXED, model

client = TestClient(app)


def post(data):
    response = client.post("/analyze", json=data)
    assert response.status_code == 200, response.text
    result = response.json()
    json.dumps(result, allow_nan=False)
    return result


def unavailable(result, reason):
    assert result["status"] in ("error", "unresolved"), result
    assert reason in result["message"], result
    assert set(result) == {"status", "message"}


def applied_components(values, index, nonlinear=False):
    data = model({"base": (0, 0, 0)}, [], {"base": FIXED})
    for value in values:
        actions = [0.] * 6
        actions[index] = value
        data["loads"].append({"nodeId": "base", "force": actions[:3], "moment": actions[3:]})
    if nonlinear:
        data["analysis"] = {"type": "corotational"}
    return data


@pytest.mark.parametrize("nonlinear", [False, True])
@pytest.mark.parametrize("index", [0, 5])
def test_finite_loads_whose_total_overflows_are_explicit_errors(nonlinear, index):
    unavailable(post(applied_components([1e308, 1e308], index, nonlinear)), "combined force or moment")


@pytest.mark.parametrize("values", [[1e308, 3., -1e308], [1e308, 1e308, 3., -1e308, -1e308]])
def test_cancelling_extreme_loads_keep_the_small_signed_remainder(values):
    result = post(applied_components(values, 4))
    assert result["status"] == "success"
    assert result["reactions"]["base"] == [0, 0, 0, 0, -3, 0]


@pytest.mark.parametrize("nonlinear", [False, True])
def test_native_span_squaring_overflow_is_rejected_before_assembly(nonlinear):
    data = model({"a": (-1e200, 0, 0), "b": (1e200, 0, 0)}, [("a", "b")], {"a": FIXED})
    if nonlinear:
        data["analysis"] = {"type": "corotational"}
    unavailable(post(data), "reference span")


def test_translated_frame_subdivision_that_loses_precision_is_rejected():
    data = model({"a": (1e16, 0, 0), "b": (1e16 + 2, 0, 0)}, [("a", "b")], {"a": FIXED})
    data["analysis"] = {"type": "corotational", "segmentsPerFrame": 8}
    unavailable(post(data), "coincident mesh stations")


@pytest.mark.parametrize("law", [
    {"kind": "frame", "area": 2., "elasticModulus": 1e308, "shearModulus": 7e10,
     "iy": 1e-4, "iz": 1e-4, "torsionConstant": 1e-4},
    {"kind": "cable", "area": 1., "elasticModulus": 2e11, "restLength": 1e-308},
])
def test_explicit_law_products_are_checked_before_the_native_solve(law):
    data = model({"a": (0, 0, 0), "b": (1, 0, 0)}, [("a", "b", "pinned", "pinned")], {"a": FIXED})
    data["analysis"] = {"type": "corotational"}
    data["members"][0]["law"] = law
    assert post(data)["status"] == "error"


def test_nonfinite_native_field_withholds_the_entire_response_then_service_recovers(monkeypatch):
    data = model({"a": (0, 0, 0), "b": (2, 0, 0)}, [("a", "b")], {"a": FIXED}, {"b": (120, 0, 0)})
    with monkeypatch.context() as patch:
        patch.setattr(engine.ops, "nodeDisp", lambda tag: [float("nan")] * 6)
        unavailable(post(data), "Numerical response unavailable")
    assert post(data)["reactions"]["a"][0] == pytest.approx(-120)


@pytest.mark.parametrize("lost_component", [2, 4])
def test_finite_but_unbalanced_native_force_or_moment_is_withheld(monkeypatch, lost_component):
    # A 2 m cantilever with a tip load requires both vertical force and a couple.
    data = model({"a": (0, 0, 0), "b": (2, 0, 0)}, [("a", "b")], {"a": FIXED}, {"b": (0, 0, -1e160)})
    get_reaction = engine.ops.nodeReaction

    def corrupt(tag):
        vector = list(get_reaction(tag))
        vector[lost_component] = 0.
        return vector

    with monkeypatch.context() as patch:
        patch.setattr(engine.ops, "nodeReaction", corrupt)
        unavailable(post(data), "equilibrium")
    assert post(data)["reactions"]["a"][2] == pytest.approx(1e160)


def test_dense_budget_counts_pinned_end_rotations_before_matrix_extraction(monkeypatch):
    data = model({"a": (0, 0, 0), "b": (2, 0, 0)}, [("a", "b", "fixed", "pinned")], {"a": FIXED})
    monkeypatch.setattr(engine, "_stiffness", lambda *_: pytest.fail("Dense allocation exceeded request budget"))
    result = engine.analyze(StructuralModel.model_validate(data), limits=engine.Limits(max_linear_equations=5))
    unavailable(result, "6-equation linear model exceeds the 5-equation")

