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


def curvature(structure: Structure) -> float:
    """Share of members on sustained, smooth bends of a chord.

    Braced structures have no degree-2 nodes, so a chord is followed through
    junctions by always taking the *straightest continuation*; rungs and
    diagonals (turning near 90 degrees) never continue a chord. For each
    directed member ``a -> b``, the chord bends smoothly (8-60 degrees) both
    where it arrives at ``a`` and where it leaves ``b``, about the same axis,
    when it is a curve; a zig-zag turns opposite ways and a corner turns too
    sharply, so neither counts. The three members around such a pair are curved.
    """
    adjacency = _adjacency(structure)
    curved: set[frozenset[Node]] = set()
    for a, b in structure.edges:
        for first, second in ((a, b), (b, a)):  # both travel directions
            after = _continuation(adjacency, first, second)
            if after is None:
                continue
            arrivals = [n for n in adjacency[first] if n != second]
            # The member arriving at `first` whose straightest continuation is `second`.
            before = next(
                (n for n in sorted(arrivals, key=lambda n: _turn(n, first, second)[0])
                 if _continuation(adjacency, n, first) == second),
                None,
            )
            if before is None:
                continue
            angle_first, axis_first = _turn(before, first, second)
            angle_second, axis_second = _turn(first, second, after)
            if (
                axis_first is not None and axis_second is not None
                and 8.0 <= angle_first <= 60.0 and 8.0 <= angle_second <= 60.0
                and float(axis_first @ axis_second) > 0.5
            ):
                curved.update(frozenset(pair) for pair in ((before, first), (first, second), (second, after)))
    return _clip01(len(curved) / max(len(structure.edges), 1) / 0.45)


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
