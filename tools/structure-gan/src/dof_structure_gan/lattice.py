"""Discrete structure representation shared by the networks, physics and database.

A structure lives on a cubic lattice of ``GRID`` nodes per axis (``z`` is up,
matching the game's voxel model). A member joins two lattice nodes whose offset
is one of the *primitive* vectors with components in ``-2..2``; primitive means
the member passes through no other lattice node, so connectivity is always
explicit. Offsets are stored in a canonical sign (first non-zero component
positive), which gives every member exactly one tensor channel.

Tensor layout (``float32``, shape ``(CHANNELS, GRID, GRID, GRID)``):

* channels ``0..N_EDGE_CHANNELS-1``: member from node ``p`` to ``p + OFFSETS[c]``;
* channel ``LOAD_CHANNEL``: a load is applied at node ``p``.

Supports are not a channel: they are chosen deterministically by the decoder
from the ground-level nodes that carry members.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import product

import numpy as np

GRID = 12
"""Nodes per axis. The game's voxel limits are 16 x 16 x 14, so this always fits."""
CELL_METRES = 2.0
"""Edge length of one game grid cell."""

Node = tuple[int, int, int]
Edge = tuple[Node, Node]


def _primitive_offsets() -> tuple[Node, ...]:
    offsets: list[Node] = []
    for d in product(range(-2, 3), repeat=3):
        if d == (0, 0, 0) or math.gcd(math.gcd(abs(d[0]), abs(d[1])), abs(d[2])) != 1:
            continue
        if next(c for c in d if c != 0) > 0:
            offsets.append(d)
    return tuple(offsets)


OFFSETS: tuple[Node, ...] = _primitive_offsets()
OFFSET_INDEX: dict[Node, int] = {offset: i for i, offset in enumerate(OFFSETS)}
N_EDGE_CHANNELS = len(OFFSETS)
LOAD_CHANNEL = N_EDGE_CHANNELS
CHANNELS = N_EDGE_CHANNELS + 1


def in_bounds(node: Node) -> bool:
    return all(0 <= c < GRID for c in node)


def canonical_edge(a: Node, b: Node) -> Edge:
    """Order an edge so the offset has the canonical sign."""
    return (a, b) if a < b else (b, a)


@dataclass(frozen=True)
class Structure:
    """An immutable, validated member graph with supports and loads."""

    edges: frozenset[Edge]
    supports: frozenset[Node]
    loads: frozenset[Node]

    def __post_init__(self) -> None:
        nodes = self.nodes
        for a, b in self.edges:
            if a >= b or not (in_bounds(a) and in_bounds(b)):
                raise ValueError(f"Invalid edge {a}-{b}.")
            if tuple(y - x for x, y in zip(a, b)) not in OFFSET_INDEX:
                raise ValueError(f"Edge {a}-{b} is not a primitive lattice offset.")
        if not self.supports <= nodes or not self.loads <= nodes:
            raise ValueError("Supports and loads must be nodes of the structure.")
        if any(s[2] != 0 for s in self.supports):
            raise ValueError("Supports must be on the ground plane (z = 0).")

    @property
    def nodes(self) -> frozenset[Node]:
        return frozenset(n for edge in self.edges for n in edge)

    def to_tensor(self) -> np.ndarray:
        """Encode as the binary tensor the discriminator sees as a real sample."""
        tensor = np.zeros((CHANNELS, GRID, GRID, GRID), dtype=np.float32)
        for a, b in self.edges:
            tensor[(OFFSET_INDEX[tuple(y - x for x, y in zip(a, b))], *a)] = 1.0
        for node in self.loads:
            tensor[(LOAD_CHANNEL, *node)] = 1.0
        return tensor

    def transformed(self, op: int) -> Structure:
        """Apply one of the 8 symmetries of the square footprint (``op`` in 0..7)."""
        last = GRID - 1

        def move(n: Node) -> Node:
            x, y, z = n
            if op & 4:
                x, y = y, x
            if op & 1:
                x = last - x
            if op & 2:
                y = last - y
            return (x, y, z)

        return Structure(
            frozenset(canonical_edge(move(a), move(b)) for a, b in self.edges),
            frozenset(move(n) for n in self.supports),
            frozenset(move(n) for n in self.loads),
        )

    def canonical_key(self) -> str:
        """Hash invariant to footprint symmetries and horizontal translation."""
        best = ""
        for op in range(8):
            moved = self.transformed(op)
            nodes = moved.nodes
            ox, oy = min(n[0] for n in nodes), min(n[1] for n in nodes)

            def shift(n: Node) -> Node:
                return (n[0] - ox, n[1] - oy, n[2])

            text = repr((
                sorted((shift(a), shift(b)) for a, b in moved.edges),
                sorted(shift(n) for n in moved.supports),
                sorted(shift(n) for n in moved.loads),
            ))
            best = min(best, text) if best else text
        import hashlib

        return hashlib.sha256(best.encode()).hexdigest()

    def positions_metres(self) -> dict[Node, tuple[float, float, float]]:
        return {n: (n[0] * CELL_METRES, n[1] * CELL_METRES, n[2] * CELL_METRES) for n in self.nodes}
