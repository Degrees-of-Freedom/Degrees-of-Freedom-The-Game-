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
    """Departure from an orthogonal grid: oblique members, varied directions, branching."""
    vectors = np.array([np.subtract(b, a) for a, b in structure.edges], dtype=float)
    axis_aligned = (np.count_nonzero(vectors, axis=1) == 1).mean()
    unit = vectors / np.linalg.norm(vectors, axis=1, keepdims=True)
    # Entropy of member directions over 26 equal-ish sectors (octants x 3 elevation bands).
    octant = (unit[:, 0] > 0) * 1 + (unit[:, 1] > 0) * 2 + (unit[:, 2] > 0) * 4
    band = np.digitize(np.abs(unit[:, 2]), [0.33, 0.8])
    bins = np.bincount(octant * 3 + band, minlength=24).astype(float)
    p = bins[bins > 0] / bins.sum()
    entropy = float(-(p * np.log(p)).sum() / math.log(24))
    adjacency = _adjacency(structure)
    branching = sum(1 for n in adjacency.values() if len(n) >= 3) / len(adjacency)
    lengths = np.linalg.norm(vectors, axis=1)
    length_variety = float(np.std(lengths) / np.mean(lengths))
    return _clip01(
        0.2 * (1 - axis_aligned) + 0.35 * entropy / 0.95 + 0.25 * branching / 0.35 + 0.2 * length_variety / 0.5
    )


def asymmetry(structure: Structure) -> float:
    """One minus the best overlap with any mirror/rotation of itself, rescaled.

    Footprint symmetries are applied about the bounding-box centre (so a pure
    translation does not count) and compared as member sets.
    """
    nodes = np.array(sorted(structure.nodes))
    lo, hi = nodes[:, :2].min(axis=0), nodes[:, :2].max(axis=0)
    centre2 = lo + hi  # doubled centre keeps coordinates integral

    def mapped(op: int) -> set[tuple[tuple[int, int, int], tuple[int, int, int]]]:
        def move(n: Node) -> Node:
            x, y = 2 * n[0] - centre2[0], 2 * n[1] - centre2[1]
            if op & 4:
                x, y = y, x
            if op & 1:
                x = -x
            if op & 2:
                y = -y
            return (int(x), int(y), n[2])

        out = set()
        for a, b in structure.edges:
            ma, mb = move(a), move(b)
            out.add((ma, mb) if ma < mb else (mb, ma))
        return out

    original = mapped(0)
    best = max(len(original & mapped(op)) / len(original | mapped(op)) for op in range(1, 8))
    return _clip01((1 - best) / 0.7)


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
    return _clip01(math.sqrt(_clip01(planarity / 0.5) * _clip01(slenderness / 0.5)) * 0.7 + 0.3 * _clip01(levels / 8))


def complexity(structure: Structure) -> float:
    """Enough members and independent loops to be intricate, without rewarding bloat."""
    members = len(structure.edges)
    loops = members - len(structure.nodes) + 1  # cyclomatic number of a connected graph
    size = _clip01((members - 12) / 40)
    return _clip01(0.5 * size + 0.5 * _clip01(loops / 8))


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
