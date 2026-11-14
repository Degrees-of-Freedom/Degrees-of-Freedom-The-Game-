"""Seeded generators of game-like structural models, as plain contract-shaped dicts.

Everything here is deterministic in the integer seed (``random.Random(seed)``,
never global randomness) and depends on nothing but the standard library, so it
can be used against any implementation of the solver contract.

Two generators:

* ``generate_state(seed)``: a schema-valid, usually semantically valid model of
  the kind a turn-based structural game on a 3D grid produces, bad states
  included (floating parts, free ends, mechanisms, tiny and huge loads, extreme
  stiffness ratios, patterns a solver may reject as unsupported).
* ``generate_invalid_state(seed)``: schema-valid but semantically invalid models
  that a solver must answer with an ``error`` result.

Grid: integer cells of ``CELL`` metres, Z up, ground plane at ``z = 0``.
"""

from __future__ import annotations

import math
import random
from typing import Any

CELL = 2.0
DEFAULT_WEIGHT_PER_LENGTH = 577.0  # N/m, the documented standard section (properties.py)

FIXED_SUPPORT = [True] * 6

# Steps between grid points: axes weigh most, then face diagonals, then space diagonals.
_STEPS: list[tuple[tuple[int, int, int], int]] = []
for _dx in (-1, 0, 1):
    for _dy in (-1, 0, 1):
        for _dz in (-1, 0, 1):
            _n = abs(_dx) + abs(_dy) + abs(_dz)
            if _n:
                _STEPS.append(((_dx, _dy, _dz), {1: 6, 2: 2, 3: 1}[_n]))

L, F, E = "locked", "free", "elastic"
# Presets from docs/kb/turn-criteria.md section 3 (laws in UX UY UZ RX RY RZ).
PRESETS: dict[str, list[str]] = {
    "fixed": [L, L, L, L, L, L],
    "ball": [L, L, L, F, F, F],
    "hinge_x": [L, L, L, F, L, L],
    "slider_x": [F, L, L, L, L, L],
    "cylindrical_x": [F, L, L, F, L, L],
    "planar_bearing": [F, F, L, L, L, F],
    "semi_rigid": [L, L, L, E, E, E],
    "elastic_coupler": [E, E, E, E, E, E],
    # Torsion-locked hinges the service supports on any member (DESIGN.md, Connection capability).
    "twist_locked_ball": [L, L, L, L, F, F],
    "hinge_ry": [L, L, L, L, F, L],
    "hinge_rz": [L, L, L, L, L, F],
}
# Presets supported on skew members, or members whose local axes are not global axes.
SKEW_SAFE_PRESETS = (
    "fixed", "ball", "semi_rigid", "elastic_coupler", "twist_locked_ball", "hinge_ry", "hinge_rz",
)


def _log_uniform(rng: random.Random, low: float, high: float) -> float:
    return math.exp(rng.uniform(math.log(low), math.log(high)))


def _stiffness(rng: random.Random) -> list[float]:
    return [
        _log_uniform(rng, 1e6, 1e10),
        _log_uniform(rng, 1e6, 1e10),
        _log_uniform(rng, 1e6, 1e10),
        _log_uniform(rng, 1e3, 1e8),
        _log_uniform(rng, 1e3, 1e8),
        _log_uniform(rng, 1e3, 1e8),
    ]


def _connection(rng: random.Random, laws: list[str]) -> dict[str, Any]:
    conn: dict[str, Any] = {"laws": list(laws)}
    if E in laws:
        conn["stiffness"] = _stiffness(rng)
    elif rng.random() < 0.1:
        conn["stiffness"] = _stiffness(rng)  # given but unused: must be ignored
    return conn


def _end_spec(rng: random.Random, kind: str, prefix: str, axis_aligned: bool, probe: bool) -> dict[str, Any]:
    """Fields describing one member end: shorthand, full connection, or default.

    ``axis_aligned``: the member's local axes are all parallel to global axes, so
    any law pattern is representable. Otherwise (and unless ``probe``) only
    patterns the service supports on skew members are drawn. ``probe`` members
    deliberately draw from everything, to exercise refusals.
    """
    roll = rng.random()
    pinned_bias = 0.35 if kind in ("brace", "cable") else 0.0
    if roll < 0.28 - pinned_bias * 0.5:
        return {}
    if roll < 0.43:
        return {f"{prefix}Fixity": "fixed"}
    if roll < 0.43 + 0.2 + pinned_bias:
        return {f"{prefix}Fixity": "pinned"}
    if roll < 0.70 + pinned_bias:
        return {f"{prefix}Fixity": "free"} if rng.random() < 0.3 else {f"{prefix}Fixity": "pinned"}
    open_patterns = axis_aligned or probe
    if roll < 0.95:
        if open_patterns and rng.random() < (0.5 if axis_aligned else 1.0):
            name = rng.choice(list(PRESETS))
        else:
            name = rng.choice(SKEW_SAFE_PRESETS)
        return {f"{prefix}Connection": _connection(rng, PRESETS[name])}
    if open_patterns:
        # Arbitrary law combinations (supported on axis-aligned members, refused on skew ones).
        laws = [rng.choice((L, F, E)) for _ in range(6)]
        return {f"{prefix}Connection": _connection(rng, laws)}
    return {f"{prefix}Connection": _connection(rng, PRESETS[rng.choice(SKEW_SAFE_PRESETS)])}


def _properties(rng: random.Random) -> dict[str, Any]:
    """Resolved properties with ratios far outside the standard section."""
    modulus = _log_uniform(rng, 1e6, 1e12)
    props: dict[str, Any] = {
        "elasticModulus": modulus,
        "shearModulus": modulus / rng.uniform(2.0, 3.0),
        "area": _log_uniform(rng, 1e-6, 1.0),
        "inertiaY": _log_uniform(rng, 1e-12, 1e-2),
        "inertiaZ": _log_uniform(rng, 1e-12, 1e-2),
        "torsionConstant": _log_uniform(rng, 1e-12, 1e-2),
    }
    if rng.random() < 0.6:
        props["weightPerLength"] = rng.choice((0.0, rng.uniform(1.0, 5000.0)))
    return props


def _load_magnitude(rng: random.Random) -> float:
    roll = rng.random()
    if roll < 0.05:
        return 0.0
    if roll < 0.12:
        return _log_uniform(rng, 1e8, 1e11)  # very large
    if roll < 0.20:
        return _log_uniform(rng, 1e-6, 1e-2)  # very small
    return _log_uniform(rng, 1e2, 2e5)


def _grow(
    rng: random.Random,
    nodes: dict[str, tuple[int, int, int]],
    roots: list[str],
    edges: list[tuple[str, str]],
    count: int,
    node_prefix: str,
) -> None:
    """Add up to ``count`` members growing from ``roots``, on grid axes and diagonals."""
    by_pos = {pos: nid for nid, pos in nodes.items()}
    edge_set = {frozenset(e) for e in edges}
    steps = [s for s, _ in _STEPS]
    weights = [w for _, w in _STEPS]
    local = list(roots)
    added = 0
    attempts = 0
    while added < count and attempts < count * 8 + 20:
        attempts += 1
        base = rng.choice(local[-8:]) if rng.random() < 0.6 else rng.choice(local)
        i, j, k = nodes[base]
        dx, dy, dz = rng.choices(steps, weights)[0]
        pos = (i + dx, j + dy, k + dz)
        if pos[2] < 0:
            continue
        if pos in by_pos:
            other = by_pos[pos]
        else:
            other = f"{node_prefix}{len(nodes)}"
            nodes[other] = pos
            by_pos[pos] = other
            local.append(other)
        key = frozenset((base, other))
        if base == other or key in edge_set:
            continue
        edge_set.add(key)
        edges.append((base, other) if rng.random() < 0.8 else (other, base))
        added += 1


def generate_state(seed: int) -> dict[str, Any]:
    """A game-like model as a contract-shaped dict, deterministic in ``seed``."""
    rng = random.Random(seed)

    roll = rng.random()
    if roll < 0.80:
        target = rng.randint(2, 25)
    elif roll < 0.97:
        target = rng.randint(26, 60)
    else:
        target = rng.randint(61, 120)

    nodes: dict[str, tuple[int, int, int]] = {}
    edges: list[tuple[str, str]] = []

    # Foundations on the ground plane.
    n_found = rng.choices((0, 1, 2, 3, 4), (2, 28, 32, 22, 16))[0]
    foundation_ids: list[str] = []
    span = 4
    for _ in range(n_found * 4):
        if len(foundation_ids) >= n_found:
            break
        pos = (rng.randint(0, span), rng.randint(0, span), 0)
        if pos not in nodes.values():
            nid = f"f{len(foundation_ids)}"
            nodes[nid] = pos
            foundation_ids.append(nid)
    if not foundation_ids:
        nid = "a0"
        nodes[nid] = (rng.randint(0, span), rng.randint(0, span), rng.randint(0, 2))
    roots = list(nodes)

    # Main structure, then sometimes a floating part with no path to the ground.
    floating = rng.random() < 0.12
    main_count = target if not floating else max(1, target - rng.randint(1, 4))
    _grow(rng, nodes, roots, edges, main_count, "n")
    if floating:
        fid = f"fl{len(nodes)}"
        nodes[fid] = (rng.randint(8, 12), rng.randint(8, 12), rng.randint(1, 3))
        _grow(rng, nodes, [fid], edges, target - main_count, "fl")

    # Occasionally join two existing nodes by an extra member (closes loops).
    ids = list(nodes)
    for _ in range(rng.choice((0, 0, 0, 1, 2))):
        a, b = rng.sample(ids, 2) if len(ids) >= 2 else (None, None)
        if a and b and not any({x, y} == {a, b} for x, y in edges):
            pa, pb = nodes[a], nodes[b]
            if max(abs(pa[0] - pb[0]), abs(pa[1] - pb[1]), abs(pa[2] - pb[2])) <= 2:
                edges.append((a, b))

    if not edges:  # always at least one member
        nodes["z0"] = (nodes[roots[0]][0], nodes[roots[0]][1], nodes[roots[0]][2] + 1)
        edges.append((roots[0], "z0"))

    node_list = [
        {"id": nid, "position": [pos[0] * CELL, pos[1] * CELL, pos[2] * CELL]} for nid, pos in nodes.items()
    ]

    # Duplicate coincident nodes with different ids: joints, not connections.
    dup_pairs: list[tuple[str, str]] = []
    if rng.random() < 0.10:
        for _ in range(rng.randint(1, 2)):
            src = rng.choice(list(nodes))
            did = f"dup{len(node_list)}"
            node_list.append({"id": did, "position": list(next(n for n in node_list if n["id"] == src)["position"])})
            dup_pairs.append((src, did))
            neighbour = rng.choice(list(nodes))
            if neighbour != src:
                edges.append((did, neighbour))

    members: list[dict[str, Any]] = []
    probe_state = rng.random() < 0.10
    position_of = {n["id"]: n["position"] for n in node_list}
    for index, (a, b) in enumerate(edges):
        kind = rng.choices(("beam", "brace", "cable"), (55, 30, 15))[0]
        member: dict[str, Any] = {"id": f"m{index}", "startNodeId": a, "endNodeId": b}
        if kind != "beam" or rng.random() < 0.3:
            member["kind"] = kind
        # About 10% of states deliberately probe what the service refuses; there, some members do.
        probe = probe_state and rng.random() < 0.25
        if rng.random() < 0.10:
            member["orientation"] = [rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)]
            if not any(member["orientation"]):
                member["orientation"] = [0.0, 0.0, 1.0]
        differing = sum(1 for u, v in zip(position_of[a], position_of[b]) if u != v)
        axis_aligned = differing == 1 and "orientation" not in member
        member.update(_end_spec(rng, kind, "start", axis_aligned, probe))
        member.update(_end_spec(rng, kind, "end", axis_aligned, probe))
        if kind == "cable" and rng.random() < 0.4:
            member["initialStrain"] = rng.choice((1.0, 1.0, 1.0, -0.2)) * _log_uniform(rng, 1e-5, 1e-2)
        elif kind == "brace" and rng.random() < 0.10:
            member["initialStrain"] = rng.uniform(-1e-3, 1e-3)
        elif kind == "beam" and probe and rng.random() < 0.5:
            member["initialStrain"] = rng.uniform(-1e-3, 1e-3)  # refused: strain is for braces and cables
        if rng.random() < 0.12:
            member["properties"] = _properties(rng)
        members.append(member)

    supports = [{"nodeId": fid, "restrained": list(FIXED_SUPPORT)} for fid in foundation_ids]
    # A coincident duplicate of a foundation node is sometimes itself a foundation.
    for src, did in dup_pairs:
        if src in foundation_ids and rng.random() < 0.5:
            supports.append({"nodeId": did, "restrained": list(FIXED_SUPPORT)})

    # Loads: mostly downward points on non-foundation nodes.
    loads: list[dict[str, Any]] = []
    roll = rng.random()
    if roll < 0.05:
        load_probability = 0.0  # no loads at all
    elif roll < 0.10:
        load_probability = 1.0
    else:
        load_probability = rng.uniform(0.1, 0.5)
    supported = {s["nodeId"] for s in supports}
    for node in node_list:
        if node["id"] in supported and rng.random() < 0.8:
            continue
        if rng.random() < load_probability:
            fz = -_load_magnitude(rng)
            force = [0.0, 0.0, fz]
            if rng.random() < 0.15:
                force[0] = rng.uniform(-0.3, 0.3) * abs(fz)
                force[1] = rng.uniform(-0.3, 0.3) * abs(fz)
            moment = [0.0, 0.0, 0.0]
            if rng.random() < 0.05:
                moment = [rng.uniform(-1e3, 1e3) for _ in range(3)]
            loads.append({"nodeId": node["id"], "force": force, "moment": moment})
    # A load on a node no member touches.
    if rng.random() < 0.08:
        lone = f"lone{len(node_list)}"
        node_list.append({"id": lone, "position": [rng.randint(15, 20) * CELL, 0.0, rng.randint(0, 3) * CELL]})
        loads.append({"nodeId": lone, "force": [0.0, 0.0, -_load_magnitude(rng)], "moment": [0.0, 0.0, 0.0]})

    analysis: dict[str, Any] = {}
    if rng.random() < 0.9:
        analysis["fidelity"] = rng.choice(("linear", "nonlinear"))
    if rng.random() < 0.5:
        analysis["selfWeight"] = rng.random() < 0.8
    if rng.random() < 0.05:
        analysis["timeoutMs"] = rng.choice((1.0, 5.0, 20.0, 200.0))
    if rng.random() < 0.08:
        analysis["displacementLimit"] = _log_uniform(rng, 1e-3, 10.0)

    model: dict[str, Any] = {
        "units": "SI",
        "nodes": node_list,
        "members": members,
        "supports": supports,
        "loads": loads,
    }
    if rng.random() < 0.3:
        model["version"] = f"seed-{seed}"
    if analysis or rng.random() < 0.5:
        model["analysis"] = analysis
    return model


INVALID_KINDS = (
    "unknown_member_node",
    "unknown_support_node",
    "unknown_load_node",
    "duplicate_node_id",
    "duplicate_member_id",
    "zero_length_same_node",
    "zero_length_coincident_nodes",
    "two_supports_one_node",
    "shorthand_and_full_start",
    "shorthand_and_full_end",
    "elastic_without_stiffness",
)


def _base_cantilever(rng: random.Random) -> dict[str, Any]:
    height = rng.randint(1, 4) * CELL
    return {
        "units": "SI",
        "nodes": [
            {"id": "a", "position": [0.0, 0.0, 0.0]},
            {"id": "b", "position": [0.0, 0.0, height]},
            {"id": "c", "position": [CELL, 0.0, height]},
        ],
        "members": [
            {"id": "m0", "startNodeId": "a", "endNodeId": "b"},
            {"id": "m1", "startNodeId": "b", "endNodeId": "c"},
        ],
        "supports": [{"nodeId": "a", "restrained": list(FIXED_SUPPORT)}],
        "loads": [{"nodeId": "c", "force": [0.0, 0.0, -rng.uniform(1e3, 1e5)], "moment": [0.0, 0.0, 0.0]}],
        "analysis": {"fidelity": rng.choice(("linear", "nonlinear")), "selfWeight": rng.random() < 0.5},
    }


def generate_invalid_state(seed: int) -> dict[str, Any]:
    """A schema-valid model that is semantically invalid; a solver must return ``error``."""
    rng = random.Random(seed)
    kind = INVALID_KINDS[seed % len(INVALID_KINDS)]
    model = _base_cantilever(rng)
    members = model["members"]
    if kind == "unknown_member_node":
        members[rng.randrange(2)][rng.choice(("startNodeId", "endNodeId"))] = "ghost"
    elif kind == "unknown_support_node":
        model["supports"].append({"nodeId": "ghost", "restrained": list(FIXED_SUPPORT)})
    elif kind == "unknown_load_node":
        model["loads"].append({"nodeId": "ghost", "force": [0.0, 0.0, -1e3], "moment": [0.0, 0.0, 0.0]})
    elif kind == "duplicate_node_id":
        model["nodes"].append({"id": "b", "position": [CELL * 3, 0.0, 0.0]})
    elif kind == "duplicate_member_id":
        members[1]["id"] = "m0"
    elif kind == "zero_length_same_node":
        members.append({"id": "m2", "startNodeId": "b", "endNodeId": "b"})
    elif kind == "zero_length_coincident_nodes":
        model["nodes"].append({"id": "b2", "position": list(model["nodes"][1]["position"])})
        members.append({"id": "m2", "startNodeId": "b", "endNodeId": "b2"})
    elif kind == "two_supports_one_node":
        model["supports"].append({"nodeId": "a", "restrained": [True, True, True, False, False, False]})
    elif kind in ("shorthand_and_full_start", "shorthand_and_full_end"):
        side = "start" if kind.endswith("start") else "end"
        members[rng.randrange(2)].update(
            {f"{side}Fixity": rng.choice(("fixed", "pinned", "free")), f"{side}Connection": _connection(rng, PRESETS["ball"])}
        )
    elif kind == "elastic_without_stiffness":
        side = rng.choice(("start", "end"))
        laws = rng.choice((PRESETS["semi_rigid"], PRESETS["elastic_coupler"]))
        members[rng.randrange(2)][f"{side}Connection"] = {"laws": list(laws)}  # no stiffness
    return model


def invalid_kind(seed: int) -> str:
    return INVALID_KINDS[seed % len(INVALID_KINDS)]
