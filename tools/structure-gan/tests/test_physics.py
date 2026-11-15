import pytest

from dof_structure_gan.physics import LoadCase, analyse, build_model
from conftest import chain, make


def test_model_uses_metres_fixed_supports_and_factored_loads(column):
    model = build_model(column, LoadCase(vertical_n=1000.0, lateral_fraction=0.0))
    assert model["units"] == "SI" and len(model["members"]) == 4
    assert max(n["position"][2] for n in model["nodes"]) == pytest.approx(8.0)
    assert model["supports"][0]["restrained"] == [True] * 6
    # 4 members of 2 m at 176 N/m, factored 1.35, plus one applied 1000 N factored 1.5.
    total = -sum(load["force"][2] for load in model["loads"])
    assert total == pytest.approx(1.35 * 176.0 * 8.0 + 1.5 * 1000.0)
    top = max(model["loads"], key=lambda load: -load["force"][2])
    assert top["force"][2] == pytest.approx(-(1.35 * 176.0 * 1.0 + 1.5 * 1000.0))


def test_lateral_push_applies_only_at_loaded_nodes(column):
    model = build_model(column, LoadCase(vertical_n=1000.0, lateral_fraction=0.1))
    pushed = [load for load in model["loads"] if load["force"][0] != 0]
    assert len(pushed) == 1 and pushed[0]["force"][0] == pytest.approx(1.5 * 100.0 / 2**0.5)


def test_column_is_stable_and_passes(column):
    r = analyse(column)
    assert r.stable and r.passes and r.residual is not None and r.residual < 1e-6
    assert r.utilization is not None and 0 < r.utilization < 0.45


def test_overload_is_stable_but_fails_limits(column):
    r = analyse(column, LoadCase(vertical_n=20_000_000.0))
    assert r.stable and not r.within_limits and not r.passes


def test_long_cantilever_deflects_beyond_limit():
    arm = make(chain((1, 1, 0), (1, 1, 1), (1, 1, 2), *[(x, 1, 2) for x in range(2, 12)]), [(1, 1, 0)], [(11, 1, 2)])
    r = analyse(arm, LoadCase(vertical_n=40_000.0))
    assert r.stable and not r.passes


def test_load_case_validates():
    with pytest.raises(ValueError):
        LoadCase(vertical_n=0)
    with pytest.raises(ValueError):
        LoadCase(lateral_fraction=1.5)


def test_both_wind_directions_take_the_worse_case(column):
    one = analyse(column, LoadCase(lateral_fraction=0.3))
    both = analyse(column, LoadCase(lateral_fraction=0.3, both_wind_directions=True))
    assert both.utilization is not None and one.utilization is not None
    assert both.utilization >= one.utilization - 1e-12 and both.stable
    # A column is symmetric in wind sign, so the worst case equals the single case.
    assert both.utilization == pytest.approx(one.utilization, rel=1e-6)


def test_reversed_wind_flips_lateral_forces(column):
    forward = build_model(column, LoadCase(), wind=1.0)["loads"]
    reverse = build_model(column, LoadCase(), wind=-1.0)["loads"]
    pushed = [(f, r) for f, r in zip(forward, reverse) if f["force"][0] != 0]
    assert pushed and all(f["force"][0] == pytest.approx(-r["force"][0]) for f, r in pushed)
    assert all(f["force"][2] == r["force"][2] for f, r in zip(forward, reverse))
