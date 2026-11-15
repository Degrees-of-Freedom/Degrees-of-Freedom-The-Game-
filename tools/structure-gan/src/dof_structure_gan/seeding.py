"""Procedural seed structures: curved, branching, asymmetric ribs.

The adversarial loop needs *real* samples before the generator has produced
anything good. Seeds are spline-guided ribs rasterised onto the lattice by a
greedy walk, so they are curved and organic by construction but are not
guaranteed stable: the physics oracle filters them exactly like generator
output. Seeding is deterministic for a given ``numpy`` generator.
"""

from __future__ import annotations

import numpy as np

from .decode import decode
from .lattice import CHANNELS, GRID, LOAD_CHANNEL, OFFSET_INDEX, OFFSETS, Edge, Node, Structure, canonical_edge, in_bounds

_STEPS: tuple[Node, ...] = tuple(o for off in OFFSETS for o in (off, (-off[0], -off[1], -off[2])))


def _bezier(points: np.ndarray, count: int) -> np.ndarray:
    """De Casteljau evaluation of a Bezier curve through control ``points``."""
    out = []
    for t in np.linspace(0.0, 1.0, count):
        layer = points
        while len(layer) > 1:
            layer = (1 - t) * layer[:-1] + t * layer[1:]
        out.append(layer[0])
    return np.array(out)


def _walk(start: Node, target: np.ndarray) -> list[Node]:
    """Greedy lattice walk to the node nearest ``target`` using primitive steps."""
    goal = tuple(int(round(float(c))) for c in np.clip(target, 0, GRID - 1))
    path = [start]
    current = start
    while current != goal:
        remaining = np.array(goal) - np.array(current)
        best: Node | None = None
        best_score = -np.inf
        for step in _STEPS:
            nxt = (current[0] + step[0], current[1] + step[1], current[2] + step[2])
            if not in_bounds(nxt):
                continue
            moved = np.array(step, dtype=float)
            # Prefer long steps pointing at the goal that do not overshoot it.
            if np.linalg.norm(remaining - moved) >= np.linalg.norm(remaining):
                continue
            score = float(moved @ remaining) / np.linalg.norm(moved) - 0.15 * np.linalg.norm(
                np.cross(moved, remaining)
            ) / max(np.linalg.norm(remaining), 1.0)
            if score > best_score:
                best, best_score = nxt, score
        if best is None:
            break
        path.append(best)
        current = best
    return path


def _twin_rib(path: list[Node], rng: np.random.Generator) -> list[Edge]:
    """A parallel rib one or two cells away, laced to the first: a curved lattice girder.

    Doubling the rib's depth multiplies its bending stiffness, which is what lets
    slender, curved forms pass the physics oracle with the game's light section.
    """
    heading = np.subtract(path[-1], path[0])[:2].astype(float)
    if np.linalg.norm(heading) < 1e-9:
        heading = np.array([1.0, 0.0])
    normal = np.array([-heading[1], heading[0]]) / np.linalg.norm(heading)
    shift = tuple(int(v) for v in np.rint(normal * rng.choice([1, 1, 2]) * rng.choice([-1, 1])))
    if shift == (0, 0):
        shift = (1, 0)
    twin = [(n[0] + shift[0], n[1] + shift[1], n[2]) for n in path]
    if not all(in_bounds(n) for n in twin):
        return []
    edges = [canonical_edge(a, b) for a, b in zip(twin, twin[1:])]
    for i, (a, b) in enumerate(zip(path, twin)):
        edges.append(canonical_edge(a, b))
        if i + 1 < len(path):  # diagonal lacing
            edges.append(canonical_edge(a, twin[i + 1]) if rng.random() < 0.5 else canonical_edge(b, path[i + 1]))
    return [e for e in edges if tuple(y - x for x, y in zip(*e)) in OFFSET_INDEX]


def random_seed_structure(rng: np.random.Generator, max_members: int = 100) -> Structure | None:
    """Sample one curved, branching, asymmetric rib structure (may be unstable)."""
    probabilities = np.zeros((CHANNELS, GRID, GRID, GRID), dtype=np.float32)
    edges: list[Edge] = []
    roots = rng.integers(1, GRID - 1, size=(int(rng.integers(2, 5)), 2))
    crown = np.array([roots[:, 0].mean() + rng.normal(0, 1.5), roots[:, 1].mean() + rng.normal(0, 1.5)])
    rib_of: dict[Node, int] = {}
    for rib, root in enumerate(roots):
        base: Node = (int(root[0]), int(root[1]), 0)
        # Ribs lean toward a shared, off-centre crown so the form is connected but lopsided.
        pull = rng.uniform(0.4, 1.0)
        top = np.array([
            root[0] + pull * (crown[0] - root[0]) + rng.normal(0, 1.5),
            root[1] + pull * (crown[1] - root[1]) + rng.normal(0, 1.5),
            rng.uniform(5.0, GRID - 1.0),
        ])
        mid_a = np.array([root[0] + rng.normal(0, 2.0), root[1] + rng.normal(0, 2.0), rng.uniform(1.5, 5.0)])
        mid_b = np.array([top[0] + rng.normal(0, 2.0), top[1] + rng.normal(0, 2.0), top[2] * rng.uniform(0.5, 0.9)])
        curve = _bezier(np.array([[*root, 0.0], mid_a, mid_b, top]), int(rng.integers(5, 9)))
        node = base
        rib_path: list[Node] = [base]
        for point in curve[1:]:
            segment = _walk(node, point)
            edges += [canonical_edge(a, b) for a, b in zip(segment, segment[1:])]
            rib_path += segment[1:]
            node = segment[-1]
        for n in rib_path:
            rib_of.setdefault(n, rib)
        edges += _twin_rib(rib_path, rng)
    # Bridge between ribs with short walks so the body is one connected, braced form.
    unique = sorted(rib_of)
    for _ in range(int(rng.integers(6, 16))):
        a = unique[int(rng.integers(len(unique)))]
        near = sorted((n for n in unique if rib_of[n] != rib_of[a]), key=lambda n: np.linalg.norm(np.subtract(n, a)))
        if not near:
            continue
        segment = _walk(a, np.array(near[int(rng.integers(min(3, len(near))))], dtype=float))
        edges += [canonical_edge(x, y) for x, y in zip(segment, segment[1:])]
    edge_set = list(dict.fromkeys(edges))[: max_members * 2]
    for a, b in edge_set:
        probabilities[(OFFSET_INDEX[(b[0] - a[0], b[1] - a[1], b[2] - a[2])], *a)] = 1.0
    # Favour loading the highest, most cantilevered nodes.
    ranked = sorted({n for e in edge_set for n in e}, key=lambda n: -n[2])
    for node in ranked[: int(rng.integers(1, 4))]:
        probabilities[(LOAD_CHANNEL, *node)] = 1.0
    return decode(probabilities, max_members=max_members)
