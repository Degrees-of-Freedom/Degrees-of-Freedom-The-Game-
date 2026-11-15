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
    # Oracle utilisation u maps to game utilisation 2u: agreement (<= 1) holds up to u = 0.5.
    oracle = [{"stable": True, "utilization": u / 20, "displacement_ratio": 0.0, "save": {}} for u in range(1, 19)]
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
