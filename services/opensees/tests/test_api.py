"""HTTP-level tests: routing, response shapes, and schema rejection."""

from fastapi.testclient import TestClient

from dof_opensees.app import app, create_app
from helpers import EA, FIXED, LINEAR, member, model

client = TestClient(app)

BAR = model({"a": (0, 0, 0), "b": (2, 0, 0)}, [("a", "b")], {"a": FIXED}, {"b": (1e3, 0, 0)}, LINEAR)


def test_health_reports_the_opensees_version():
    body = client.get("/health").json()
    assert body["status"] == "ok" and body["opensees"]


def test_capabilities_describe_the_solver():
    body = client.get("/capabilities").json()
    assert body["units"] == "SI"
    assert body["fidelities"] == ["linear", "nonlinear"] and body["defaultFidelity"] == "nonlinear"
    assert set(body["memberKinds"]) == {"beam", "brace", "cable"}
    assert body["connectionLaws"] == ["locked", "free", "elastic"]
    assert {"LLLLLL", "LLLFFF", "FFFFFF"} <= {item["pattern"] for item in body["connectionPatterns"]}
    assert body["defaultMemberProperties"]["elasticModulus"] > 0
    assert body["limits"]["maxNodes"] > 0 and body["limits"]["defaultTimeoutMs"] == 2000
    assert body["solver"].startswith("OpenSees ")


def test_analyze_returns_a_contract_shaped_success():
    response = client.post("/analyze", json=BAR)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    assert set(body) == {
        "status", "analysis", "components", "displacements", "reactions", "memberForces", "stability", "warnings",
    }
    assert set(body["analysis"]) == {"fidelity", "solver", "runtimeMs", "reasonCodes"}
    part = body["components"][0]
    assert set(part) == {
        "id", "nodeIds", "memberIds", "state", "reasonCodes", "resultsValid", "stability", "loadFactor", "residual",
    }
    assert abs(body["displacements"]["b"][0] - 1e3 * 2 / EA) < 1e-12
    assert len(body["displacements"]["a"]) == 6


def test_unstable_unsupported_and_invalid_models_still_return_http_200():
    floating = model({"a": (0, 0, 0), "b": (2, 0, 0)}, [("a", "b")], analysis=LINEAR)
    response = client.post("/analyze", json=floating)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "unstable" and body["message"] and body["components"][0]["state"] == "unstable"

    skew_slider = model({"a": (0, 0, 0), "b": (2, 1, 0)},
                        [member("a", "b", startConnection={"laws": ["free"] + ["locked"] * 5})], {"a": FIXED})
    response = client.post("/analyze", json=skew_slider)
    assert response.status_code == 200 and response.json()["status"] == "unsupported"

    dangling = model({"a": (0, 0, 0)}, [("a", "nowhere")])
    response = client.post("/analyze", json=dangling)
    assert response.status_code == 200 and response.json()["status"] == "error"


def test_schema_violations_return_422_with_an_error_result():
    cases = [
        {**BAR, "units": "imperial"},
        {**BAR, "surprise": True},
        {**BAR, "nodes": [{"id": "a", "position": [0, 0]}]},
        {**BAR, "members": [{**BAR["members"][0], "endFixity": "welded"}]},
        {**BAR, "members": [{**BAR["members"][0], "kind": "rope"}]},
        {**BAR, "analysis": {"fidelity": "exact"}},
        {**BAR, "analysis": {"timeoutMs": 0}},
    ]
    for body in cases:
        response = client.post("/analyze", json=body)
        assert response.status_code == 422
        result = response.json()
        assert result["status"] == "error" and result["message"].startswith("Invalid model:")


def preflight(test_client, origin):
    return test_client.options("/analyze", headers={"Origin": origin, "Access-Control-Request-Method": "POST"})


def test_cors_allows_any_local_port_by_default():
    # Vite moves to another port when 5173 is taken.
    for origin in ("http://localhost:5173", "http://localhost:5175", "http://127.0.0.1:4173"):
        assert preflight(client, origin).headers["access-control-allow-origin"] == origin
    assert "access-control-allow-origin" not in preflight(client, "https://example.com").headers
    assert "access-control-allow-origin" not in preflight(client, "http://localhost.example.com").headers


def test_configured_cors_origins_replace_the_local_default(monkeypatch):
    monkeypatch.setenv("DOF_OPENSEES_CORS_ORIGINS", "https://game.example")
    configured = TestClient(create_app())
    assert preflight(configured, "https://game.example").headers["access-control-allow-origin"] == "https://game.example"
    assert "access-control-allow-origin" not in preflight(configured, "http://localhost:5173").headers
