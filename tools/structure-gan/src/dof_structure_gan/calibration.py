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
MIN_SAMPLE = 15
"""Smallest number of structures a recommended limit may rest on."""


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


def report(export: Path, game: Path, max_displacement_ratio: float = LoadCase().max_displacement_ratio) -> str:
    """Human-readable agreement between oracle and game results (same order as the export).

    Only structures inside the oracle's displacement limit are compared: the
    utilisation limit is calibrated *given* the stiffness gate, and a game
    mechanism or error counts as disagreement, never as missing data.
    """
    oracle = json.loads(export.read_text())
    results = json.loads(game.read_text())
    if len(oracle) != len(results):
        raise ValueError(f"Export has {len(oracle)} structures but the game file has {len(results)}.")
    pairs = list(zip(oracle, results))
    stable = [(o, g) for o, g in pairs if o["stable"] and o["utilization"] is not None]
    unstable = [(o, g) for o, g in pairs if not o["stable"]]
    stiff = [(o, g) for o, g in stable if o["displacement_ratio"] <= max_displacement_ratio]
    lines = [
        f"{len(oracle)} structures: {len(stable)} oracle-stable, {len(unstable)} oracle-unstable, "
        f"{len(stiff)} within the displacement limit {max_displacement_ratio:.4f}",
        f"game mechanisms among stiff oracle-stable: {sum(g['mechanism'] for _, g in stiff)} of {len(stiff)}",
        f"game mechanisms among too-flexible oracle-stable: "
        f"{sum(g['mechanism'] for o, g in stable if o['displacement_ratio'] > max_displacement_ratio)} of {len(stable) - len(stiff)}",
        f"game mechanisms among oracle-unstable: {sum(g['mechanism'] for _, g in unstable)} of {len(unstable)}",
    ]
    if len(stiff) < 5:
        return "\n".join(lines + ["Too few stiff structures for a recommendation."])
    u = np.array([o["utilization"] for o, _ in stiff])
    ok = np.array([(not g["mechanism"]) and (not g["error"]) and g["maxU"] is not None and g["maxU"] <= 1.0 for _, g in stiff])
    comparable = [(o["utilization"], g["maxU"]) for o, g in stiff if g["maxU"] is not None and not g["error"]]
    if len(comparable) >= 3:
        lines.append(
            "utilisation correlation (oracle vs game, where the game gave a value): "
            f"{np.corrcoef(*zip(*comparable))[0, 1]:.2f}"
        )
    best = None
    lines.append("limit  n  agreement")
    for limit in (round(0.9 - 0.05 * i, 2) for i in range(17)):
        chosen = u <= limit + 1e-9  # utilisations equal to a grid value count as within it
        if chosen.sum() == 0:
            continue
        agreement = float(ok[chosen].mean())
        lines.append(f"{limit:.2f}  {int(chosen.sum())}  {agreement:.0%}")
        if best is None and chosen.sum() >= MIN_SAMPLE and agreement >= REQUIRED_AGREEMENT:
            best = (limit, int(chosen.sum()), agreement)
    if best is None:
        lines.append(f"No utilisation limit with at least {MIN_SAMPLE} structures reaches {REQUIRED_AGREEMENT:.0%} agreement; export more seeds or revisit the oracle.")
    else:
        lines.append(
            f"recommended max_utilization <= {best[0]:.2f} "
            f"({best[1]} structures, {best[2]:.0%} with no game mechanism and game utilisation <= 1)"
        )
    return "\n".join(lines)


def export_database(db_path: Path, out: Path) -> int:
    """Export every stored row's game save (with its id) for re-checking in the game."""
    import sqlite3

    with sqlite3.connect(db_path) as db:
        rows = db.execute("SELECT id, save_json FROM evolved_structures ORDER BY id").fetchall()
    out.write_text(json.dumps([{"id": ident, "save": json.loads(save)} for ident, save in rows]))
    return len(rows)


def failing_ids(export: Path, game: Path) -> list[str]:
    """Ids whose game verdict shows a mechanism, floating body, error or utilisation above 1."""
    items = json.loads(export.read_text())
    results = json.loads(game.read_text())
    if len(items) != len(results):
        raise ValueError(f"Export has {len(items)} structures but the game file has {len(results)}.")
    return [
        item["id"]
        for item, g in zip(items, results)
        if g["mechanism"] or g["floating"] or g["error"] or g["maxU"] is None or g["maxU"] > 1.0
    ]


def prune_database(db_path: Path, export: Path, game: Path) -> int:
    """Delete rows the game rejects; returns how many were removed."""
    import sqlite3

    ids = failing_ids(export, game)
    with sqlite3.connect(db_path) as db:
        db.executemany("DELETE FROM evolved_structures WHERE id = ?", [(i,) for i in ids])
    return len(ids)
