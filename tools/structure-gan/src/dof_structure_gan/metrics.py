"""Deterministic, documented proxies for the qualities the generator should reach.

Each component is in ``[0, 1]`` and is a *geometric heuristic*, not a measure
of beauty: "organic", "dynamic" and so on are operationalised below so they can
be tested, tuned and criticised. All use only the member graph (lattice units
unless stated) and ignore stability, which the physics oracle decides.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass

import numpy as np

from .lattice import Node, Structure

COMPONENTS = ("curvature", "organic", "asymmetry", "dimensionality", "complexity", "dynamism")


@dataclass(frozen=True)
class Aesthetics:
    """Scores in ``[0, 1]`` for each requested quality."""

    curvature: float
    organic: float
    asymmetry: float
    dimensionality: float
    complexity: float
    dynamism: float

    @property
    def total(self) -> float:
        """Plain mean: no quality can be ignored by the optimiser without cost."""
        return float(np.mean(list(asdict(self).values())))

    @property
    def weakest(self) -> float:
        return min(asdict(self).values())


def _clip01(value: float) -> float:
    return float(min(1.0, max(0.0, value)))


def _adjacency(structure: Structure) -> dict[Node, list[Node]]:
    adjacency: dict[Node, list[Node]] = {n: [] for n in structure.nodes}
    for a, b in structure.edges:
        adjacency[a].append(b)
        adjacency[b].append(a)
    return adjacency


def _turn(before: Node, at: Node, after: Node) -> tuple[float, np.ndarray | None]:
    """Turning angle (degrees) of the path ``before -> at -> after`` and its unit turn axis."""
    u = np.subtract(at, before).astype(float)
    v = np.subtract(after, at).astype(float)
    cross = np.cross(u, v)
    norm = float(np.linalg.norm(cross))
    angle = math.degrees(math.atan2(norm, float(u @ v)))
    return angle, (cross / norm if norm > 1e-9 else None)


def _continuation(adjacency: dict[Node, list[Node]], came_from: Node, at: Node) -> Node | None:
    """The member that most smoothly continues ``came_from -> at`` (smallest turn), if within 60 degrees."""
    options = [(_turn(came_from, at, n)[0], n) for n in adjacency[at] if n != came_from]
    if not options:
        return None
    angle, node = min(options)
    return node if angle <= 60.0 else None


RUN_MEMBERS = 4
"""A curve needs this many consecutive chord members (three consecutive bends)."""


def _chord_run(adjacency: dict[Node, list[Node]], first: Node, second: Node) -> list[Node] | None:
    """Follow the straightest continuation from ``first -> second`` for ``RUN_MEMBERS`` members."""
    path = [first, second]
    while len(path) <= RUN_MEMBERS:
        nxt = _continuation(adjacency, path[-2], path[-1])
        if nxt is None or nxt in path:
            return None
        path.append(nxt)
    return path


def _is_axis_aligned(a: Node, b: Node) -> bool:
    return sum(1 for x, y in zip(a, b) if x != y) == 1


def curvature(structure: Structure) -> float:
    """Share of members on sustained, smooth, mostly oblique curves.

    A chord is followed through junctions by always taking the *straightest
    continuation*, so rungs and braces never continue it. A run of four
    consecutive members is a curve only if it bends smoothly (8-60 degrees)
    at all three interior nodes, about one common axis and in one rotational
    sense, with at least 30 degrees of total turn, and at most one of its
    members is axis-aligned. The last two rules exclude the failure mode of the
    first version, where a vertical post turning into one 45-degree brace in a
    boxy braced frame scored as a bend.
    """
    adjacency = _adjacency(structure)
    curved: set[frozenset[Node]] = set()
    for a, b in structure.edges:
        for first, second in ((a, b), (b, a)):
            path = _chord_run(adjacency, first, second)
            if path is None:
                continue
            turns = [_turn(path[i], path[i + 1], path[i + 2]) for i in range(RUN_MEMBERS - 1)]
            axes = [axis for _, axis in turns]
            if any(axis is None for axis in axes):
                continue
            if not all(8.0 <= angle <= 60.0 for angle, _ in turns) or sum(angle for angle, _ in turns) < 30.0:
                continue
            if not all(float(axes[0] @ axis) > 0.5 for axis in axes[1:]):  # type: ignore[operator]
                continue
            members = list(zip(path, path[1:]))
            if sum(_is_axis_aligned(u, v) for u, v in members) > 1:
                continue
            curved.update(frozenset(pair) for pair in members)
    return _clip01(len(curved) / max(len(structure.edges), 1) / 0.35)


def organic(structure: Structure) -> float:
    """Departure from an orthogonal grid: mostly oblique members, varied directions and lengths.

    Dense bracing makes nearly every node a junction, so branching is not
    scored (it was always saturated); obliqueness carries the weight.
    """
    vectors = np.array([np.subtract(b, a) for a, b in structure.edges], dtype=float)
    axis_aligned = (np.count_nonzero(vectors, axis=1) == 1).mean()
    unit = vectors / np.linalg.norm(vectors, axis=1, keepdims=True)
    # Entropy of member directions over 24 bins (octants x 3 elevation bands).
    octant = (unit[:, 0] > 0) * 1 + (unit[:, 1] > 0) * 2 + (unit[:, 2] > 0) * 4
    band = np.digitize(np.abs(unit[:, 2]), [0.33, 0.8])
    bins = np.bincount(octant * 3 + band, minlength=24).astype(float)
    p = bins[bins > 0] / bins.sum()
    entropy = float(-(p * np.log(p)).sum() / math.log(24))
    lengths = np.linalg.norm(vectors, axis=1)
    length_variety = float(np.std(lengths) / np.mean(lengths))
    return _clip01(0.5 * (1 - axis_aligned) / 0.7 + 0.3 * entropy / 0.95 + 0.2 * length_variety / 0.5)


_DENSITY_BINS = 4


def _density(structure: Structure) -> np.ndarray:
    """Length-weighted member-midpoint density on a 4 x 4 x 3 grid over a square footprint."""
    mids = np.array([(np.add(a, b) / 2.0) for a, b in structure.edges])
    lengths = np.array([math.dist(a, b) for a, b in structure.edges])
    lo = mids.min(axis=0)
    size = max(float(np.ptp(mids[:, 0])), float(np.ptp(mids[:, 1])), 1e-9)
    ranges = [(lo[0], lo[0] + size), (lo[1], lo[1] + size), (lo[2], max(mids[:, 2].max(), lo[2] + 1e-9))]
    grid, _ = np.histogramdd(mids, bins=(_DENSITY_BINS, _DENSITY_BINS, 3), range=ranges, weights=lengths)
    return grid


def asymmetry(structure: Structure) -> float:
    """How far the mass distribution is from any mirror or quarter-turn of itself.

    Exact edge-set symmetry is almost never present in dense forms (so it
    saturated), so this compares coarse density fields: the best cosine
    similarity of the footprint-square density with its 7 non-trivial
    symmetries. Similarity above ~0.9 reads as symmetric (score 0); around 0.5
    or below reads as lopsided (score 1).
    """
    grid = _density(structure)
    flat = grid.ravel()
    norm = float(np.linalg.norm(flat))
    if norm < 1e-12:
        return 0.0
    best = 0.0
    for op in range(1, 8):
        moved = grid
        if op & 4:
            moved = moved.transpose(1, 0, 2)
        if op & 1:
            moved = moved[::-1, :, :]
        if op & 2:
            moved = moved[:, ::-1, :]
        other = moved.ravel()
        best = max(best, float(flat @ other) / (norm * float(np.linalg.norm(other)) + 1e-12))
    return _clip01((0.9 - best) / 0.4)


def dimensionality(structure: Structure) -> float:
    """Fills three dimensions: neither a line, a flat sheet, nor a single storey."""
    points = np.array(sorted(structure.nodes), dtype=float)
    singular = np.zeros(3)
    values = np.linalg.svd(points - points.mean(axis=0), compute_uv=False)
    singular[: len(values)] = values  # fewer than three nodes leave trailing axes at zero
    if singular[0] < 1e-9:
        return 0.0
    planarity = singular[2] / max(singular[1], 1e-9)
    slenderness = singular[1] / singular[0]
    levels = len({n[2] for n in structure.nodes})
    return _clip01(math.sqrt(_clip01(planarity / 0.7) * _clip01(slenderness / 0.7)) * 0.7 + 0.3 * _clip01(levels / 8))


def complexity(structure: Structure) -> float:
    """Intricate but not bloated: member count peaks at 60-90, loops count too.

    Size rises to 1 at 62 members, holds to 90, then falls to 0.4 at 120, so
    filling the member cap is penalised rather than rewarded.
    """
    members = len(structure.edges)
    loops = members - len(structure.nodes) + 1  # cyclomatic number of a connected graph
    if members <= 62:
        size = _clip01((members - 12) / 50)
    else:
        size = 1.0 if members <= 90 else _clip01(1.0 - 0.6 * (members - 90) / 30)
    return _clip01(0.6 * size + 0.4 * _clip01(loops / 25))


def dynamism(structure: Structure) -> float:
    """Visual movement: lean, overhang and an uneven silhouette over height."""
    nodes = np.array(sorted(structure.nodes), dtype=float)
    foot = np.array(sorted(structure.supports), dtype=float)
    height = max(nodes[:, 2].max(), 1.0)
    top = nodes[nodes[:, 2] >= np.quantile(nodes[:, 2], 0.75)]
    foot_centre = foot[:, :2].mean(axis=0)
    lean = np.linalg.norm(top[:, :2].mean(axis=0) - foot_centre) / (0.35 * height)
    foot_lo, foot_hi = foot[:, :2].min(axis=0), foot[:, :2].max(axis=0)
    outside = np.maximum(np.maximum(foot_lo - nodes[:, :2], nodes[:, :2] - foot_hi), 0.0)
    overhang = np.linalg.norm(outside, axis=1).max() / (0.4 * height)
    widths = np.array([
        np.ptp(nodes[nodes[:, 2] == z][:, :2], axis=0).max() for z in np.unique(nodes[:, 2]) if (nodes[:, 2] == z).sum() > 1
    ])
    silhouette = float(np.std(widths) / max(np.mean(widths), 1e-9)) / 0.5 if len(widths) > 2 else 0.0
    return _clip01(0.35 * _clip01(lean) + 0.35 * _clip01(overhang) + 0.3 * _clip01(silhouette))


def score(structure: Structure) -> Aesthetics:
    """Evaluate all six components."""
    return Aesthetics(
        curvature=curvature(structure),
        organic=organic(structure),
        asymmetry=asymmetry(structure),
        dimensionality=dimensionality(structure),
        complexity=complexity(structure),
        dynamism=dynamism(structure),
    )


def shape_signature(structure: Structure) -> np.ndarray:
    """Unit-norm coarse mass-density vector, used to compare overall shapes."""
    flat = _density(structure).ravel()
    return flat / max(float(np.linalg.norm(flat)), 1e-12)


def shape_similarity(a: Structure, b: Structure) -> float:
    """Best cosine similarity of coarse mass density over the 8 footprint symmetries (1 = same shape)."""
    base = _density(a)
    base = base.ravel() / max(float(np.linalg.norm(base)), 1e-12)
    best = 0.0
    for op in range(8):
        grid = _density(b)
        if op & 4:
            grid = grid.transpose(1, 0, 2)
        if op & 1:
            grid = grid[::-1, :, :]
        if op & 2:
            grid = grid[:, ::-1, :]
        other = grid.ravel() / max(float(np.linalg.norm(grid)), 1e-12)
        best = max(best, float(base @ other))
    return best
