"""Measure the same small-motion, second-order and difficult fixtures in process and over loopback.

Run with the service virtualenv, OPENBLAS_NUM_THREADS=1, and the local service URL as argv[1].
Recorded times include result extraction. HTTP timings additionally include transport and serialization.
"""

import json
import math
import sys
import time
import urllib.request
from pathlib import Path

from dof_opensees.engine import analyze
from dof_opensees.schema import StructuralModel

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "services/opensees/tests"))
from helpers import EI, FIXED, model


def fixtures():
    euler = math.pi**2 * EI / (4 * 12**2)
    for name, ratio, shear, expected in [
        ("ordinary-sway", 0.55, 40, "success"), ("above-euler", 1.1, 0, "unresolved")
    ]:
        data = model({"base": (0, 0, 0), "tip": (0, 0, 12)}, [("base", "tip")],
                     {"base": FIXED}, {"tip": (shear, 0, -ratio*euler)})
        yield name, {**data, "analysis": {"type": "corotational", "segmentsPerFrame": 16}}, expected
    data = model({"a": (0, 0, 0), "b": (2, 0, 0)}, [("a", "b", "pinned", "pinned")],
                 {"a": FIXED}, {"b": (0, 0, -150)})
    data["members"][0]["law"] = {"kind": "cable", "area": 0.00036, "elasticModulus": 160e9, "restLength": 2.05}
    yield "slack-hanging-cable", {**data, "analysis": {"type": "corotational"}}, "success"


def p95_ms(run, expected):
    elapsed = []
    for i in range(25):
        start = time.perf_counter()
        result = run()
        duration = (time.perf_counter() - start) * 1000
        assert result["status"] == expected, result
        if i >= 5:
            elapsed.append(duration)
    return round(sorted(elapsed)[math.ceil(0.95*len(elapsed)) - 1], 3)


if __name__ == "__main__":
    for name, data, expected in fixtures():
        validated = StructuralModel.model_validate(data)
        request = urllib.request.Request(sys.argv[1].rstrip("/") + "/analyze",
                                         json.dumps(data).encode(), {"Content-Type": "application/json"})

        def http():
            with urllib.request.urlopen(request, timeout=10) as response:
                return json.load(response)

        print(json.dumps({"fixture": name, "expected": expected, "warm": 5, "measured": 20,
                          "solverP95ms": p95_ms(lambda: analyze(validated), expected),
                          "loopbackP95ms": p95_ms(http, expected)}))
