"""Shared builders. Lattice coordinates are (x, y, z) with z up."""

from __future__ import annotations

import math

import pytest

from dof_structure_gan.lattice import Node, Structure, canonical_edge


def chain(*nodes: Node) -> list:
    """Edges along waypoints; straight runs are split into primitive lattice steps."""
    edges = []
    for a, b in zip(nodes, nodes[1:]):
        d = tuple(y - x for x, y in zip(a, b))
        g = math.gcd(math.gcd(abs(d[0]), abs(d[1])), abs(d[2]))
        step = tuple(c // g for c in d)
        points = [tuple(x + step[i] * k for i, x in enumerate(a)) for k in range(g + 1)]
        edges += [canonical_edge(p, q) for p, q in zip(points, points[1:])]
    return edges


def make(edges: list, supports: list[Node], loads: list[Node]) -> Structure:
    return Structure(frozenset(edges), frozenset(supports), frozenset(loads))


@pytest.fixture
def column() -> Structure:
    """A 4-storey column: stable, boring."""
    return make(chain((5, 5, 0), (5, 5, 1), (5, 5, 2), (5, 5, 3), (5, 5, 4)), [(5, 5, 0)], [(5, 5, 4)])


@pytest.fixture
def arc() -> Structure:
    """An arch that bends steadily in one plane (a sustained curve), grounded at both ends."""
    path = [(2, 5, 0), (2, 5, 1), (3, 5, 2), (4, 5, 3), (6, 5, 4), (7, 5, 4), (8, 5, 3), (9, 5, 1), (9, 5, 0)]
    return make(chain(*path), [(2, 5, 0), (9, 5, 0)], [(6, 5, 4)])
