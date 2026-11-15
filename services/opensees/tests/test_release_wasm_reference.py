"""Cross-check the release WASM binary with independently assembled OpenSees models.

Both programs use SI units, dead nodal loads and 16 Euler-Bernoulli beam
subdivisions on the sway/buckling cases. No server or private state is needed.
"""
import json
import math
from pathlib import Path
import subprocess

import pytest
from fastapi.testclient import TestClient
from dof_opensees.app import app
from helpers import EI, FIXED, P, model

ROOT = Path(__file__).resolve().parents[3]
CLIENT = TestClient(app)
STEEL = {"id": "s", "A": P.area, "E": P.elastic_modulus, "G": P.shear_modulus,
         "Iy": P.inertia_y, "Iz": P.inertia_z, "J": P.torsion_constant}


def wasm(data, sections, members):
    request = {"model": {"nodes": data["nodes"], "sections": sections, "members": members,
                         "foundations": [dict(s, id=s["nodeId"]) for s in data["supports"]],
                         "loads": [dict(load, id=str(i)) for i, load in enumerate(data["loads"])]},
               "options": {"fidelity": "nonlinear", "subdivisions": 16}}
    out = subprocess.run(["node", str(ROOT/"scripts/physics/analyze-wasm.mjs")],
                         input=json.dumps(request), text=True, capture_output=True, check=True)
    return json.loads(out.stdout)


def opensees(data):
    response = CLIENT.post("/analyze", json={**data, "analysis": {"fidelity": "nonlinear", "segmentsPerFrame": 16}})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["analysis"]["fidelity"] == "nonlinear"
    return result


def column(ratio, lateral):
    euler = math.pi**2 * EI/(4*12**2)
    return model({"base": (0, 0, 0), "tip": (0, 0, 12)}, [("base", "tip")], {"base": FIXED},
                 {"tip": (lateral, 0, -ratio*euler)})


def frame_wasm(data):
    member = {"id": "m", "startNodeId": "base", "endNodeId": "tip", "sectionId": "s"}
    return wasm(data, [STEEL], [member])


def test_second_order_sway_and_signed_reaction():
    data = column(0.55, 40)
    actual, reference = frame_wasm(data), opensees(data)
    assert actual["components"][0]["resultsValid"] and reference["status"] == "success"
    dx = actual["nodes"]["tip"]["displacement"][0]
    print("WASM/OpenSees sway (m)", dx, reference["displacements"]["tip"][0])
    assert dx == pytest.approx(reference["displacements"]["tip"][0], rel=.01)
    assert actual["foundations"]["base"]["reaction"] == pytest.approx(reference["reactions"]["base"], rel=.01, abs=1e-5)


def test_buckling_load_against_opensees_positive_final_tangent():
    low, high = 0.90, 1.10
    for _ in range(8):
        mid = (low + high)/2
        reference = opensees(column(mid, 0))
        if reference["status"] == "success":
            assert reference["components"][0]["resultsValid"]
            low = mid
        else:
            scope = reference["components"][0]
            assert reference["status"] == scope["state"] == "unstable"
            assert "load_induced_instability" in scope["reasonCodes"]
            assert not scope["resultsValid"] and "base" not in reference["reactions"]
            assert "tip" in scope["stability"]["unstableNodeIds"]
            assert scope["stability"]["modes"]
            high = mid
    actual = frame_wasm(column(1.2, 0))["components"][0]
    assert actual["flags"]["loadInducedInstability"] and not actual["resultsValid"]
    # Also compare to the service's independently tracked limiting load
    # within a single run, in addition to the full-load classification sweep.
    limit = opensees(column(1.2, 0))["components"][0]
    assert "load_induced_instability" in limit["reasonCodes"]
    assert actual["criticalLoadFactor"] == pytest.approx(limit["loadFactor"], rel=.02)
    print("Buckling / Euler, WASM and OpenSees bracket", 1.2*actual["criticalLoadFactor"], low, high)
    assert 1.2*actual["criticalLoadFactor"] == pytest.approx((low+high)/2, rel=.02)


def test_two_leg_cable_against_independent_nonlinear_equilibrium():
    span, sag0, sag = 2., .04, .23
    rest = math.hypot(span, sag0)*.9998
    force = 160e9*.00036*(math.hypot(span,sag)/rest-1)
    data = model({"a": (-span,0,0), "c": (0,0,-sag0), "b": (span,0,0)},
                 [("a", "c", "pinned", "pinned"), ("b", "c", "pinned", "pinned")],
                 {"a": FIXED, "b": FIXED, "c": [True, True, False, False, False, False]},
                 {"c": (0,0,-2*force*sag/math.hypot(span,sag))})
    for member in data["members"]:
        member["law"] = {"kind": "cable", "elasticModulus": 160e9, "area": .00036, "restLength": rest}
    reference = opensees(data)
    actual = wasm(data, [{"id": "c", "E": 160e9, "A": .00036}],
                  [{"id": m["id"], "startNodeId": m["startNodeId"], "endNodeId": m["endNodeId"],
                    "sectionId": "c", "kind": "cable", "restLength": rest} for m in data["members"]])
    assert reference["status"] == "success" and actual["components"][0]["resultsValid"]
    print("Cable tension (N), WASM and OpenSees", actual["members"]["a-c"]["forces"]["end"][0], reference["memberForces"]["a-c"]["axial"])
    assert actual["nodes"]["c"]["displacement"][2] == pytest.approx(reference["displacements"]["c"][2], rel=.01)
    assert actual["members"]["a-c"]["forces"]["end"][0] == pytest.approx(reference["memberForces"]["a-c"]["axial"], rel=.01)
