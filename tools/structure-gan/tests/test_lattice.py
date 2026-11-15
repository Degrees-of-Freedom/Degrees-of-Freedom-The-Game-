import numpy as np
import pytest

from dof_structure_gan.lattice import (
    CHANNELS, GRID, LOAD_CHANNEL, N_EDGE_CHANNELS, OFFSET_INDEX, OFFSETS, Structure, canonical_edge,
)
from conftest import chain, make


def test_offsets_are_primitive_and_canonically_signed():
    assert N_EDGE_CHANNELS == 49 and CHANNELS == 50
    for off in OFFSETS:
        assert next(c for c in off if c) > 0
        assert max(map(abs, off)) <= 2 and off != (2, 0, 0) and off != (2, 2, 0)
    assert len(OFFSET_INDEX) == len(OFFSETS)


def test_tensor_marks_each_member_and_load_once(column):
    tensor = column.to_tensor()
    assert tensor.shape == (CHANNELS, GRID, GRID, GRID)
    assert tensor[: N_EDGE_CHANNELS].sum() == len(column.edges)
    assert tensor[LOAD_CHANNEL].sum() == len(column.loads)


@pytest.mark.parametrize("edge", [((0, 0, 0), (2, 2, 0)), ((0, 0, 0), (4, 0, 0)), ((3, 0, 0), (0, 0, 0))])
def test_rejects_non_primitive_or_unordered_edges(edge):
    with pytest.raises(ValueError):
        Structure(frozenset([edge]), frozenset(), frozenset())


def test_rejects_out_of_bounds_and_raised_supports():
    with pytest.raises(ValueError):
        Structure(frozenset([((0, 0, 0), (GRID, 0, 0))]), frozenset(), frozenset())
    with pytest.raises(ValueError):
        make(chain((1, 1, 0), (1, 1, 1)), [(1, 1, 1)], [])
    with pytest.raises(ValueError):
        make(chain((1, 1, 0), (1, 1, 1)), [(1, 1, 0)], [(9, 9, 9)])


def test_canonical_key_ignores_footprint_symmetry_and_translation(arc):
    keys = {arc.transformed(op).canonical_key() for op in range(8)}
    assert len(keys) == 1
    shifted = make(
        [canonical_edge((a[0] + 1, a[1], a[2]), (b[0] + 1, b[1], b[2])) for a, b in arc.edges],
        [(3, 5, 0), (10, 5, 0)], [(7, 5, 4)],
    )
    assert shifted.canonical_key() == arc.canonical_key()


def test_canonical_key_distinguishes_shapes(arc, column):
    assert arc.canonical_key() != column.canonical_key()


def test_transforms_stay_valid(arc):
    for op in range(8):
        moved = arc.transformed(op)
        assert len(moved.edges) == len(arc.edges)
        assert np.isclose(moved.to_tensor()[:N_EDGE_CHANNELS].sum(), len(arc.edges))


def test_json_round_trip_and_validation(arc):
    from dof_structure_gan.lattice import Structure

    assert Structure.from_json(arc.to_json()) == arc
    bad = arc.to_json()
    bad["loads"] = [[1, 2]]
    with pytest.raises(ValueError):
        Structure.from_json(bad)


def test_every_member_offset_fits_the_games_shs_length_limit():
    """The game's `shs` card allows members of at most 3 cells (`maxCells`)."""
    import math

    assert max(math.hypot(*o) for o in OFFSETS) <= 3.0 + 1e-9
