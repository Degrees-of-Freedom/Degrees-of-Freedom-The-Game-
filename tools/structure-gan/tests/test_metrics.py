import pytest

from dof_structure_gan import metrics
from dof_structure_gan.lattice import canonical_edge
from conftest import chain, make


def test_scores_are_unit_interval(arc, column):
    for s in (arc, column):
        a = metrics.score(s)
        assert all(0.0 <= v <= 1.0 for v in (a.curvature, a.organic, a.asymmetry, a.dimensionality, a.complexity, a.dynamism))
        assert a.weakest <= a.total <= 1.0


def test_sustained_curve_beats_straight_column(arc, column):
    assert metrics.curvature(arc) > 0.3
    assert metrics.curvature(column) == 0.0


def test_curved_lattice_girder_counts_as_curved(arc):
    """Twin the arch and lace it: every node is braced (degree > 2) yet the chords still curve."""
    twin = [canonical_edge((a[0], a[1] + 1, a[2]), (b[0], b[1] + 1, b[2])) for a, b in arc.edges]
    rungs = [canonical_edge(n, (n[0], n[1] + 1, n[2])) for n in sorted(arc.nodes)]
    girder = make(
        sorted(arc.edges) + twin + rungs,
        [(2, 5, 0), (9, 5, 0)], [(6, 5, 4)],
    )
    assert metrics.curvature(girder) > 0.3
    ladder = make(
        chain((2, 5, 0), (2, 5, 4)) + chain((2, 6, 0), (2, 6, 4)) + [canonical_edge((2, 5, z), (2, 6, z)) for z in range(5)],
        [(2, 5, 0)], [(2, 5, 4)],
    )
    assert metrics.curvature(ladder) == 0.0


def test_zigzag_is_not_a_curve():
    zig = make(chain((2, 2, 0), (3, 2, 1), (2, 2, 2), (3, 2, 3), (2, 2, 4), (3, 2, 5)), [(2, 2, 0)], [(3, 2, 5)])
    assert metrics.curvature(zig) < 0.2


def test_mirror_symmetric_form_scores_zero_asymmetry():
    edges = chain((5, 3, 0), (5, 3, 3)) + chain((5, 8, 0), (5, 8, 3)) + chain((5, 3, 3), (5, 8, 3))
    sym = make(edges, [(5, 3, 0), (5, 8, 0)], [(5, 3, 3)])
    assert metrics.asymmetry(sym) == 0.0
    lopsided = make(edges + chain((5, 3, 3), (7, 4, 5)), [(5, 3, 0), (5, 8, 0)], [(7, 4, 5)])
    assert metrics.asymmetry(lopsided) > 0.0


def test_dimensionality_penalises_lines_and_sheets(column):
    sheet = make(
        chain((2, 2, 0), (2, 2, 3), (2, 6, 3), (2, 6, 0)) + chain((2, 2, 3), (2, 4, 4)), [(2, 2, 0)], [(2, 6, 3)]
    )
    volume = make(
        chain((2, 2, 0), (2, 2, 3), (4, 3, 4), (6, 4, 4), (7, 6, 3), (5, 7, 2), (3, 6, 2)) + chain((7, 6, 3), (7, 6, 0)),
        [(2, 2, 0), (7, 6, 0)], [(3, 6, 2)],
    )
    assert metrics.dimensionality(column) <= metrics.dimensionality(sheet) < metrics.dimensionality(volume)
    assert metrics.dimensionality(volume) > 0.5 > metrics.dimensionality(sheet)


def test_complexity_rewards_size_and_loops(column):
    ring = make(
        chain((2, 2, 0), (2, 2, 2), (4, 2, 3), (4, 4, 4), (2, 4, 3), (2, 2, 2)) + chain((4, 4, 4), (6, 5, 5)),
        [(2, 2, 0)], [(6, 5, 5)],
    )
    assert metrics.complexity(ring) > metrics.complexity(column)


def test_lean_and_overhang_raise_dynamism(column):
    leaning = make(chain((5, 5, 0), (5, 5, 2), (6, 5, 3), (7, 6, 4), (8, 7, 5), (9, 8, 6)), [(5, 5, 0)], [(9, 8, 6)])
    assert metrics.dynamism(leaning) > metrics.dynamism(column) == pytest.approx(0.0, abs=0.35)
