"""Repeatable calibration of the physics oracle against the game's own solver.

The oracle's ``max_utilization`` is only meaningful relative to the game's design
check, so it must be re-derived whenever the oracle, section or load case
changes. Workflow:

1. ``dof-structure-gan calibrate-export --out seeds.json`` writes seed structures
   as game saves together with the oracle's utilisation and displacement ratio.
2. From the repository root, run the Vitest calibration harness::

       DOF_CALIBRATION_IN=seeds.json DOF_CALIBRATION_OUT=game.json \\
         npx vitest run apps/web/src/game/calibration.test.ts

3. ``dof-structure-gan calibrate-report --export seeds.json --game game.json``
   prints agreement statistics and the largest oracle utilisation limit for
   which at least 98% of structures also satisfy the game's check.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .physics import LoadCase, analyse
from .seeding import random_seed_structure
from .store import voxel_save, with_loads

REQUIRED_AGREEMENT = 0.98


def export_seeds(path: Path, count: int, seed: int, case: LoadCase | None = None) -> int:
    """Write up to ``count`` stable seeds (any utilisation) with oracle numbers; returns how many."""
    case = case or LoadCase()
    rng = np.random.default_rng(seed)
    items = []
    while len(items) < count:
        structure = random_seed_structure(rng)
        if structure is None:
            continue
        result = analyse(structure, case)
        items.append({
            "stable": result.stable,
            "utilization": result.utilization,
            "displacement_ratio": result.displacement_ratio,
            "save": with_loads(voxel_save(structure), structure, case.vertical_n / 1000),
        })
    path.write_text(json.dumps(items))
    return len(items)


def report(export: Path, game: Path) -> str:
    """Human-readable agreement between oracle and game results (same order as the export)."""
    oracle = json.loads(export.read_text())
    results = json.loads(game.read_text())
    if len(oracle) != len(results):
        raise ValueError(f"Export has {len(oracle)} structures but the game file has {len(results)}.")
    stable = [(o, g) for o, g in zip(oracle, results) if o["stable"] and o["utilization"] is not None]
    unstable = [(o, g) for o, g in zip(oracle, results) if not o["stable"]]
    usable = [(o, g) for o, g in stable if g["maxU"] is not None and not g["error"]]
    lines = [
        f"{len(oracle)} structures: {len(stable)} oracle-stable, {len(unstable)} oracle-unstable",
        f"game mechanisms among oracle-stable: {sum(g['mechanism'] for _, g in stable)}",
        f"game mechanisms among oracle-unstable: {sum(g['mechanism'] for _, g in unstable)} of {len(unstable)}",
    ]
    if len(usable) < 5:
        return "\n".join(lines + ["Too few comparable structures for a recommendation."])
    u = np.array([o["utilization"] for o, _ in usable])
    g = np.array([x["maxU"] for _, x in usable])
    lines.append(f"utilisation correlation (oracle vs game): {np.corrcoef(u, g)[0, 1]:.2f}")
    best = None
    for limit in (round(0.9 - 0.05 * i, 2) for i in range(17)):
        # Tiny epsilon: utilisations that equal a grid value must count as within it.
        chosen = u <= limit + 1e-9
        if chosen.sum() >= 5 and (g[chosen] <= 1.0).mean() >= REQUIRED_AGREEMENT:
            best = (round(float(limit), 2), int(chosen.sum()), float((g[chosen] <= 1.0).mean()))
            break
    if best is None:
        lines.append("No utilisation limit reaches the required agreement; revisit the oracle.")
    else:
        lines.append(
            f"recommended max_utilization <= {best[0]:.2f} ({best[1]} structures, {best[2]:.0%} game utilisation <= 1)"
        )
    return "\n".join(lines)
