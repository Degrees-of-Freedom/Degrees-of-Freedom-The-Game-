import numpy as np

from dof_structure_gan.decode import MIN_CLEARANCE_CELLS, decode, segment_distances
from dof_structure_gan.lattice import CHANNELS, GRID, LOAD_CHANNEL, OFFSET_INDEX
from conftest import make


def probs(edges, loads=()):
    p = np.zeros((CHANNELS, GRID, GRID, GRID), dtype=np.float32)
    for (a, b), value in edges:
        p[(OFFSET_INDEX[tuple(y - x for x, y in zip(a, b))], *a)] = value
    for node, value in loads:
        p[(LOAD_CHANNEL, *node)] = value
    return p


def column_edges(top=5, x=3, y=3):
    return [(((x, y, z), (x, y, z + 1)), 0.9) for z in range(top)]


def test_segment_distance_known_values():
    d = segment_distances(
        np.array([0.0, 0, 0]), np.array([1.0, 0, 0]),
        np.array([[0.0, 1, 0], [3.0, 0, 0], [0.5, 0, 2]]), np.array([[1.0, 1, 0], [4.0, 0, 0], [0.5, 1, 2]]),
    )
    np.testing.assert_allclose(d, [1.0, 2.0, 2.0])


def test_decodes_a_grounded_column_with_loads():
    s = decode(probs(column_edges(), loads=[((3, 3, 5), 0.8)]))
    assert s is not None and len(s.edges) == 5
    assert s.supports == {(3, 3, 0)} and s.loads == {(3, 3, 5)}


def test_floating_bodies_and_tiny_bodies_are_rejected():
    assert decode(probs([(((3, 3, 4), (3, 3, 5)), 0.9)] * 1 + column_edges(2, 8, 8)[:1])) is None
    floating = [(((3, 3, z), (3, 3, z + 1)), 0.9) for z in range(3, 9)]
    assert decode(probs(floating)) is None


def test_only_largest_grounded_body_survives():
    p = probs(column_edges(6, 3, 3) + column_edges(4, 9, 9))
    s = decode(p)
    assert s is not None and len(s.edges) == 6


def test_crossing_members_without_shared_node_clash():
    # (0,0,0)-(2,1,0) and (0,1,0)-(2,0,0)... use X crossing in plane z=1 with ground column to ground it.
    cross = [(((2, 2, 1), (4, 3, 1)), 0.9), (((2, 3, 1), (4, 2, 1)), 0.8)]
    ground = column_edges(2, 2, 2) + [(((2, 2, 2), (2, 3, 2)), 0.9)]
    s = decode(probs(ground + cross + [(((2, 2, 1), (2, 3, 2)), 0.9)]), max_members=50)
    assert s is not None
    chosen = {e for e in s.edges}
    assert not ({((2, 2, 1), (4, 3, 1)), ((2, 3, 1), (4, 2, 1))} <= chosen)
    assert MIN_CLEARANCE_CELLS > 0


def test_size_cap_keeps_the_most_probable_members():
    edges = [(e, 0.55) for e, _ in column_edges(10)]
    edges[0] = (edges[0][0], 0.99)
    s = decode(probs(edges), max_members=4)
    assert s is not None and len(s.edges) == 4 and ((3, 3, 0), (3, 3, 1)) in s.edges


def test_load_falls_back_to_highest_node():
    s = decode(probs(column_edges(6)))
    assert s is not None and s.loads == {(3, 3, 6)}


def test_free_ended_stubs_are_pruned_but_load_tips_are_kept():
    column = column_edges(6)
    stub = [(((3, 3, 3), (4, 3, 4)), 0.9), (((4, 3, 4), (4, 3, 5)), 0.9)]  # dangling branch off the column
    s = decode(probs(column + stub, loads=[((3, 3, 6), 0.9)]))
    assert s is not None
    assert ((3, 3, 3), (4, 3, 4)) not in s.edges and ((4, 3, 4), (4, 3, 5)) not in s.edges
    loaded = decode(probs(column + stub, loads=[((3, 3, 6), 0.9), ((4, 3, 5), 0.9)]))
    assert loaded is not None and ((4, 3, 4), (4, 3, 5)) in loaded.edges and (4, 3, 5) in loaded.loads
