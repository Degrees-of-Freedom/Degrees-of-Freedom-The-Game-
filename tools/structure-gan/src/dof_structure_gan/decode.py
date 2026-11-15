"""Turn raw generator output into a legal :class:`Structure`.

The generator proposes per-channel probabilities; this module is the single
place that enforces the game's physical rules so the networks never need to
learn them: no members crossing without a shared node, a single connected
body that touches the ground, a bounded size and at least one load.
"""

from __future__ import annotations

import numpy as np

from .lattice import (
    GRID,
    LOAD_CHANNEL,
    N_EDGE_CHANNELS,
    OFFSETS,
    Edge,
    Node,
    Structure,
    canonical_edge,
    in_bounds,
)

MIN_CLEARANCE_CELLS = 0.35
"""Members that do not share a node must stay at least this far apart."""
MAX_SUPPORTS = 6
MIN_MEMBERS = 4
CANDIDATE_FACTOR = 6
"""Rejected clashes consume candidates, so consider up to this many times the member cap."""


def segment_distances(p: np.ndarray, q: np.ndarray, starts: np.ndarray, ends: np.ndarray) -> np.ndarray:
    """Minimum distance from segment ``p-q`` to each segment ``starts[i]-ends[i]``.

    Standard closest-point-between-segments solution (Ericson, *Real-Time
    Collision Detection* 5.1.9), vectorised over the second segment set.
    """
    d1 = q - p
    d2 = ends - starts
    r = p - starts
    a = float(d1 @ d1)
    e = np.einsum("ij,ij->i", d2, d2)
    f = np.einsum("ij,ij->i", d2, r)
    c = r @ d1
    b = d2 @ d1
    denom = a * e - b * b
    with np.errstate(divide="ignore", invalid="ignore"):
        s = np.where(denom > 1e-12, np.clip((b * f - c * e) / denom, 0.0, 1.0), 0.0)
        t = (b * s + f) / e
    t_clamped = np.clip(t, 0.0, 1.0)
    with np.errstate(divide="ignore", invalid="ignore"):
        s = np.where((t < 0.0) | (t > 1.0), np.clip((t_clamped * b - c) / a, 0.0, 1.0), s)
    closest1 = p + s[:, None] * d1
    closest2 = starts + t_clamped[:, None] * d2
    return np.linalg.norm(closest1 - closest2, axis=1)


def _clashes(edge: Edge, accepted: list[Edge], starts: list[np.ndarray], ends: list[np.ndarray]) -> bool:
    if not accepted:
        return False
    a, b = edge
    keep = [i for i, (c, d) in enumerate(accepted) if a not in (c, d) and b not in (c, d)]
    if not keep:
        return False
    dist = segment_distances(
        np.array(a, dtype=float), np.array(b, dtype=float),
        np.array([starts[i] for i in keep]), np.array([ends[i] for i in keep]),
    )
    return bool(dist.min() < MIN_CLEARANCE_CELLS)


def _ground_component(edges: list[Edge]) -> list[Edge]:
    """Keep only the largest connected body that touches the ground."""
    parent: dict[Node, Node] = {}

    def find(n: Node) -> Node:
        parent.setdefault(n, n)
        while parent[n] != n:
            parent[n] = parent[parent[n]]
            n = parent[n]
        return n

    for a, b in edges:
        parent[find(a)] = find(b)
    groups: dict[Node, list[Edge]] = {}
    for edge in edges:
        groups.setdefault(find(edge[0]), []).append(edge)
    grounded = [g for g in groups.values() if any(n[2] == 0 for e in g for n in e)]
    return max(grounded, key=len) if grounded else []


def decode(
    probabilities: np.ndarray,
    *,
    max_members: int = 120,
    max_loads: int = 5,
    threshold: float = 0.5,
) -> Structure | None:
    """Convert ``(CHANNELS, GRID, GRID, GRID)`` probabilities to a legal structure.

    Returns ``None`` when no grounded body of at least ``MIN_MEMBERS`` members
    survives the rules. Higher-probability members win clashes and the size cap.
    """
    if probabilities.shape != (N_EDGE_CHANNELS + 1, GRID, GRID, GRID):
        raise ValueError(f"Unexpected tensor shape {probabilities.shape}.")
    edge_probs = probabilities[:N_EDGE_CHANNELS]
    hits = np.argwhere(edge_probs > threshold)
    values = edge_probs[edge_probs > threshold]
    # Only the most probable members can survive the size cap, so rank before building Python objects.
    keep = np.argsort(-values, kind="stable")[: CANDIDATE_FACTOR * max_members]
    candidates: list[tuple[float, Edge]] = []
    for channel, x, y, z in hits[keep]:
        a: Node = (int(x), int(y), int(z))
        off = OFFSETS[int(channel)]
        b: Node = (a[0] + off[0], a[1] + off[1], a[2] + off[2])
        if in_bounds(b):
            candidates.append((float(edge_probs[channel, x, y, z]), canonical_edge(a, b)))
    candidates.sort(key=lambda item: (-item[0], item[1]))

    accepted: list[Edge] = []
    starts: list[np.ndarray] = []
    ends: list[np.ndarray] = []
    for _, edge in candidates:
        if len(accepted) >= max_members:
            break
        if _clashes(edge, accepted, starts, ends):
            continue
        accepted.append(edge)
        starts.append(np.array(edge[0], dtype=float))
        ends.append(np.array(edge[1], dtype=float))

    body = _ground_component(accepted)
    if len(body) < MIN_MEMBERS:
        return None
    nodes = {n for e in body for n in e}
    degree: dict[Node, int] = {}
    for a, b in body:
        degree[a] = degree.get(a, 0) + 1
        degree[b] = degree.get(b, 0) + 1
    ground = sorted((n for n in nodes if n[2] == 0), key=lambda n: (-degree[n], n))
    supports = frozenset(ground[:MAX_SUPPORTS])

    load_scores = probabilities[LOAD_CHANNEL]
    raised = [n for n in nodes if n[2] > 0]
    if not raised:
        return None
    ranked = sorted(raised, key=lambda n: (-float(load_scores[n]), -n[2], n))
    loads = [n for n in ranked if load_scores[n] > threshold][:max_loads]
    if not loads:
        loads = [max(raised, key=lambda n: (n[2], float(load_scores[n]), n))]
    return Structure(frozenset(body), supports, frozenset(loads))
