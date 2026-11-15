import json

import pytest

from dof_structure_gan.calibration import export_seeds, report


def test_export_then_report_round_trip(tmp_path):
    export = tmp_path / "seeds.json"
    assert export_seeds(export, count=6, seed=3) == 6
    items = json.loads(export.read_text())
    assert all(i["save"]["format"] == "dof-voxel-save" for i in items)
    game = tmp_path / "game.json"
    game.write_text(json.dumps([{"mechanism": False, "floating": 0, "error": None, "maxU": 0.5}] * 6))
    text = report(export, game)
    assert "6 structures" in text


def test_report_recommends_the_largest_agreeing_limit(tmp_path):
    export, game = tmp_path / "e.json", tmp_path / "g.json"
    # Oracle utilisation u maps to game utilisation 2u: agreement (<= 1) holds up to u = 0.5 (20 structures).
    oracle = [{"stable": True, "utilization": u / 40, "displacement_ratio": 0.001, "save": {}} for u in range(1, 37)]
    export.write_text(json.dumps(oracle))
    game.write_text(json.dumps([
        {"mechanism": False, "floating": 0, "error": None, "maxU": 2 * o["utilization"]} for o in oracle
    ]))
    assert "recommended max_utilization <= 0.50" in report(export, game)


def test_report_rejects_mismatched_files(tmp_path):
    export, game = tmp_path / "e.json", tmp_path / "g.json"
    export.write_text(json.dumps([{"stable": False, "utilization": None, "displacement_ratio": None, "save": {}}]))
    game.write_text("[]")
    with pytest.raises(ValueError):
        report(export, game)


def test_report_counts_game_mechanisms_as_disagreement_and_ignores_flexible_seeds(tmp_path):
    export, game = tmp_path / "e.json", tmp_path / "g.json"
    stiff = [{"stable": True, "utilization": 0.1 * i, "displacement_ratio": 0.001, "save": {}} for i in range(1, 9)]
    flexible = [{"stable": True, "utilization": 0.05, "displacement_ratio": 0.5, "save": {}}] * 20
    export.write_text(json.dumps(stiff + flexible))
    fine = {"mechanism": False, "floating": 0, "error": None, "maxU": 0.4}
    broken = {"mechanism": True, "floating": 0, "error": None, "maxU": None}
    # The game rejects the stiff structure with oracle utilisation 0.8 and every flexible one.
    verdicts = [fine] * 7 + [broken] + [broken] * 20
    game.write_text(json.dumps(verdicts))
    text = report(export, game)
    assert "8 within the displacement limit" in text
    assert "limit  n  agreement" in text and "No utilisation limit with at least 15" in text


def test_database_export_and_prune_remove_only_game_rejects(tmp_path, arc):
    import sqlite3

    from dof_structure_gan.calibration import export_database, failing_ids, prune_database
    from dof_structure_gan.evaluation import Criteria, evaluate
    from dof_structure_gan.store import StructureStore
    from conftest import chain, make

    db, export, game = tmp_path / "d.sqlite", tmp_path / "x.json", tmp_path / "g.json"
    other = make(chain((3, 3, 0), (3, 3, 1), (3, 3, 2), (3, 3, 3)), [(3, 3, 0)], [(3, 3, 3)])
    easy = Criteria(min_fitness=0.0, min_component=0.0, min_members=1)
    with StructureStore(db) as store:
        ids = [store.add(evaluate(s, criteria=easy), run_id="r", generation=0, source="seed", load_kn=1) for s in (arc, other)]
    assert export_database(db, export) == 2
    order = [item["id"] for item in json.loads(export.read_text())]
    verdict = {"mechanism": False, "floating": 0, "error": None, "maxU": 0.5}
    bad = dict(verdict, maxU=1.2)
    game.write_text(json.dumps([bad if i == ids[0] else verdict for i in order]))
    assert failing_ids(export, game) == [ids[0]]
    assert prune_database(db, export, game) == 1
    assert [r[0] for r in sqlite3.connect(db).execute("SELECT id FROM evolved_structures")] == [ids[1]]
