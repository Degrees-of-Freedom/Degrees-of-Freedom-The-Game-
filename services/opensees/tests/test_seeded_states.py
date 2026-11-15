"""Reproducible stress matrix for the current linear OpenSees entry point.

The elastic cases use an isotropic-in-bending cantilever on a random 3D axis.
Random subdivisions, member directions and input ordering preserve that exact
solution. Invalid references and real mechanisms must never return a force field.
"""

import json
import math
import random
import statistics
import time
from collections import Counter

import numpy as np

from helpers import EA, EI, FIXED, PINNED, run


def generated_case(seed):
    rng = random.Random(seed)
    axis = np.array([rng.uniform(-1, 1) for _ in range(3)])
    axis /= np.linalg.norm(axis)
    origin = np.array([rng.uniform(-8, 8) for _ in range(3)])
    length = rng.uniform(0.5, 6)
    count = rng.randint(1, 4)
    coordinates = [(str(i), origin + axis * length * i / count) for i in range(count + 1)]
    rng.shuffle(coordinates)
    members = [(str(i), str(i + 1)) for i in range(count)]
    members = [edge if rng.getrandbits(1) else edge[::-1] for edge in members]
    rng.shuffle(members)
    nodes = dict(coordinates)
    tip = str(count)
    load = np.array([rng.uniform(-1500, 1500) for _ in range(3)])
    family = seed % 10
    if family == 0:
        return "unknown-node", run(nodes, members + [(tip, "missing")]), None
    if family == 1:
        nodes["duplicate-position"] = nodes[tip]
        return "zero-length", run(nodes, members + [(tip, "duplicate-position")]), None
    if family == 2:
        # A pin-ended single bar cannot restrain its free tip transversely,
        # including when no load does work on the mode.
        loads = {tip: load} if seed % 20 == 2 else {}
        return "mechanism", run({"0": nodes["0"], tip: nodes[tip]},
                                [("0", tip, "pinned", "pinned")], {"0": PINNED}, loads), None
    if family == 3:
        return "floating", run(nodes, members, {}, {tip: load}), None
    axial = axis * np.dot(load, axis)
    expected = axial * length / EA + (load - axial) * length**3 / (3 * EI)
    moment = np.cross(axis * length, load)
    result = run(nodes, members, {"0": FIXED}, {tip: load})
    return "cantilever", result, (tip, expected, load, moment, length)


def test_10000_seeded_structural_states():
    counts = Counter()
    elapsed_ms = []
    maximum = {"displacement": 0.0, "forceResidual": 0.0, "momentResidual": 0.0}
    for seed in range(10000):
        started = time.perf_counter()
        family, result, reference = generated_case(seed)
        elapsed_ms.append((time.perf_counter() - started) * 1000)
        counts[family] += 1
        # Reject non-finite output at any depth, including diagnostic modes.
        json.dumps(result, allow_nan=False)
        if reference is None:
            status = "error" if family in {"unknown-node", "zero-length"} else "unstable"
            assert result["status"] == status, (seed, family, result["status"])
            assert not any(key in result for key in ("reactions", "displacements", "memberForces")), seed
            continue
        assert result["status"] == "success", (seed, result["status"])
        tip, expected, force, moment, length = reference
        reaction = np.array(result["reactions"]["0"])
        # Characteristic scales use net load and load times member length.
        # A metre-scale absolute displacement floor handles near-zero solutions.
        force_scale = max(np.linalg.norm(force), 1.0)
        errors = {
            "displacement": np.linalg.norm(result["displacements"][tip][:3] - expected)
                            / max(np.linalg.norm(expected), 1e-12),
            "forceResidual": np.linalg.norm(reaction[:3] + force) / force_scale,
            "momentResidual": np.linalg.norm(reaction[3:] + moment) / (force_scale * length),
        }
        for key, value in errors.items():
            maximum[key] = max(maximum[key], float(value))
            limit = 1e-3 if key == "displacement" else 1e-5
            assert math.isfinite(value) and value <= limit, (seed, key, value)
    print(json.dumps({"seeds": [0, 9999], "families": counts, "maximum": maximum,
                      "generatorAndSolveP95ms": statistics.quantiles(elapsed_ms, n=100)[94]}))
