"""Invariance acceptance tests (solver criteria section 7, "Symmetry, node/element reordering,
rigid coordinate rotation").

Nothing here needs a closed form: each test solves a model and a transformed copy of it and
requires the physical results to agree under the transformation.

* Mirror symmetry. A symmetric structure under a symmetric load has symmetric results; and
  any model reflected through a coordinate plane gives reflected results (translations and
  forces as polar vectors S v, rotations and moments as axial vectors det(S) S v = -S v).
* Reordering and renaming. Shuffling the node, member, support and load lists and renaming
  every id changes no physical result and no classification.
* Rigid rotation (and translation). Rotating the whole model about an arbitrary axis, loads and
  supports included, gives member forces identical to the original and displacement and
  reaction six-vectors rotated by the same matrix. Only fully fixed or fully pinned supports are
  used, because per-axis restraint flags do not rotate; every member carries an explicit
  ``orientation`` so its local axes rotate with it (the default Z reference does not).

Both fidelities run where the structure is far from buckling (member axial forces are a small
fraction of the Euler loads, displacements below 1% of the span). Agreement is required to
``RTOL_LINEAR`` / ``RTOL_NONLINEAR`` of the largest value of the same kind in the result, an
explicit absolute tolerance tied to a characteristic scale.
"""

from __future__ import annotations

import math
import random

import numpy as np
import pytest
from accept_linear_models import (
    FIXED,
    PIN,
    build,
    combine,
    comp,
    conn,
    member,
    rename_model,
    rotation_matrix,
    section,
    solve,
    transform_model,
    transform_vec6,
    with_explicit_orientation,
)

RTOL_LINEAR = 1.0e-7
RTOL_NONLINEAR = 1.0e-4
FIDELITIES = ["linear", "nonlinear"]
FORCE_KEYS = ("axial", "shear")
MOMENT_KEYS = ("torsion", "momentStart", "momentEnd")


def rtol_for(fidelity: str) -> float:
    return RTOL_LINEAR if fidelity == "linear" else RTOL_NONLINEAR


# --- fixtures -------------------------------------------------------------------------------------


def space_frame(fidelity: str) -> dict:
    """Asymmetric 3D frame: three columns of different height, a top ring, one diagonal brace,
    unequal principal inertias with explicit orientations, a hinge (L L L L F F) and a semi-rigid
    start (L L L E E E). Fixed, pinned and fixed bases. Loaded with forces and moments."""
    nodes = {
        "n1": (0, 0, 0), "n2": (6, 0, 0), "n3": (3, 4, 0),
        "t1": (0, 0, 3), "t2": (6, 0, 3.5), "t3": (3, 4, 3),
    }
    pa = section()
    pb = section(inertiaY=4.0e-5, inertiaZ=1.6e-4)
    pc = section(area=7.0e-3, inertiaY=6.0e-5, inertiaZ=9.0e-5, torsionConstant=1.2e-4)
    members = [
        member("c1", "n1", "t1", props=pb, orientation=(1, 0, 0)),
        member("c2", "n2", "t2", props=pa),
        member("c3", "n3", "t3", props=pc, orientation=(1, 1, 0)),
        member("b12", "t1", "t2", props=pb, orientation=(0, 0, 1)),
        member("b23", "t2", "t3", props=pc, orientation=(0, 0, 1),
               start_connection=conn("LLLEEE", (0, 0, 0, 5.0e6, 8.0e6, 1.0e7))),
        member("b31", "t3", "t1", props=pa, orientation=(0, 0, 1), start_connection=conn("LLLLFF")),
        member("br", "n1", "t2", kind="brace", start_fixity="pinned", end_fixity="pinned"),
    ]
    loads = {"t1": (1.0e3, -0.5e3, -4.0e3, 250.0, 0.0, -150.0), "t3": (0.0, 1.5e3, -2.5e3)}
    return build(nodes, members, {"n1": FIXED, "n2": PIN, "n3": FIXED}, loads, fidelity=fidelity)


def symmetric_portal(fidelity: str) -> dict:
    nodes = {"bl": (-3, 0, 0), "br": (3, 0, 0), "tl": (-3, 0, 4), "tr": (3, 0, 4), "m": (0, 0, 4)}
    pb = section(inertiaY=4.0e-5, inertiaZ=1.6e-4)
    members = [
        member("cl", "bl", "tl", props=pb, orientation=(0, 1, 0)),
        member("cr", "br", "tr", props=pb, orientation=(0, 1, 0)),
        member("gl", "tl", "m", props=pb, orientation=(0, 1, 0)),
        member("gr", "tr", "m", props=pb, orientation=(0, 1, 0)),
    ]
    return build(nodes, members, {"bl": FIXED, "br": FIXED}, {"m": (0, 0, -1.0e4)}, fidelity=fidelity)


def mixed_rotatable(fidelity: str) -> dict:
    """Stable cantilever + loaded two-bar apex (out-of-plane mechanism) + unsupported beam
    + lone loaded node. All supports are FIXED or PIN so the model can be rotated."""
    stable = build(
        {"a": (0, 0, 0), "b": (4, 0, 0)},
        [member("ab", "a", "b", orientation=(0, 1, 0))],
        {"a": FIXED},
        {"b": (0, 0, -1.0e4)},
        fidelity=fidelity,
    )
    bars = build(
        {"x1": (-2, 20, 0), "x2": (2, 20, 0), "x3": (0, 20, 3)},
        [member("xm1", "x1", "x3", kind="brace"), member("xm2", "x2", "x3", kind="brace")],
        {"x1": PIN, "x2": PIN},
        {"x3": (0, 0, -1.0e3)},
    )
    floating = build(
        {"f1": (0, 40, 0), "f2": (3, 40, 1)},
        [member("fm", "f1", "f2", orientation=(0, 1, 0))],
        {},
        {"f2": (0, 0, -500.0)},
    )
    lone = build({"z": (9, 9, 9)}, [], {}, {"z": (0, 0, -1.0)})
    return combine(stable, bars, floating, lone)


# --- comparison ------------------------------------------------------------------------------------


def _vmax(values) -> float:
    return max((abs(float(v)) for v in values), default=0.0)


def scales(result: dict) -> dict:
    """Largest magnitudes by kind, used as the characteristic scale of each comparison."""
    disp = result.get("displacements", {})
    reac = result.get("reactions", {})
    mf = result.get("memberForces", {})
    return {
        "translation": _vmax(v for d in disp.values() for v in d[:3]),
        "rotation": _vmax(v for d in disp.values() for v in d[3:]),
        "force": _vmax([v for d in reac.values() for v in d[:3]] + [f[k] for f in mf.values() for k in FORCE_KEYS]),
        "moment": _vmax([v for d in reac.values() for v in d[3:]] + [f[k] for f in mf.values() for k in MOMENT_KEYS]),
    }


def close6(label: str, actual, expected, scale_t: float, scale_r: float, rtol: float) -> None:
    a, e = np.asarray(actual, float), np.asarray(expected, float)
    err_t = float(np.abs(a[:3] - e[:3]).max())
    err_r = float(np.abs(a[3:] - e[3:]).max())
    assert err_t <= rtol * scale_t, (
        f"{label}: translation/force part differs by {err_t:.3g}, above {rtol:g} x characteristic scale {scale_t:.3g}; "
        f"got {a[:3]}, expected {e[:3]}"
    )
    assert err_r <= rtol * scale_r, (
        f"{label}: rotation/moment part differs by {err_r:.3g}, above {rtol:g} x characteristic scale {scale_r:.3g}; "
        f"got {a[3:]}, expected {e[3:]}"
    )


def classification(result: dict, node_map=None) -> dict:
    """{frozenset of node ids: (state, sorted reason codes, resultsValid)}"""
    nm = node_map or {}
    return {
        frozenset(nm.get(n, n) for n in c["nodeIds"]): (c["state"], tuple(sorted(c["reasonCodes"])), c["resultsValid"])
        for c in result["components"]
    }


def assert_same_classification(base: dict, other: dict, node_map=None) -> None:
    assert other["status"] == base["status"], f"status {other['status']!r} != {base['status']!r}"
    assert classification(other) == classification(base, node_map), (
        f"component classification differs: {classification(other)} vs {classification(base, node_map)}"
    )
    for key in ("mechanisms", "translationalMechanisms", "rotationalMechanisms", "staticIndeterminacy", "freeDofs"):
        assert other["stability"][key] == base["stability"][key], f"stability.{key}: {other['stability'][key]} != {base['stability'][key]}"
    mapped = sorted((node_map or {}).get(n, n) for n in base["stability"]["unstableNodeIds"])
    assert sorted(other["stability"]["unstableNodeIds"]) == mapped, "unstable node set differs"


def assert_transformed_results(
    base: dict,
    other: dict,
    Q: np.ndarray,
    rtol: float,
    node_map=None,
    member_map=None,
    label: str = "",
) -> None:
    """``other`` must equal ``base`` with displacement/reaction six-vectors transformed by Q
    (identity for pure renaming) and member forces unchanged."""
    nm, mm = node_map or {}, member_map or {}
    s = scales(base)
    assert set(other["displacements"]) == {nm.get(n, n) for n in base["displacements"]}, "displacement entries differ"
    assert set(other["reactions"]) == {nm.get(n, n) for n in base["reactions"]}, "reaction entries differ"
    assert set(other["memberForces"]) == {mm.get(k, k) for k in base["memberForces"]}, "member force entries differ"
    for n, v in base["displacements"].items():
        close6(f"{label} displacement of {n}", other["displacements"][nm.get(n, n)], transform_vec6(v, Q), s["translation"], s["rotation"], rtol)
    for n, v in base["reactions"].items():
        close6(f"{label} reaction at {n}", other["reactions"][nm.get(n, n)], transform_vec6(v, Q), s["force"], s["moment"], rtol)
    for k, f in base["memberForces"].items():
        g = other["memberForces"][mm.get(k, k)]
        for key in FORCE_KEYS + MOMENT_KEYS:
            scale = s["force"] if key in FORCE_KEYS else s["moment"]
            err = abs(g[key] - f[key])
            assert err <= rtol * scale, (
                f"{label} member {k} {key}: {g[key]:.9g} vs {f[key]:.9g}, error {err:.3g} above {rtol:g} x scale {scale:.3g}"
            )


# --- mirror symmetry ---------------------------------------------------------------------------------

S_X = np.diag([-1.0, 1.0, 1.0])
S_Y = np.diag([1.0, -1.0, 1.0])


@pytest.mark.parametrize("fidelity", FIDELITIES)
def test_symmetric_structure_with_symmetric_load_has_symmetric_results(fidelity):
    # Portal symmetric about the plane x = 0 with a load on the symmetry plane. Each result at a
    # node equals the mirror image (S = diag(-1,1,1)) of the result at its twin; nodes on the
    # plane are their own twins, so ux, ry, rz must vanish there.
    rtol = rtol_for(fidelity)
    r = solve(symmetric_portal(fidelity))
    assert r["status"] == "success", r.get("message")
    s = scales(r)
    twins = {"bl": "br", "tl": "tr", "m": "m"}
    for a, b in twins.items():
        close6(f"displacement {a}/{b}", r["displacements"][b], transform_vec6(r["displacements"][a], S_X), s["translation"], s["rotation"], rtol)
    for a, b in (("bl", "br"),):
        close6(f"reaction {a}/{b}", r["reactions"][b], transform_vec6(r["reactions"][a], S_X), s["force"], s["moment"], rtol)
    for a, b in (("cl", "cr"), ("gl", "gr")):
        for key in FORCE_KEYS + MOMENT_KEYS:
            scale = s["force"] if key in FORCE_KEYS else s["moment"]
            assert abs(r["memberForces"][a][key] - r["memberForces"][b][key]) <= rtol * scale, (
                f"member forces {a}/{b} differ in {key}: {r['memberForces'][a][key]:.9g} vs {r['memberForces'][b][key]:.9g}"
            )
    assert r["reactions"]["bl"][2] == pytest.approx(5.0e3, rel=1e-4), "each base carries half the load"


@pytest.mark.parametrize("fidelity", FIDELITIES)
@pytest.mark.parametrize("mirror", [S_X, S_Y], ids=["mirror_x", "mirror_y"])
def test_reflected_model_gives_reflected_results(mirror, fidelity):
    # The asymmetric frame reflected through a coordinate plane: positions, forces and member
    # orientations map by S; moments by det(S) S. Results must follow the same maps; member
    # force magnitudes and classifications are unchanged.
    rtol = rtol_for(fidelity)
    base_model = with_explicit_orientation(space_frame(fidelity))
    base = solve(base_model)
    assert base["status"] == "success", base.get("message")
    other = solve(transform_model(base_model, mirror))
    assert_same_classification(base, other)
    assert_transformed_results(base, other, mirror, rtol, label="mirror")


# --- reordering and renaming ---------------------------------------------------------------------------


def shuffled(model: dict, seed: int) -> dict:
    out = {k: (list(v) if isinstance(v, list) else v) for k, v in model.items()}
    rng = random.Random(seed)
    for key in ("nodes", "members", "supports", "loads"):
        rng.shuffle(out[key])
    return out


def scrambled_names(model: dict, seed: int):
    rng = random.Random(seed)
    node_ids = [n["id"] for n in model["nodes"]]
    member_ids = [m["id"] for m in model["members"]]
    node_labels = [f"q{i:03d}" for i in range(len(node_ids))]
    member_labels = [f"w{i:03d}" for i in range(len(member_ids))]
    rng.shuffle(node_labels)
    rng.shuffle(member_labels)
    return dict(zip(node_ids, node_labels)), dict(zip(member_ids, member_labels))


@pytest.mark.parametrize("fidelity", FIDELITIES)
@pytest.mark.parametrize("seed", [1, 2, 3])
@pytest.mark.parametrize("fixture", ["space_frame", "mixed"])
def test_reordering_lists_changes_nothing(fixture, seed, fidelity):
    model = space_frame(fidelity) if fixture == "space_frame" else mixed_rotatable(fidelity)
    base = solve(model)
    other = solve(shuffled(model, seed))
    assert_same_classification(base, other)
    assert_transformed_results(base, other, np.eye(3), rtol_for(fidelity), label="reorder")


@pytest.mark.parametrize("fidelity", FIDELITIES)
@pytest.mark.parametrize("seed", [11, 12])
@pytest.mark.parametrize("fixture", ["space_frame", "mixed"])
def test_renaming_ids_and_reordering_changes_nothing(fixture, seed, fidelity):
    # Renamed ids also change which node is the lexicographically smallest, so component ids
    # change; components are compared by their (mapped) node sets instead.
    model = space_frame(fidelity) if fixture == "space_frame" else mixed_rotatable(fidelity)
    node_map, member_map = scrambled_names(model, seed)
    other_model = shuffled(rename_model(model, node_map, member_map), seed)
    base, other = solve(model), solve(other_model)
    assert_same_classification(base, other, node_map)
    assert_transformed_results(base, other, np.eye(3), rtol_for(fidelity), node_map, member_map, label="rename")
    for c in other["components"]:
        assert c["id"] == min(c["nodeIds"]), f"component id {c['id']!r} is not the smallest node id of {sorted(c['nodeIds'])}"


# --- rigid rotation and translation -------------------------------------------------------------------

ROTATIONS = {
    "axis(1,2,2)_0.7rad": ((1, 2, 2), 0.7),
    "axis(-1,1,0.5)_2.1rad": ((-1, 1, 0.5), 2.1),
    "axis(0.3,-0.8,0.5)_-1.2rad": ((0.3, -0.8, 0.5), -1.2),
    "z_quarter_turn": ((0, 0, 1), math.pi / 2),
    "x_half_turn": ((1, 0, 0), math.pi),
}


@pytest.mark.parametrize("fidelity", FIDELITIES)
@pytest.mark.parametrize("name", list(ROTATIONS))
def test_rigid_rotation_of_the_whole_model(name, fidelity):
    # Same member forces; displacement and reaction six-vectors rotated by Q (rotation vectors and
    # moments are axial vectors but det Q = +1, so they rotate like polar ones). The rotated
    # model sits at an arbitrary offset to exercise translation as well.
    axis, angle = ROTATIONS[name]
    Q = rotation_matrix(axis, angle)
    assert abs(np.linalg.det(Q) - 1.0) < 1e-12
    model = with_explicit_orientation(space_frame(fidelity))
    base = solve(model)
    assert base["status"] == "success", base.get("message")
    other = solve(transform_model(model, Q, shift=(1.5, -2.0, 0.7)))
    assert_same_classification(base, other)
    assert_transformed_results(base, other, Q, rtol_for(fidelity), label=f"rotation {name}")


@pytest.mark.parametrize("fidelity", FIDELITIES)
def test_pure_translation_of_the_whole_model(fidelity):
    model = with_explicit_orientation(space_frame(fidelity))
    base = solve(model)
    other = solve(transform_model(model, np.eye(3), shift=(100.0, -250.0, 37.5)))
    assert_same_classification(base, other)
    assert_transformed_results(base, other, np.eye(3), rtol_for(fidelity), label="translation")


@pytest.mark.parametrize("fidelity", FIDELITIES)
@pytest.mark.parametrize("name", ["axis(1,2,2)_0.7rad", "axis(-1,1,0.5)_2.1rad"])
def test_rotation_preserves_classification_of_unstable_components(name, fidelity):
    # Stable cantilever, loaded two-bar apex (out-of-plane mechanism), unsupported loaded beam and a
    # lone loaded node: classification and reason codes survive a rigid rotation; the stable
    # component's results rotate.
    axis, angle = ROTATIONS[name]
    Q = rotation_matrix(axis, angle)
    model = with_explicit_orientation(mixed_rotatable(fidelity))
    base = solve(model)
    assert base["status"] == "unstable"
    other = solve(transform_model(model, Q))
    assert_same_classification(base, other)
    assert_transformed_results(base, other, Q, rtol_for(fidelity), label=f"mixed rotation {name}")
    assert comp(other, "a")["state"] == "stable" and comp(other, "x1")["state"] == "unstable"
    # the out-of-plane mode of the apex rotates with the structure: it is perpendicular to the bars' plane
    plane_normal = Q @ np.array([0.0, 1.0, 0.0])
    # Modes may be truncated by the service, so only check when the apex mode is reported.
    for mode in other["stability"]["modes"]:
        if "x3" in mode["displacements"]:
            shape = np.asarray(mode["displacements"]["x3"][:3], float)
            assert abs(abs(float(shape @ plane_normal)) - np.linalg.norm(shape)) <= 1e-6, (
                f"apex mode {shape} is not along the rotated plane normal {plane_normal}"
            )
