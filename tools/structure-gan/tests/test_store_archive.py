import json
import sqlite3
from dataclasses import replace

import numpy as np
import pytest

from dof_structure_gan.archive import Archive, cell_of
from dof_structure_gan.evaluation import Criteria, evaluate
from dof_structure_gan.physics import LoadCase
from dof_structure_gan.store import StructureStore, voxel_save
from conftest import chain, make


@pytest.fixture
def excellent(arc):
    # Relax thresholds so the small fixture counts as excellent; the gate under test is storage, not taste.
    e = evaluate(arc, criteria=Criteria(min_fitness=0.0, min_component=0.0, min_members=1))
    assert e.excellent
    return e


def test_evaluate_zeroes_failures(column):
    e = evaluate(make(chain((1, 1, 0), (1, 1, 1)), [(1, 1, 0)], [(1, 1, 1)]), criteria=Criteria())
    assert not e.excellent  # too small to be excellent
    bad = evaluate(column, case=LoadCase(vertical_n=5e8))
    assert bad.fitness == 0.0 and bad.aesthetics is None and not bad.excellent


def test_archive_keeps_best_per_cell_and_dedupes(excellent):
    archive = Archive()
    assert archive.offer(excellent) and not archive.offer(excellent)
    better = replace(excellent, fitness=excellent.fitness + 0.1, structure=excellent.structure.transformed(0))
    # Same canonical structure is a duplicate even when its score changes.
    assert not archive.offer(better)
    assert len(archive) == 1 and cell_of(excellent) in {cell_of(e) for e in archive.elites}
    samples = archive.sample(5, np.random.default_rng(0))
    assert len(samples) == 5 and all(s.canonical_key() == excellent.structure.canonical_key() for s in samples)


def test_empty_archive_cannot_be_sampled():
    with pytest.raises(ValueError):
        Archive().sample(1, np.random.default_rng(0))


def test_voxel_save_matches_the_game_format(arc):
    save = voxel_save(arc)
    assert save["format"] == "dof-voxel-save" and save["version"] == 1
    model = save["model"]
    assert model["nextId"] == len(arc.edges) + 1
    assert [m["id"] for m in model["members"]] == list(range(1, len(arc.edges) + 1))
    assert model["attrs"]["2,5,0"] == {"joint": True, "found": True}
    assert all(m["type"] == "shs" for m in model["members"])


def test_store_roundtrip_and_duplicates(tmp_path, excellent):
    path = tmp_path / "evolved.sqlite"
    with StructureStore(path) as store:
        ident = store.add(excellent, run_id="r", generation=3, source="generator", load_kn=8.0)
        assert ident and ident.startswith("evo-")
        assert store.add(excellent, run_id="r2", generation=4, source="seed", load_kn=8.0) is None
        assert len(store) == 1
        assert store.top(1)[0]["source"] == "generator"
    row = sqlite3.connect(path).execute("SELECT save_json, member_count, utilization FROM evolved_structures").fetchone()
    save = json.loads(row[0])
    assert row[1] == len(save["model"]["members"]) and 0 < row[2] < 1
    assert save["model"]["attrs"]["6,5,4"]["load"] == 8.0


def test_store_refuses_non_excellent(tmp_path, column):
    with StructureStore(tmp_path / "x.sqlite") as store, pytest.raises(ValueError):
        store.add(evaluate(column, criteria=Criteria(min_fitness=2.0)), run_id="r", generation=0, source="seed", load_kn=1)


def test_source_is_constrained(tmp_path, excellent):
    with StructureStore(tmp_path / "x.sqlite") as store, pytest.raises(sqlite3.IntegrityError):
        store.add(excellent, run_id="r", generation=0, source="oracle", load_kn=1)


def test_preview_svg_is_stored_and_wellformed(tmp_path, excellent):
    import xml.etree.ElementTree as ET

    from dof_structure_gan.preview import render_svg

    svg = render_svg(excellent.structure)
    root = ET.fromstring(svg)
    assert root.tag.endswith("svg")
    assert svg.count("<line") == len(excellent.structure.edges)
    with StructureStore(tmp_path / "p.sqlite") as store:
        store.add(excellent, run_id="r", generation=0, source="seed", load_kn=1)
    assert sqlite3.connect(tmp_path / "p.sqlite").execute("SELECT preview_svg FROM evolved_structures").fetchone()[0] == svg
