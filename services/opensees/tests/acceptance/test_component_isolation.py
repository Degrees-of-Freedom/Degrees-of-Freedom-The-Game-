"""Component isolation, mechanism and determinacy acceptance tests (A03, A06, M02, section 7 rows 4-5).

A stable loaded cantilever (nodes ``a``, ``b``; component id ``a``) sits beside a
second, independent component that is unsupported, a rigid-body mechanism, an
unbraced mechanism (loaded or not), an unloaded floating part or a lone loaded
node. The stable component's results must stay valid and exact; the neighbour
must be ``unstable`` with the right reason code and must contribute no entry to
``displacements``, ``reactions`` or ``memberForces``; the overall status is
``unstable``.

Reference for the stable component (derivation): cantilever, length L = 4 m,
tip load P = 10 kN down. Tip deflection P L^3/(3 EI) down, tip slope P L^2/(2 EI),
root reaction P up, root reaction moment P L about -y (a hogging root).

Zeros: 1e-6 x a stated scale. Relative gate ``REL`` (1e-4) at linear fidelity,
``REL_NL`` (1e-3) at nonlinear fidelity (small displacements).
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from accept_linear_models import (
    EA,
    EI,
    FIXED,
    PIN,
    REL,
    REL_NL,
    X_AXIS,
    build,
    cantilever_model,
    cantilever_reference,
    check,
    check_vec,
    check_zero,
    combine,
    comp,
    disp,
    flags,
    forces,
    member,
    reac,
    require_success,
    section,
    solve,
)

L, P = 4.0, 1.0e4
FIDELITIES = ["linear", "nonlinear"]
OFFSET = 50.0  # neighbours sit far away in y; nothing is ever coincident by accident


def stable_part(fidelity: str) -> dict:
    return cantilever_model(X_AXIS, L, force=(0, 0, -P), fidelity=fidelity)


def assert_stable_part_is_exact(r: dict, fidelity: str) -> None:
    rel = REL if fidelity == "linear" else REL_NL
    ref = cantilever_reference(X_AXIS, (0, 0, -1), L, P)
    c = comp(r, "a")
    assert c["state"] == "stable" and c["resultsValid"] is True, f"stable component lost its verdict: {c['state']} {c['reasonCodes']}"
    assert sorted(c["nodeIds"]) == ["a", "b"] and c["memberIds"] == ["ab"], f"component membership leaked: {c['nodeIds']} {c['memberIds']}"
    delta = P * L**3 / (3 * EI)
    tip_u = np.array(ref["tip_u"], float)
    if fidelity == "linear":
        # Small-displacement theory: no axial motion of the tip.
        check_vec("tip deflection", disp(r, "b")[:3], tip_u, rel=rel, abs_tol=1e-6 * delta)
    else:
        # Geometrically nonlinear: the tip moves inward as the beam deflects. With the cubic
        # shape w = delta (3 xi^2 - xi^3)/2, w' = (3 delta/2L)(2 xi - xi^2), the shortening is
        # int_0^L w'^2/2 dx = (9 delta^2/8L) int_0^1 (2xi - xi^2)^2 dxi = (9 delta^2/8L)(8/15)
        # = 3 delta^2 / (5 L)  (1.7e-5 m here). The load also keeps its fixed direction while the
        # beam tilts by ~0.007 rad, adding an axial tension of about P*theta (<1% of the shortening),
        # so the axial value is gated at 3% instead of 0.1%; the other components keep REL_NL.
        shortening = 3 * delta**2 / (5 * L)
        u = disp(r, "b")
        check_vec("tip deflection (transverse)", u[1:3], tip_u[1:], rel=rel, abs_tol=1e-6 * delta)
        check("tip axial inward shift 3 delta^2/(5L)", u[0], -shortening, rel=0.03)
    check_vec("root reaction force", reac(r, "a")[:3], ref["reaction_force"], rel=rel, abs_tol=1e-6 * P)
    check_vec("root reaction moment", reac(r, "a")[3:], ref["reaction_moment"], rel=rel, abs_tol=1e-6 * P * L)
    check("root moment", forces(r, "ab")["momentStart"], P * L, rel=rel)
    check("shear", forces(r, "ab")["shear"], P, rel=rel)


def assert_no_entries_for(r: dict, node_ids, member_ids) -> None:
    for nid in node_ids:
        assert nid not in r["displacements"], f"invalid component node {nid!r} has a displacement entry"
        assert nid not in r["reactions"], f"invalid component node {nid!r} has a reaction entry"
    for mid in member_ids:
        assert mid not in r["memberForces"], f"invalid component member {mid!r} has a member-force entry"


# --- neighbours ---------------------------------------------------------------------------


def n_unsupported():
    # Free-floating beam carrying a load, no restraint at all.
    return build(
        {"x1": (0, OFFSET, 0), "x2": (3, OFFSET, 0)},
        [member("xm", "x1", "x2")],
        {},
        {"x2": (0, 0, -1.0e3)},
    )


def n_rigid_body():
    # One vertical restraint only: the beam can still slide, swing and roll as a rigid body.
    return build(
        {"x1": (0, OFFSET, 0), "x2": (3, OFFSET, 0)},
        [member("xm", "x1", "x2")],
        {"x1": flags("FFTFFF")},
        {"x2": (0, 0, -1.0e3)},
    )


def inplane_frame(load: float, diagonal: bool = False, kind: str = "brace", prefix: str = "x", y: float = OFFSET):
    """Pin-jointed rectangle in the XZ plane, 4 m x 3 m, bases pinned, tops held out of plane only.

    Nodes x1 (0,0) x2 (4,0) bases; x3 (0,3) x4 (4,3) tops. Bars x1-x3, x2-x4, x3-x4 (+ x1-x4 if braced).
    Horizontal load ``load`` at x3."""
    n = {f"{prefix}{i}": p for i, p in enumerate([(0, y, 0), (4, y, 0), (0, y, 3), (4, y, 3)], start=1)}
    pinned = {"start_fixity": "pinned", "end_fixity": "pinned"} if kind == "beam_pinned" else {}
    k = "brace" if kind == "brace" else "beam"
    names = [("13", 1, 3), ("24", 2, 4), ("34", 3, 4)] + ([("14", 1, 4)] if diagonal else [])
    members = [member(f"{prefix}m{nm}", f"{prefix}{a}", f"{prefix}{b}", kind=k, **pinned) for nm, a, b in names]
    supports = {f"{prefix}1": PIN, f"{prefix}2": PIN, f"{prefix}3": flags("FTFFFF"), f"{prefix}4": flags("FTFFFF")}
    loads = {f"{prefix}3": (load, 0, 0)} if load else {}
    return build(n, members, supports, loads)


def n_mechanism_loaded():
    return inplane_frame(5.0e3)


def n_mechanism_unloaded():
    return inplane_frame(0.0)


def two_bars(load: float = -1.0e3, prefix: str = "x", y: float = OFFSET):
    n = {f"{prefix}1": (-2, y, 0), f"{prefix}2": (2, y, 0), f"{prefix}3": (0, y, 3)}
    members = [
        member(f"{prefix}m1", f"{prefix}1", f"{prefix}3", kind="brace"),
        member(f"{prefix}m2", f"{prefix}2", f"{prefix}3", kind="brace"),
    ]
    loads = {f"{prefix}3": (0, 0, load)} if load else {}
    return build(n, members, {f"{prefix}1": PIN, f"{prefix}2": PIN}, loads)


def n_floating_unloaded():
    return build({"x1": (0, OFFSET, 0), "x2": (3, OFFSET, 0)}, [member("xm", "x1", "x2")], {}, {})


def n_lone_loaded_node():
    return build({"x1": (0, OFFSET, 0)}, [], {}, {"x1": (0, 0, -1.0e3)})


# name: (builder, reason code that must appear on the neighbour, neighbour component id, nodes, members)
NEIGHBOURS = {
    "unsupported": (n_unsupported, "unsupported_component", "x1", ["x1", "x2"], ["xm"]),
    "rigid_body": (n_rigid_body, "rigid_body_mechanism", "x1", ["x1", "x2"], ["xm"]),
    "pin_frame_loaded": (n_mechanism_loaded, "internal_mechanism", "x1", ["x1", "x2", "x3", "x4"], ["xm13", "xm24", "xm34"]),
    "pin_frame_unloaded": (n_mechanism_unloaded, "internal_mechanism", "x1", ["x1", "x2", "x3", "x4"], ["xm13", "xm24", "xm34"]),
    "two_bars_out_of_plane": (two_bars, "rigid_body_mechanism", "x1", ["x1", "x2", "x3"], ["xm1", "xm2"]),
    "floating_unloaded": (n_floating_unloaded, "unsupported_component", "x1", ["x1", "x2"], ["xm"]),
    "lone_loaded_node": (n_lone_loaded_node, "unsupported_component", "x1", ["x1"], []),
}


@pytest.mark.parametrize("fidelity", FIDELITIES)
@pytest.mark.parametrize("name", list(NEIGHBOURS))
def test_stable_component_is_unaffected_by_an_unstable_neighbour(name, fidelity):
    builder, code, cid, nodes, members = NEIGHBOURS[name]
    r = solve(combine(stable_part(fidelity), builder()))
    assert r["status"] == "unstable", f"overall status must be 'unstable' beside {name}, got {r['status']!r}"
    assert isinstance(r.get("message"), str) and r["message"].strip()
    assert_stable_part_is_exact(r, fidelity)
    bad = comp(r, cid)
    assert bad["state"] == "unstable", f"{name}: neighbour state {bad['state']!r}"
    assert bad["resultsValid"] is False
    assert code in bad["reasonCodes"], f"{name}: expected reason {code!r}, got {bad['reasonCodes']}"
    assert code in r["analysis"]["reasonCodes"], "analysis reason codes must be the union of the components'"
    assert sorted(bad["nodeIds"]) == sorted(nodes) and sorted(bad["memberIds"]) == sorted(members)
    assert len(r["components"]) == 2
    assert_no_entries_for(r, nodes, members)
    assert set(r["displacements"]) == {"a", "b"} and set(r["reactions"]) == {"a"} and set(r["memberForces"]) == {"ab"}
    assert r["stability"]["stable"] is False and r["stability"]["mechanisms"] >= 1


@pytest.mark.parametrize("fidelity", FIDELITIES)
def test_two_unstable_neighbours_and_one_stable_component(fidelity):
    # Three independent components in one request: ids a (stable), x1 (unsupported), y1 (mechanism).
    y_frame = inplane_frame(5.0e3, prefix="y", y=-OFFSET)
    r = solve(combine(stable_part(fidelity), n_unsupported(), y_frame))
    assert r["status"] == "unstable"
    assert_stable_part_is_exact(r, fidelity)
    assert comp(r, "x1")["state"] == "unstable" and "unsupported_component" in comp(r, "x1")["reasonCodes"]
    assert comp(r, "y1")["state"] == "unstable" and "internal_mechanism" in comp(r, "y1")["reasonCodes"]
    assert set(r["displacements"]) == {"a", "b"}


# --- genuine mechanisms --------------------------------------------------------------------


@pytest.mark.parametrize("fidelity", FIDELITIES)
@pytest.mark.parametrize("load", [5.0e3, 0.0], ids=["loaded", "unloaded"])
@pytest.mark.parametrize("kind", ["brace", "beam_pinned"])
def test_unbraced_pin_jointed_frame_has_one_inplane_mechanism(kind, load, fidelity):
    # 4 free DOFs (x3, x4 in X and Z), 3 bars: one in-plane sway mechanism. The top nodes swing
    # horizontally (first order) together; an unloaded mechanism is still 'unstable' (A03).
    m = inplane_frame(load, kind=kind, y=0.0)
    m["analysis"]["fidelity"] = fidelity
    r = solve(m)
    assert r["status"] == "unstable", f"{kind}, load {load}: got {r['status']!r}"
    c = comp(r, "x1")
    assert c["state"] == "unstable" and "internal_mechanism" in c["reasonCodes"]
    st = r["stability"]
    assert st["mechanisms"] == 1 and st["translationalMechanisms"] == 1 and st["rotationalMechanisms"] == 0, st
    assert set(st["unstableNodeIds"]) == {"x3", "x4"}, f"the sway involves exactly the two top nodes: {st['unstableNodeIds']}"
    mode = st["modes"][0]
    assert mode["kind"] == "translation"
    for nid in ("x3", "x4"):
        shape = mode["displacements"][nid]
        assert abs(abs(shape[0]) - 1.0) <= 1e-6, f"{nid}: horizontal swing must have unit amplitude, got {shape}"
        assert abs(shape[1]) <= 1e-6 and abs(shape[2]) <= 1e-6, f"{nid}: no vertical or out-of-plane motion at first order: {shape}"
    assert not r.get("displacements"), "an unstable component must contribute no displacement entries"


@pytest.mark.parametrize("fidelity", FIDELITIES)
@pytest.mark.parametrize("load", [-1.0e3, 0.0], ids=["loaded", "unloaded"])
def test_two_pinned_bars_in_a_plane_have_the_out_of_plane_mechanism(load, fidelity):
    # Apex of two coplanar bars can swing perpendicular to their plane at zero first-order stiffness.
    # That swing is, to first order, a rigid rotation of the whole component about the line through
    # the two pins (apex y-motion = w x r with w along that line), so the reason code is
    # rigid_body_mechanism, not internal_mechanism: the supports cannot stop the rotation.
    m = two_bars(load, prefix="x", y=0.0)
    m["analysis"]["fidelity"] = fidelity
    r = solve(m)
    assert r["status"] == "unstable"
    st = r["stability"]
    assert (st["mechanisms"], st["translationalMechanisms"]) == (1, 1), st
    assert st["unstableNodeIds"] == ["x3"]
    shape = st["modes"][0]["displacements"]["x3"]
    assert abs(abs(shape[1]) - 1.0) <= 1e-6 and abs(shape[0]) <= 1e-6 and abs(shape[2]) <= 1e-6, f"apex must swing along Y: {shape}"
    assert "rigid_body_mechanism" in comp(r, "x1")["reasonCodes"], comp(r, "x1")["reasonCodes"]


def test_diagonal_brace_removes_the_mechanism_and_carries_the_sway_load():
    # Adding x1-x4 (length 5) stabilises the frame; 4 bars, 4 free DOFs: determinate.
    # Joint x3: chord force T_c = -H (compression H). Joint x4: horizontal H - 0.8 T_d = 0 -> T_d = 1.25 H;
    # vertical -0.6 T_d - N_24 = 0 -> N_24 = -0.75 H; post x1-x3 carries 0.
    # Reactions: x1 = (-H, 0, -0.75 H), x2 = (0, 0, +0.75 H).
    h = 5.0e3
    m = inplane_frame(h, diagonal=True, y=0.0)
    r = require_success(solve(m), "braced frame")
    assert r["stability"]["staticIndeterminacy"] == 0 and r["stability"]["mechanisms"] == 0
    check("diagonal tension", forces(r, "xm14")["axial"], 1.25 * h)
    check("chord compression", forces(r, "xm34")["axial"], -h)
    check("post x2-x4 compression", forces(r, "xm24")["axial"], -0.75 * h)
    check_zero("post x1-x3 force", forces(r, "xm13")["axial"], h, scale_name="sway load")
    check_vec("reaction x1", reac(r, "x1")[:3], (-h, 0.0, -0.75 * h), abs_tol=1e-6 * h)
    check_vec("reaction x2", reac(r, "x2")[:3], (0.0, 0.0, 0.75 * h), abs_tol=1e-6 * h)


# --- unconnected coincident members ----------------------------------------------------------


@pytest.mark.parametrize("fidelity", FIDELITIES)
def test_two_cantilevers_with_coincident_tips_share_nothing(fidelity):
    # Two cantilevers with different sections whose root nodes r1/r2 and tip nodes t1/t2 are at
    # identical positions but are different joints. Load only on t1: it behaves as a lone
    # cantilever (P L^3/3EI); the second member stays at rest, no force or displacement moves across.
    rel = REL if fidelity == "linear" else REL_NL
    nodes = {"r1": (0, 0, 0), "t1": (L, 0, 0), "r2": (0, 0, 0), "t2": (L, 0, 0)}
    members = [
        member("c1", "r1", "t1"),
        member("c2", "r2", "t2", props=section(inertiaY=4.0e-4, inertiaZ=4.0e-4)),
    ]
    m = build(nodes, members, {"r1": FIXED, "r2": FIXED}, {"t1": (0, 0, -P)}, fidelity=fidelity)
    r = require_success(solve(m), "coincident cantilevers")
    assert sorted(c["id"] for c in r["components"]) == ["r1", "r2"], "coincident nodes must stay separate components"
    delta = P * L**3 / (3 * EI)
    check("loaded tip", disp(r, "t1")[2], -delta, rel=rel)
    check("reaction of loaded cantilever", reac(r, "r1")[2], P, rel=rel)
    check_zero("coincident unloaded tip", np.linalg.norm(disp(r, "t2")), delta, scale_name="loaded tip deflection")
    check_zero("reaction of unloaded cantilever", np.linalg.norm(reac(r, "r2")), P, scale_name="applied load")
    for key in ("axial", "shear", "torsion", "momentStart", "momentEnd"):
        check_zero(f"unloaded member {key}", forces(r, "c2")[key], P * L, scale_name="load x length")


@pytest.mark.parametrize("fidelity", FIDELITIES)
def test_member_touching_another_member_without_a_shared_node_transfers_nothing(fidelity):
    # Post q1 -> q2 stands with its tip q2 exactly at the midpoint of the beam p1 -> p2, but
    # the beam has no node there. Geometry alone never connects: the loaded post is a lone
    # cantilever (horizontal tip load in y) and the beam, fixed at both ends, does not move.
    rel = REL if fidelity == "linear" else REL_NL
    h = 3.0
    nodes = {"p1": (-2, 0, h), "p2": (2, 0, h), "q1": (0, 0, 0), "q2": (0, 0, h)}
    members = [member("beam", "p1", "p2"), member("post", "q1", "q2")]
    m = build(nodes, members, {"p1": FIXED, "p2": FIXED, "q1": FIXED}, {"q2": (0, 1.0e4, 0)}, fidelity=fidelity)
    r = require_success(solve(m), "touching members")
    assert sorted(c["id"] for c in r["components"]) == ["p1", "q1"]
    check("post tip deflection", disp(r, "q2")[1], 1.0e4 * h**3 / (3 * EI), rel=rel)
    check_zero("beam midspan region: end node", np.linalg.norm(disp(r, "p1")), 1e-3, scale_name="1 mm")
    for key in ("axial", "shear", "torsion", "momentStart", "momentEnd"):
        check_zero(f"beam {key}", forces(r, "beam")[key], 1.0e4 * h, scale_name="load x height")


@pytest.mark.parametrize("fidelity", FIDELITIES)
def test_unattached_member_end_at_a_shared_node_stays_out_of_the_component(fidelity):
    # Node j carries a load and the rigid end of member A (a -> j). Member B (b -> j) is attached to
    # b but its end at j is unattached ('free'). A carries all the load as a cantilever of length L;
    # B, in its own component, carries nothing.
    rel = REL if fidelity == "linear" else REL_NL
    nodes = {"a": (-L, 0, 0), "j": (0, 0, 0), "b": (L, 0, 0)}
    members = [
        member("A", "a", "j"),
        member("B", "b", "j", end_fixity="free", props=section(inertiaY=9.0e-4, inertiaZ=9.0e-4)),
    ]
    m = build(nodes, members, {"a": FIXED, "b": FIXED}, {"j": (0, 0, -P)}, fidelity=fidelity)
    r = require_success(solve(m), "free end at shared node")
    assert comp(r, "a")["nodeIds"] and "j" in comp(r, "a")["nodeIds"] and "b" not in comp(r, "a")["nodeIds"]
    assert comp(r, "b")["nodeIds"] == ["b"] and comp(r, "b")["memberIds"] == ["B"]
    check("joint deflection", disp(r, "j")[2], -P * L**3 / (3 * EI), rel=rel)
    check("reaction at a", reac(r, "a")[2], P, rel=rel)
    check_zero("reaction at b", np.linalg.norm(reac(r, "b")), P, scale_name="applied load")


# --- a node with only a load / only a support ---------------------------------------------------


@pytest.mark.parametrize("fidelity", FIDELITIES)
def test_loaded_node_without_any_member_is_an_unstable_component_of_its_own(fidelity):
    m = build({"lone": (1, 2, 3)}, [], {}, {"lone": (0, 0, -1.0)}, fidelity=fidelity)
    r = solve(m)
    assert r["status"] == "unstable"
    c = comp(r, "lone")
    assert c["state"] == "unstable" and c["resultsValid"] is False and "unsupported_component" in c["reasonCodes"]
    assert c["nodeIds"] == ["lone"] and c["memberIds"] == []
    assert_no_entries_for(r, ["lone"], [])


@pytest.mark.parametrize("fidelity", FIDELITIES)
def test_fully_restrained_node_without_members_just_reacts_its_load(fidelity):
    # No free DOF: stable, reaction = -load, nothing else to compute.
    m = build({"s": (0, 0, 0)}, [], {"s": FIXED}, {"s": (10.0, -20.0, -30.0, 1.0, 2.0, 3.0)}, fidelity=fidelity)
    r = require_success(solve(m), "restrained lone node")
    assert comp(r, "s")["state"] == "stable" and comp(r, "s")["resultsValid"] is True
    check_vec("reaction", reac(r, "s"), (-10.0, 20.0, 30.0, -1.0, -2.0, -3.0), abs_tol=1e-9)


# --- component ids ---------------------------------------------------------------------------------


@pytest.mark.parametrize("fidelity", FIDELITIES)
def test_component_ids_are_the_lexicographically_smallest_node_id(fidelity):
    # Three components. Strings compare character by character, so "10" < "9" and "100" > "10".
    #   {"9", "10"}            -> id "10"
    #   {"m5", "b2", "z1"}     -> id "b2"
    #   {"c3"} lone fixed node -> id "c3"
    nodes = {
        "9": (0, 0, 0), "10": (3, 0, 0),
        "m5": (0, 20, 0), "b2": (3, 20, 0), "z1": (6, 20, 0),
        "c3": (0, 40, 0),
    }
    members = [
        member("k1", "9", "10"),
        member("k2", "m5", "b2"),
        member("k3", "b2", "z1"),
    ]
    supports = {"9": FIXED, "m5": FIXED, "c3": FIXED}
    loads = {"10": (0, 0, -1.0e3), "z1": (0, 0, -1.0e3), "c3": (5.0, 0, 0)}
    r = require_success(solve(build(nodes, members, supports, loads, fidelity=fidelity)), "ids")
    assert sorted(c["id"] for c in r["components"]) == ["10", "b2", "c3"]
    assert sorted(comp(r, "10")["nodeIds"]) == ["10", "9"]
    assert sorted(comp(r, "b2")["nodeIds"]) == ["b2", "m5", "z1"]
    assert sorted(comp(r, "b2")["memberIds"]) == ["k2", "k3"]
    assert comp(r, "c3")["nodeIds"] == ["c3"]


# --- static indeterminacy -----------------------------------------------------------------------------


def _tripod(legs: int) -> dict:
    # Apex over a base circle of radius 2, apex height 3, ``legs`` axial braces, all feet pinned.
    # Unknown bar forces: legs. Equations: 3 (apex translations). Indeterminacy = legs - 3.
    feet = {f"f{i}": (2 * math.cos(2 * math.pi * i / legs), 2 * math.sin(2 * math.pi * i / legs), 0.0) for i in range(legs)}
    members = [member(f"l{i}", f"f{i}", "apex", kind="brace") for i in range(legs)]
    return build({"apex": (0, 0, 3)} | feet, members, {k: PIN for k in feet}, {"apex": (0, 0, -3.0e4)})


@pytest.mark.parametrize("fidelity", FIDELITIES)
@pytest.mark.parametrize(
    "case, expected",
    [
        ("tripod_determinate", 0),
        ("four_leg_pyramid_one_redundant", 1),
        ("cantilever", 0),
        ("fixed_fixed_beam", 6),
    ],
)
def test_static_indeterminacy_counts(case, expected, fidelity):
    # Mechanics: a space truss node has 3 equations; bars add one unknown each (3 bars / 3 eq -> 0;
    # 4 bars -> 1). A cantilever has 6 reactions for 6 equilibrium equations -> 0. A beam fixed at
    # both ends has 12 reactions for 6 equations -> 6 (3D).
    if case == "tripod_determinate":
        m = _tripod(3)
    elif case == "four_leg_pyramid_one_redundant":
        m = _tripod(4)
    elif case == "cantilever":
        m = cantilever_model(X_AXIS, L, force=(0, 0, -P))
    else:
        m = build({"a": (0, 0, 0), "b": (L, 0, 0)}, [member("ab", "a", "b")], {"a": FIXED, "b": FIXED}, {})
    m["analysis"]["fidelity"] = fidelity
    r = require_success(solve(m), case)
    assert r["stability"]["staticIndeterminacy"] == expected, f"{case}: model degree {r['stability']['staticIndeterminacy']}, expected {expected}"
    assert len(r["components"]) == 1
    assert r["components"][0]["stability"]["staticIndeterminacy"] == expected
    assert r["stability"]["mechanisms"] == 0 and r["stability"]["stable"] is True


def test_four_leg_pyramid_shares_the_vertical_load_equally():
    # Symmetric redundant truss: the four equal legs each carry N = -P Lb/(4 h) (vertical component
    # P/4 each), feet react P/4 up, apex settles P Lb^3/(4 h^2 EA).
    r_, h, load = 2.0, 3.0, 3.0e4
    lb = math.hypot(r_, h)
    res = require_success(solve(_tripod(4)), "pyramid")
    for i in range(4):
        check(f"leg {i} axial", forces(res, f"l{i}")["axial"], -load * lb / (4 * h))
        check(f"foot {i} reaction", reac(res, f"f{i}")[2], load / 4)
    check("apex settlement", disp(res, "apex")[2], -load * lb**3 / (4 * h**2 * EA))
