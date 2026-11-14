"""HTTP-level tests: routing, response shapes, and schema rejection."""

from fastapi.testclient import TestClient

from dof_opensees.app import app
from helpers import EA, FIXED, model

client = TestClient(app)

BAR = model({"a": (0, 0, 0), "b": (2, 0, 0)}, [("a", "b")], {"a": FIXED}, {"b": (1e3, 0, 0)})


def test_health_reports_the_opensees_version():
    body = client.get("/health").json()
    assert body["status"] == "ok" and body["opensees"]


def test_capabilities_describe_units_properties_and_limits():
    body = client.get("/capabilities").json()
    assert body["units"] == "SI"
    assert body["memberEndFixities"] == ["fixed", "pinned"]
    assert body["memberProperties"]["elastic_modulus"] > 0
    assert body["limits"]["maxNodes"] > 0


def test_analyze_returns_a_contract_shaped_success():
    response = client.post("/analyze", json=BAR)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    assert set(body) == {"status", "displacements", "reactions", "memberForces", "stability", "warnings"}
    assert abs(body["displacements"]["b"][0] - 1e3 * 2 / EA) < 1e-12
    assert len(body["displacements"]["a"]) == 6


def test_unstable_and_invalid_models_still_return_http_200():
    floating = model({"a": (0, 0, 0), "b": (2, 0, 0)}, [("a", "b")])
    response = client.post("/analyze", json=floating)
    assert response.status_code == 200 and response.json()["status"] == "unstable"

    dangling = model({"a": (0, 0, 0)}, [("a", "nowhere")])
    response = client.post("/analyze", json=dangling)
    assert response.status_code == 200 and response.json()["status"] == "error"


def test_schema_violations_return_422_with_an_error_result():
    cases = [
        {**BAR, "units": "imperial"},
        {**BAR, "surprise": True},
        {**BAR, "nodes": [{"id": "a", "position": [0, 0]}]},
        {**BAR, "members": [{**BAR["members"][0], "endFixity": "welded"}]},
    ]
    for body in cases:
        response = client.post("/analyze", json=body)
        assert response.status_code == 422
        result = response.json()
        assert result["status"] == "error" and result["message"].startswith("Invalid model:")


def test_cors_allows_the_vite_dev_origin():
    response = client.options(
        "/analyze",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"},
    )
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
