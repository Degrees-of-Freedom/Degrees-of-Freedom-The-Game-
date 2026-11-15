from dof_structure_gan.cli import main
from dof_structure_gan.evaluation import Criteria, evaluate
from dof_structure_gan.store import StructureStore


def test_top_lists_stored_structures(tmp_path, capsys, arc):
    db = tmp_path / "evolved.sqlite"
    with StructureStore(db) as store:
        store.add(
            evaluate(arc, criteria=Criteria(min_fitness=0.0, min_component=0.0, min_members=1)),
            run_id="r", generation=1, source="seed", load_kn=1.5,
        )
    assert main(["top", "--db", str(db), "--limit", "5"]) == 0
    out = capsys.readouterr().out
    assert "evo-" in out and "source=seed" in out and "member_count=" in out
