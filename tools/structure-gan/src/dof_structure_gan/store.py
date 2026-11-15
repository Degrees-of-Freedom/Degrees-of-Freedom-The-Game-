"""SQLite persistence of excellent structures.

The database is a portable file like ``apps/web/public/structures/structures.sqlite``.
Each row keeps the numbers a reader needs to judge the structure plus a
``save_json`` column: a ``dof-voxel-save`` v1 document the game can load.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .evaluation import Evaluation
from .lattice import CELL_METRES, Structure
from .preview import render_svg

SCHEMA_VERSION = 2
ORACLE = "dof_opensees.engine.analyze; game shs card (SHS 100x6, S355), fixed joints, fixed foundations, self-weight, ULS-factored loads"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_info (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS evolved_structures (
  id TEXT PRIMARY KEY,
  canonical_hash TEXT NOT NULL UNIQUE,
  run_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('seed', 'generator')),
  created_at TEXT NOT NULL,
  name TEXT NOT NULL,
  member_count INTEGER NOT NULL,
  node_count INTEGER NOT NULL,
  width_m REAL NOT NULL, depth_m REAL NOT NULL, height_m REAL NOT NULL,
  fitness REAL NOT NULL,
  structural_score REAL NOT NULL,
  aesthetic_score REAL NOT NULL,
  utilization REAL NOT NULL,
  max_displacement_m REAL NOT NULL,
  displacement_ratio REAL NOT NULL,
  curvature REAL NOT NULL, organic REAL NOT NULL, asymmetry REAL NOT NULL,
  dimensionality REAL NOT NULL, complexity REAL NOT NULL, dynamism REAL NOT NULL,
  oracle TEXT NOT NULL,
  save_json TEXT NOT NULL,
  preview_svg TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS evolved_fitness ON evolved_structures (fitness DESC);
"""


def voxel_save(structure: Structure) -> dict:
    """The game's ``dof-voxel-save`` v1 for a structure (``levelId`` ``library``).

    Every member is an ``shs`` with rigid ends (``joint``), ground nodes that
    carry supports are foundations and loads are downward point loads in kN.
    """
    key = lambda n: ",".join(map(str, n))  # noqa: E731 - local formatter
    attrs: dict[str, dict] = {}
    for node in sorted(structure.nodes):
        attrs[key(node)] = {"joint": True}
    for node in structure.supports:
        attrs[key(node)]["found"] = True
    return {
        "format": "dof-voxel-save",
        "version": 1,
        "levelId": "library",
        "model": {
            "members": [
                {"id": i + 1, "a": key(a), "b": key(b), "type": "shs"}
                for i, (a, b) in enumerate(sorted(structure.edges))
            ],
            "attrs": attrs,
            "nextId": len(structure.edges) + 1,
        },
    }


def with_loads(save: dict, structure: Structure, kilonewtons: float) -> dict:
    for node in structure.loads:
        save["model"]["attrs"][",".join(map(str, node))]["load"] = kilonewtons
    return save


class StructureStore:
    """Thin, explicit wrapper over the ``evolved_structures`` table."""

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(self.path)
        self._db.executescript(_SCHEMA)
        self._db.execute("INSERT OR IGNORE INTO schema_info VALUES ('schema_version', ?)", (str(SCHEMA_VERSION),))
        self._db.commit()

    def close(self) -> None:
        self._db.close()

    def __enter__(self) -> StructureStore:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def __len__(self) -> int:
        return int(self._db.execute("SELECT COUNT(*) FROM evolved_structures").fetchone()[0])

    def add(
        self, evaluation: Evaluation, *, run_id: str, generation: int, source: str, load_kn: float
    ) -> str | None:
        """Store an excellent structure. Returns its id, or ``None`` if it was a duplicate."""
        if not evaluation.excellent or evaluation.aesthetics is None:
            raise ValueError("Only excellent evaluations may be stored.")
        s, a, p = evaluation.structure, evaluation.aesthetics, evaluation.physics
        assert p.utilization is not None and p.max_displacement_m is not None and p.displacement_ratio is not None
        digest = s.canonical_key()
        ident = f"evo-{digest[:10]}"
        nodes = list(s.nodes)
        width, depth, height = (
            (max(n[i] for n in nodes) - min(n[i] for n in nodes)) * CELL_METRES for i in range(3)
        )
        row = {
            "id": ident, "canonical_hash": digest, "run_id": run_id, "generation": generation, "source": source,
            "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "name": f"Evolved {digest[:6]}", "member_count": len(s.edges), "node_count": len(nodes),
            "width_m": width, "depth_m": depth, "height_m": height,
            "fitness": evaluation.fitness, "structural_score": evaluation.structural, "aesthetic_score": a.total,
            "utilization": p.utilization, "max_displacement_m": p.max_displacement_m,
            "displacement_ratio": p.displacement_ratio,
            "curvature": a.curvature, "organic": a.organic, "asymmetry": a.asymmetry,
            "dimensionality": a.dimensionality, "complexity": a.complexity, "dynamism": a.dynamism,
            "oracle": ORACLE, "save_json": json.dumps(with_loads(voxel_save(s), s, load_kn), separators=(",", ":")),
            "preview_svg": render_svg(s),
        }
        columns = ", ".join(row)
        marks = ", ".join(f":{k}" for k in row)
        cursor = self._db.execute(f"INSERT INTO evolved_structures ({columns}) VALUES ({marks}) ON CONFLICT(canonical_hash) DO NOTHING", row)
        self._db.commit()
        return ident if cursor.rowcount else None

    def top(self, limit: int = 10) -> list[sqlite3.Row]:
        self._db.row_factory = sqlite3.Row
        try:
            return self._db.execute(
                "SELECT id, name, source, member_count, fitness, utilization, curvature, organic, asymmetry, "
                "dimensionality, complexity, dynamism FROM evolved_structures ORDER BY fitness DESC LIMIT ?",
                (limit,),
            ).fetchall()
        finally:
            self._db.row_factory = None
