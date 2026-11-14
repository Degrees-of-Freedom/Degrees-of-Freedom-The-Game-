"""Linear closed-form acceptance tests (solver criteria section 7, first rows).

Every expected value is derived by hand next to the assertion. Nothing is taken
from running the solver. All cases run with ``analysis.fidelity = "linear"``
and explicit member properties (see ``accept_linear_models``).

Gates: nonzero linear quantities within ``REL`` = 1e-4 relative (the criteria
allow 1e-3). Expected zeros use an explicit absolute tolerance of 1e-6 times a
stated characteristic scale (the applied load, load x length, or the reference
displacement of the case).

Beams are Euler-Bernoulli (the contract carries no shear area).
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from accept_linear_models import (
    EA,
    EI,
    E,
    FIXED,
    GJ,
    PIN,
    REL,
    X_AXIS,
    Z_AXIS,
    build,
    cantilever_model,
    cantilever_reference,
    check,
    check_vec,
    check_zero,
    disp,
    flags,
    forces,
    local_axes,
    member,
    reac,
    require_success,
    section,
    solve,
    unit,
)

# --- axial bar --------------------------------------------------------------

AXIAL_DIRECTIONS = {
    "+x": (1, 0, 0),
    "-y": (0, -1, 0),
    "+z": (0, 0, 1),
    "skew(1,2,2)": (1, 2, 2),
    "skew(-2,3,6)": (-2, 3, 6),
}


@pytest.mark.parametrize("sign", [1, -1], ids=["tension", "compression"])
@pytest.mark.parametrize("name", list(AXIAL_DIRECTIONS))
def test_axial_beam_bar(name, sign):
    # Bar of length L along unit t, fixed at a, axial load F t at b.
    # Elongation = F L / EA, axial force = F (tension +), reaction = -F t.
    t = unit(AXIAL_DIRECTIONS[name])
    length, load = 3.0, sign * 25.0e3
    m = build({"a": (0, 0, 0), "b": tuple(length * t)}, [member("ab", "a", "b")], {"a": FIXED}, {"b": tuple(load * t)})
    r = require_success(solve(m), f"axial beam bar {name}")
    delta = load * length / EA
    check_vec("tip translation", disp(r, "b")[:3], delta * t, abs_tol=1e-6 * abs(delta))
    check_zero("tip rotation", np.linalg.norm(disp(r, "b")[3:]), delta / length, scale_name="delta/L")
    f = forces(r, "ab")
    check("axial force (tension +)", f["axial"], load, abs_tol=0.0)
    for key in ("shear", "torsion"):
        check_zero(f"member {key}", f[key], load, scale_name="applied load")
    for key in ("momentStart", "momentEnd"):
        check_zero(f"member {key}", f[key], load * length, scale_name="load x length")
    check_vec("reaction force at a", reac(r, "a")[:3], -load * t, abs_tol=1e-6 * abs(load))
    check_zero("reaction moment at a", np.linalg.norm(reac(r, "a")[3:]), load * length, scale_name="load x length")


@pytest.mark.parametrize("sign", [1, -1], ids=["tension", "compression"])
@pytest.mark.parametrize("axis", [0, 1, 2], ids=["x", "y", "z"])
def test_axial_brace_bar(axis, sign):
    # Same closed form for an axial-only brace. A lone brace has no transverse
    # stiffness, so b is restrained transversely (reaction there must be zero).
    t = np.zeros(3)
    t[axis] = 1.0
    length, load = 3.0, sign * 25.0e3
    b_flags = [i != axis for i in range(3)] + [False, False, False]
    m = build(
        {"a": (0, 0, 0), "b": tuple(length * t)},
        [member("ab", "a", "b", kind="brace")],
        {"a": PIN, "b": b_flags},
        {"b": tuple(load * t)},
    )
    r = require_success(solve(m), "axial brace")
    check_vec("tip translation", disp(r, "b")[:3], load * length / EA * t, abs_tol=1e-6 * abs(load * length / EA))
    check("brace axial force", forces(r, "ab")["axial"], load)
    check_vec("reaction at a", reac(r, "a")[:3], -load * t, abs_tol=1e-6 * abs(load))
    check_zero("transverse reaction at b", np.linalg.norm(reac(r, "b")[:3]), load, scale_name="applied load")


# --- cantilever -------------------------------------------------------------

S7 = (2 / 7, 3 / 7, 6 / 7)  # unit skew axis (2,3,6)/7
CANTILEVER_CASES = {
    # name: (member axis t, load direction n perpendicular to t)
    "x_load+y": ((1, 0, 0), (0, 1, 0)),
    "x_load-z": ((1, 0, 0), (0, 0, -1)),
    "column_z_load+x": ((0, 0, 1), (1, 0, 0)),
    "-y_load+x": ((0, -1, 0), (1, 0, 0)),
    "skew236_load(3,-2,0)": (S7, (3, -2, 0)),
    "skew236_load_t_cross_n": (S7, tuple(np.cross(S7, unit((3, -2, 0))))),
    "skew111_load(1,-1,0)": ((1, 1, 1), (1, -1, 0)),
}


@pytest.mark.parametrize("name", list(CANTILEVER_CASES))
def test_cantilever_tip_load(name):
    t_in, n_in = CANTILEVER_CASES[name]
    t, n = unit(t_in), unit(n_in)
    length, load = 4.0, 10.0e3
    ref = cantilever_reference(t, n, length, load)  # derivation in accept_linear_models
    m = cantilever_model(t, length, force=tuple(load * n))
    r = require_success(solve(m), f"cantilever {name}")
    tip = disp(r, "b")
    delta = load * length**3 / (3 * EI)
    theta = load * length**2 / (2 * EI)
    check_vec("tip deflection (P L^3 / 3EI along load)", tip[:3], ref["tip_u"], abs_tol=1e-6 * delta)
    check_vec("tip rotation (P L^2 / 2EI about t x n)", tip[3:], ref["tip_theta"], abs_tol=1e-6 * theta)
    f = forces(r, "ab")
    check("shear P", f["shear"], load)
    check("root moment P L", f["momentStart"], load * length)
    check_zero("tip moment", f["momentEnd"], load * length, scale_name="load x length")
    check_zero("axial force", f["axial"], load, scale_name="applied load")
    check_zero("torsion", f["torsion"], load * length, scale_name="load x length")
    check_vec("reaction force", reac(r, "a")[:3], ref["reaction_force"], abs_tol=1e-6 * load)
    check_vec("reaction moment", reac(r, "a")[3:], ref["reaction_moment"], abs_tol=1e-6 * load * length)


# --- simply supported beam, midspan load --------------------------------------


@pytest.mark.parametrize("n_in", [(0, 0, -1), (0, 1, 0), (0, 0, 1)], ids=["down", "+y", "up"])
def test_simply_supported_beam_midspan_load(n_in):
    # Span L, load P along unit n at midspan. Roller-pin supports: a holds
    # UX UY UZ and RX, b holds UY UZ; rotations about Y and Z are free.
    # Midspan deflection w = P L^3 / (48 EI) along n.
    # End slope w'(0) = P L^2 / (16 EI), w'(L) = -P L^2 / (16 EI): rotation
    # vector = w' (t x n) with t = +x.
    # Reactions -P/2 n at each support; shear P/2 per half; midspan moment P L / 4.
    n = unit(n_in)
    length, load = 6.0, 12.0e3
    nodes = {"a": (0, 0, 0), "m": (length / 2, 0, 0), "b": (length, 0, 0)}
    members = [member("am", "a", "m"), member("mb", "m", "b")]
    supports = {"a": flags("TTTTFF"), "b": flags("FTTFFF")}
    m = build(nodes, members, supports, {"m": tuple(load * n)})
    r = require_success(solve(m), "simply supported beam")
    delta = load * length**3 / (48 * EI)
    slope = load * length**2 / (16 * EI)
    t = X_AXIS
    check_vec("midspan deflection", disp(r, "m")[:3], delta * n, abs_tol=1e-6 * delta)
    check_vec("rotation at a", disp(r, "a")[3:], slope * np.cross(t, n), abs_tol=1e-6 * slope)
    check_vec("rotation at b", disp(r, "b")[3:], -slope * np.cross(t, n), abs_tol=1e-6 * slope)
    check_vec("reaction at a", reac(r, "a")[:3], -load / 2 * n, abs_tol=1e-6 * load)
    check_vec("reaction at b", reac(r, "b")[:3], -load / 2 * n, abs_tol=1e-6 * load)
    for mid in ("am", "mb"):
        check(f"{mid} shear", forces(r, mid)["shear"], load / 2)
        check_zero(f"{mid} axial", forces(r, mid)["axial"], load, scale_name="applied load")
    check("moment at midspan (am end)", forces(r, "am")["momentEnd"], load * length / 4)
    check("moment at midspan (mb start)", forces(r, "mb")["momentStart"], load * length / 4)
    check_zero("moment at support a", forces(r, "am")["momentStart"], load * length, scale_name="load x length")
    check_zero("moment at support b", forces(r, "mb")["momentEnd"], load * length, scale_name="load x length")


# --- torsion ----------------------------------------------------------------


@pytest.mark.parametrize("sign", [1, -1], ids=["+T", "-T"])
@pytest.mark.parametrize("axis", [(1, 0, 0), (0, -1, 0), (0, 0, 1), S7], ids=["x", "-y", "z", "skew236"])
def test_torsion_of_cantilever(axis, sign):
    # Torque T about the member axis t at the tip of a cantilever of length L:
    # twist phi = T L / (G J); torsion = |T| along the member; reaction moment = -T t.
    t = unit(axis)
    length, torque = 2.5, sign * 5.0e3
    m = cantilever_model(t, length, moment=tuple(torque * t))
    r = require_success(solve(m), "torsion")
    phi = torque * length / GJ
    check_vec("tip rotation", disp(r, "b")[3:], phi * t, abs_tol=1e-6 * abs(phi))
    check_zero("tip translation", np.linalg.norm(disp(r, "b")[:3]), abs(phi) * length, scale_name="phi x L")
    f = forces(r, "ab")
    check("torsion magnitude", f["torsion"], abs(torque))
    for key in ("shear", "axial"):
        check_zero(f"member {key}", f[key], abs(torque) / length, scale_name="T / L")
    for key in ("momentStart", "momentEnd"):
        check_zero(f"member {key}", f[key], abs(torque), scale_name="T")
    check_vec("reaction moment", reac(r, "a")[3:], -torque * t, abs_tol=1e-6 * abs(torque))
    check_zero("reaction force", np.linalg.norm(reac(r, "a")[:3]), abs(torque) / length, scale_name="T / L")


# --- unequal Iy / Iz with orientation: local axes follow the contract ----------

IY, IZ = 4.0e-5, 1.6e-4  # ratio 4: any mix-up of the principal axes is a 300% error


def _unequal_props():
    return section(inertiaY=IY, inertiaZ=IZ)


# Literal cases, written from the contract rule alone (no helper):
#   local x = start->end; y = part of `orientation` perpendicular to x
#   (default Z, or X for a member parallel to Z); z = x cross y.
#   Inertia Iz resists displacement along local y (bending about local z);
#   Iy resists displacement along local z (bending about local y).
LITERAL_AXIS_CASES = {
    # member along +X, orientation +Y: y = Y, z = X x Y = Z
    "x_ori_Y__load_Y": ((1, 0, 0), (0, 1, 0), (0, 1, 0), "Iz"),
    "x_ori_Y__load_Z": ((1, 0, 0), (0, 1, 0), (0, 0, 1), "Iy"),
    # member along +X, default orientation Z: y = Z, z = X x Z = -Y
    "x_default__load_Z": ((1, 0, 0), None, (0, 0, 1), "Iz"),
    "x_default__load_Y": ((1, 0, 0), None, (0, 1, 0), "Iy"),
    # member along +Z (parallel to Z): reference X, y = X, z = Z x X = Y
    "z_default__load_X": ((0, 0, 1), None, (1, 0, 0), "Iz"),
    "z_default__load_Y": ((0, 0, 1), None, (0, 1, 0), "Iy"),
    # orientation with a component along the member axis: only the perpendicular part counts
    "x_ori_(3,0,1)__load_Z": ((1, 0, 0), (3, 0, 1), (0, 0, 1), "Iz"),
    "x_ori_(3,1,0)__load_Y": ((1, 0, 0), (3, 1, 0), (0, 1, 0), "Iz"),
    # orientation 45 degrees between Y and Z: y = (0,1,1)/sqrt2, z = (0,-1,1)/sqrt2
    "x_ori_(0,1,1)__load_y_local": ((1, 0, 0), (0, 1, 1), (0, 1, 1), "Iz"),
    "x_ori_(0,1,1)__load_z_local": ((1, 0, 0), (0, 1, 1), (0, -1, 1), "Iy"),
}


@pytest.mark.parametrize("sign", [1, -1], ids=["+", "-"])
@pytest.mark.parametrize("name", list(LITERAL_AXIS_CASES))
def test_unequal_inertia_literal_axes(name, sign):
    t_in, orientation, load_dir, which = LITERAL_AXIS_CASES[name]
    t, n = unit(t_in), sign * unit(load_dir)
    inertia = IZ if which == "Iz" else IY
    length, load = 3.0, 5.0e3
    # Tip deflection of a cantilever with its own inertia: P L^3 / (3 E I). The
    # load is a principal-axis load, so the displacement is along the load only.
    delta = load * length**3 / (3 * E * inertia)
    m = cantilever_model(t, length, force=tuple(load * n), props=_unequal_props(), orientation=orientation)
    r = require_success(solve(m), name)
    check_vec(f"tip deflection using {which}", disp(r, "b")[:3], delta * n, abs_tol=1e-6 * delta)
    theta = load * length**2 / (2 * E * inertia)
    check_vec("tip rotation", disp(r, "b")[3:], theta * np.cross(t, n), abs_tol=1e-6 * theta)
    check("root moment", forces(r, "ab")["momentStart"], load * length)


SKEW_AXIS_CASES = {
    "skew_default_(1,1,0)": ((1, 1, 0), None),
    "skew_default_(2,3,6)": ((2, 3, 6), None),
    "skew_ori_(0,1,0)": ((2, 3, 6), (0, 1, 0)),
    "skew_ori_(1,-1,2)": ((1, 1, 1), (1, -1, 2)),
}


@pytest.mark.parametrize("which", ["y", "z"])
@pytest.mark.parametrize("name", list(SKEW_AXIS_CASES))
def test_unequal_inertia_skew_member_follows_contract_axes(name, which):
    # Same physics on a skew member. Local axes come from the contract rule;
    # a load along local y uses Iz, a load along local z uses Iy.
    t_in, orientation = SKEW_AXIS_CASES[name]
    t = unit(t_in)
    _, y, z = local_axes((0, 0, 0), t, orientation)
    n, inertia = (y, IZ) if which == "y" else (z, IY)
    length, load = 3.0, 5.0e3
    delta = load * length**3 / (3 * E * inertia)
    m = cantilever_model(t, length, force=tuple(load * n), props=_unequal_props(), orientation=orientation)
    r = require_success(solve(m), name)
    check_vec(f"tip deflection, load along local {which}", disp(r, "b")[:3], delta * n, abs_tol=1e-6 * delta)


# --- parallel springs under a common displacement -------------------------------


@pytest.mark.parametrize("kind", ["brace", "beam"])
def test_parallel_bars_between_the_same_two_nodes_share_load_by_stiffness(kind):
    # Three members between nodes a and b with different (E, A). Common
    # elongation d = F / sum(k), k_i = E_i A_i / L; member force F_i = k_i d =
    # F k_i / sum(k); total reaction -F.
    length, load = 3.0, 30.0e3
    props = [
        section(elasticModulus=2.0e11, area=1.0e-2),
        section(elasticModulus=1.0e11, area=3.0e-2),
        section(elasticModulus=2.1e11, area=5.0e-3),
    ]
    k = [p["elasticModulus"] * p["area"] / length for p in props]
    members = [member(f"m{i}", "a", "b", kind=kind, props=p, start_fixity="pinned" if kind == "beam" else None,
                      end_fixity="pinned" if kind == "beam" else None) for i, p in enumerate(props)]
    a_flags = PIN if kind == "brace" else FIXED
    m = build({"a": (0, 0, 0), "b": (length, 0, 0)}, members, {"a": a_flags, "b": flags("FTTFFF")}, {"b": (load, 0, 0)})
    r = require_success(solve(m), "parallel bars")
    d = load / sum(k)
    check("common displacement", disp(r, "b")[0], d)
    for i in range(3):
        check(f"member m{i} axial share", forces(r, f"m{i}")["axial"], load * k[i] / sum(k))
    check("reaction at a", reac(r, "a")[0], -load)
    check_zero("axial reaction at b", reac(r, "b")[0], load, scale_name="applied load")


def test_collinear_beams_to_separate_supports_split_reaction_by_stiffness():
    # Node n at the origin is loaded by F along +x. Beams run to supports at
    # x = -2, +3, +5 (the last two overlap in space but share only n).
    # Axial stiffness k_i = E A_i / L_i, common displacement d = F / sum(k).
    # Reaction at every support = -k_i d (opposing F); the left member is in
    # tension (+k1 d), the right ones in compression.
    load = 40.0e3
    xs = {"s1": -2.0, "s2": 3.0, "s3": 5.0}
    areas = {"s1": 1.0e-2, "s2": 2.0e-2, "s3": 1.5e-2}
    k = {s: E * areas[s] / abs(x) for s, x in xs.items()}
    nodes = {"n": (0, 0, 0)} | {s: (x, 0, 0) for s, x in xs.items()}
    members = [member(f"m_{s}", s, "n", props=section(area=areas[s])) for s in xs]
    m = build(nodes, members, {s: FIXED for s in xs}, {"n": (load, 0, 0)})
    r = require_success(solve(m), "collinear beams")
    total = sum(k.values())
    check("node displacement", disp(r, "n")[0], load / total)
    for s in xs:
        check(f"reaction at {s}", reac(r, s)[0], -load * k[s] / total)
    # Member force sign: tension positive. Left bar s1 -> n stretches; the right bars shorten.
    check("axial in left bar", forces(r, "m_s1")["axial"], load * k["s1"] / total)
    check("axial in right bar s2", forces(r, "m_s2")["axial"], -load * k["s2"] / total)
    check("axial in right bar s3", forces(r, "m_s3")["axial"], -load * k["s3"] / total)
    check("reactions sum to the load", sum(reac(r, s)[0] for s in xs), -load)


def test_parallel_cantilevers_share_tip_load_by_flexural_stiffness():
    # Two beams between the same nodes a (fixed) and b (loaded P in z), with
    # inertias I1, I2. Both members see the same tip translation d and rotation
    # theta. Tip moments sum to zero: sum EI_i(-6d/L^2 + 4 theta/L) = 0 ->
    # theta = 3d/(2L). Then member tip force P_i = EI_i(12d/L^3 - 6 theta/L^2) =
    # 3 EI_i d / L^3, so d = P L^3 / (3 sum EI) and P_i = P EI_i / sum EI.
    # Each member's tip moment is then 0, so its root moment is P_i L.
    length, load = 4.0, 12.0e3
    inertias = (1.0e-4, 3.0e-4)
    members = [member(f"m{i}", "a", "b", props=section(inertiaY=v, inertiaZ=v)) for i, v in enumerate(inertias)]
    m = build({"a": (0, 0, 0), "b": (length, 0, 0)}, members, {"a": FIXED}, {"b": (0, 0, load)})
    r = require_success(solve(m), "parallel cantilevers")
    ei_total = E * sum(inertias)
    d = load * length**3 / (3 * ei_total)
    check("tip deflection", disp(r, "b")[2], d)
    check("tip rotation 3d/(2L) about -y", disp(r, "b")[4], -3 * d / (2 * length))
    for i, v in enumerate(inertias):
        share = load * E * v / ei_total
        check(f"m{i} shear", forces(r, f"m{i}")["shear"], share)
        check(f"m{i} root moment", forces(r, f"m{i}")["momentStart"], share * length)
        check_zero(f"m{i} tip moment", forces(r, f"m{i}")["momentEnd"], load * length, scale_name="load x length")
    check("total reaction", reac(r, "a")[2], -load)


# --- shared frames carrying one load to 2, 3 and 4 supports ----------------------


def continuous_beam(support_x, load_x, load=1.0e4):
    """Beam along x on pin-roller supports at ``support_x``, one downward load at ``load_x``."""
    xs = sorted(set(support_x) | {load_x})
    ids = {x: f"n{i}" for i, x in enumerate(xs)}
    nodes = {ids[x]: (x, 0.0, 0.0) for x in xs}
    members = [member(f"m{i}", ids[xs[i]], ids[xs[i + 1]]) for i in range(len(xs) - 1)]
    supports = {}
    for k, x in enumerate(sorted(support_x)):
        supports[ids[x]] = flags("TTTTFF") if k == 0 else flags("FTTFFF")
    return build(nodes, members, supports, {ids[load_x]: (0, 0, -load)}), ids, xs


SPAN = 3.0
# name: (support x, load x, upward reaction / P at each support, {support index: |M| / (P * SPAN)})
#
# Two-span and three-span continuous beams by the three-moment theorem
#   M_{i-1} L + 2 M_i (L + L) + M_{i+1} L = -(3/8) P L^2  (midspan point load in the adjacent span;
#   6 A abar / L = 3 P L^2 / 8 for a midspan point load, either side), M_end = 0.
#   Two equal spans, P at midspan of span 1:  4 M_B L = -3PL^2/8 -> M_B = -3PL/32.
#       R_A = P/2 + M_B/L = 13P/32; R_C = -(M_B)/L... shear of unloaded span = 3P/32 -> R_C = -3P/32;
#       R_B = P - R_A - R_C = 22P/32.
#   Three equal spans, P at midspan of span 1:  4 M_B + M_C = -3PL/8, M_B + 4 M_C = 0
#       -> M_B = -PL/10, M_C = +PL/40. R_A = P/2 + M_B/L = 2P/5; span BC shear (M_C - M_B)/L = P/8;
#       span CD shear (0 - M_C)/L = -P/40 -> R_D = P/40... R_D = M_C/L = P/40,
#       R_B = P/8 + (P - R_A) = 0.725 P, R_C = -P/40 - P/8 = -0.15 P. Sum = P.
#   Three equal spans, P at midspan of the middle span: M_B = M_C, 5 M = -3PL/8 -> M_B = -3PL/40.
#       R_A = R_D = M_B/L = -3P/40 (uplift), R_B = R_C = P/2 + 3P/40 = 23P/40.
#   Simply supported, P at distance x from A on span L: R_A = P (L - x)/L.
FRAME_CASES = {
    "2_supports_symmetric": ((0.0, 6.0), 3.0, (0.5, 0.5), {}),
    "2_supports_asymmetric": ((0.0, 6.0), 1.5, (0.75, 0.25), {}),
    "3_supports_asymmetric": ((0.0, 3.0, 6.0), 1.5, (13 / 32, 22 / 32, -3 / 32), {1: 3 / 32}),
    "4_supports_asymmetric": ((0.0, 3.0, 6.0, 9.0), 1.5, (0.4, 0.725, -0.15, 0.025), {1: 1 / 10, 2: 1 / 40}),
    "4_supports_symmetric": ((0.0, 3.0, 6.0, 9.0), 4.5, (-3 / 40, 23 / 40, 23 / 40, -3 / 40), {1: 3 / 40, 2: 3 / 40}),
}


@pytest.mark.parametrize("name", list(FRAME_CASES))
def test_shared_beam_frame_reactions_follow_stiffness(name):
    supports, load_x, coefficients, moments = FRAME_CASES[name]
    load = 1.0e4
    m, ids, xs = continuous_beam(supports, load_x, load)
    r = require_success(solve(m), name)
    for k, (x, c) in enumerate(zip(supports, coefficients)):
        check(f"vertical reaction at support {k} (x={x})", reac(r, ids[x])[2], c * load, abs_tol=1e-6 * load)
        check_zero(f"transverse reaction at support {k}", reac(r, ids[x])[1], load, scale_name="applied load")
    check("sum of vertical reactions", sum(reac(r, ids[x])[2] for x in supports), load)
    # Hogging moment at each interior support: the member ending there and the one starting there.
    for k, coef in moments.items():
        i = xs.index(supports[k])
        check(f"moment at support {k}, member before", forces(r, f"m{i - 1}")["momentEnd"], coef * load * SPAN)
        check(f"moment at support {k}, member after", forces(r, f"m{i}")["momentStart"], coef * load * SPAN)


def _fan_supports(points):
    return {name: PIN for name in points}


def test_symmetric_three_support_truss_frame_center_takes_most():
    # Apex n above a vertical bar (area Av, length h) and two diagonals (area Ad,
    # to (+-a, 0, -h)). Vertical load P. By symmetry n moves only down by u:
    #   P = u (k_v + 2 k_d c^2),  k_v = E Av / h,  k_d = E Ad / Ld,  c = h / Ld, s = a / Ld.
    # Bar forces: N_v = -k_v u, N_d = -k_d u c. Reactions: vertical k_v u at the
    # center, k_d u c^2 at each diagonal foot; horizontal k_d u c s toward the center.
    h, a, load = 3.0, 4.0, 2.0e5
    ld = math.hypot(a, h)
    c, s = h / ld, a / ld
    av, ad = 2.0e-3, 1.0e-3
    kv, kd = E * av / h, E * ad / ld
    u = load / (kv + 2 * kd * c**2)
    pts = {"s0": (0, 0, -h), "sp": (a, 0, -h), "sm": (-a, 0, -h)}
    members = [
        member("v", "s0", "n", kind="brace", props=section(area=av)),
        member("dp", "sp", "n", kind="brace", props=section(area=ad)),
        member("dm", "sm", "n", kind="brace", props=section(area=ad)),
    ]
    supports = _fan_supports(pts) | {"n": flags("FTFFFF")}  # n restrained out of plane only
    m = build({"n": (0, 0, 0)} | pts, members, supports, {"n": (0, 0, -load)})
    r = require_success(solve(m), "symmetric fan")
    check("apex settlement", disp(r, "n")[2], -u)
    check_zero("apex horizontal displacement", disp(r, "n")[0], u, scale_name="settlement")
    check("axial force, vertical bar", forces(r, "v")["axial"], -kv * u)
    check("axial force, diagonal", forces(r, "dp")["axial"], -kd * u * c)
    check("reaction z, center", reac(r, "s0")[2], kv * u)
    check("reaction z, diagonal +", reac(r, "sp")[2], kd * u * c**2)
    check("reaction z, diagonal -", reac(r, "sm")[2], kd * u * c**2)
    check("reaction x, diagonal +", reac(r, "sp")[0], -kd * u * c * s)
    check("reaction x, diagonal -", reac(r, "sm")[0], kd * u * c * s)
    check("reactions sum to P", sum(reac(r, k)[2] for k in pts), load)
    assert kv > kd * c**2, "fixture check: the center bar is the stiffest load path"


def test_symmetric_four_support_truss_frame_with_two_stiffness_pairs():
    # Apex n over a rectangle of feet: (+-a,0,-h) with area A1, (0,+-b,-h) with area A2.
    # Opposite feet are equal, so n moves only down by u. With k_i c_i^2 = E A_i h^2 / L_i^3:
    #   u = P / sum(E A_i h^2 / L_i^3);  vertical reaction at foot i = (E A_i h^2 / L_i^3) u;
    #   bar force N_i = -E A_i h u / L_i^2.
    h, a, b, load = 3.0, 4.0, 3.0, 2.0e5
    a1, a2 = 1.0e-3, 3.0e-3
    l1, l2 = math.hypot(a, h), math.hypot(b, h)
    w1, w2 = E * a1 * h**2 / l1**3, E * a2 * h**2 / l2**3
    u = load / (2 * w1 + 2 * w2)
    pts = {"x+": (a, 0, -h), "x-": (-a, 0, -h), "y+": (0, b, -h), "y-": (0, -b, -h)}
    members = [member(f"b{k}", k, "n", kind="brace", props=section(area=a1 if k.startswith("x") else a2)) for k in pts]
    m = build({"n": (0, 0, 0)} | pts, members, _fan_supports(pts), {"n": (0, 0, -load)})
    r = require_success(solve(m), "four-foot fan")
    check("apex settlement", disp(r, "n")[2], -u)
    for k in pts:
        w, length, area = (w1, l1, a1) if k.startswith("x") else (w2, l2, a2)
        check(f"vertical reaction at {k}", reac(r, k)[2], w * u)
        check(f"axial force in b{k}", forces(r, f"b{k}")["axial"], -E * area * h * u / length**2)
    check("pair share ratio", reac(r, "x+")[2] / reac(r, "y+")[2], w1 / w2)
    check("reactions sum to P", sum(reac(r, k)[2] for k in pts), load)


def test_asymmetric_three_support_truss_frame():
    # Planar fan in the XZ plane with unit directions d_i from foot to apex n:
    #   bar 1 foot (0,0,-3): d1 = (0,1);  bar 2 foot (4,0,0): d2 = (-1,0);
    #   bar 3 foot (3,0,-3): d3 = (-1,1)/sqrt2.   k_i = E A_i / L_i.
    # K = [[k2 + k3/2, -k3/2], [-k3/2, k1 + k3/2]], det = k1 k2 + (k1 + k2) k3 / 2.
    # For F = (0, -P): u_x = -P k3/(2 det), u_z = -P (k2 + k3/2)/det.
    # N1 = k1 u_z, N2 = -k2 u_x, N3 = k3 (-u_x + u_z)/sqrt2 = -P k2 k3/(sqrt2 det).
    # Reaction on the structure at a foot = -N d: R1 = (0, P k1 (k2 + k3/2)/det),
    # R2 = (P k2 k3/(2 det), 0), R3 = (-P k2 k3/(2 det), +P k2 k3/(2 det)).
    load = 2.0e5
    areas = (1.0e-3, 2.0e-3, 1.5e-3)
    lengths = (3.0, 4.0, 3 * math.sqrt(2))
    k1, k2, k3 = (E * a / l for a, l in zip(areas, lengths))
    det = k1 * k2 + (k1 + k2) * k3 / 2
    feet = {"s1": (0, 0, -3), "s2": (4, 0, 0), "s3": (3, 0, -3)}
    members = [member(f"b{i + 1}", f"s{i + 1}", "n", kind="brace", props=section(area=areas[i])) for i in range(3)]
    supports = _fan_supports(feet) | {"n": flags("FTFFFF")}
    m = build({"n": (0, 0, 0)} | feet, members, supports, {"n": (0, 0, -load)})
    r = require_success(solve(m), "asymmetric fan")
    ux, uz = -load * k3 / (2 * det), -load * (k2 + k3 / 2) / det
    check("apex u_x", disp(r, "n")[0], ux)
    check("apex u_z", disp(r, "n")[2], uz)
    check("N1", forces(r, "b1")["axial"], k1 * uz)
    check("N2", forces(r, "b2")["axial"], -k2 * ux)
    check("N3", forces(r, "b3")["axial"], -load * k2 * k3 / (math.sqrt(2) * det))
    g = load * k2 * k3 / (2 * det)
    check_vec("R1", reac(r, "s1")[[0, 2]], (0.0, load * k1 * (k2 + k3 / 2) / det), abs_tol=1e-6 * load)
    check_vec("R2", reac(r, "s2")[[0, 2]], (g, 0.0), abs_tol=1e-6 * load)
    check_vec("R3", reac(r, "s3")[[0, 2]], (-g, g), abs_tol=1e-6 * load)
    check("vertical reactions sum to P", sum(reac(r, k)[2] for k in feet), load)


def test_asymmetric_two_support_truss_frame_is_stiffness_independent():
    # Two bars at right angles: d1 = (3,0,4)/5 from foot (-3,0,-4), d2 = (-4,0,3)/5 from foot (4,0,-3).
    # d1 . d2 = 0, so N_i = F . d_i whatever the stiffnesses: with F = (0,0,-P),
    # N1 = -0.8 P, N2 = -0.6 P. Reaction = -N d: R1 = P(0.48, 0, 0.64), R2 = P(-0.48, 0, 0.36).
    load = 1.0e5
    feet = {"s1": (-3, 0, -4), "s2": (4, 0, -3)}
    members = [
        member("b1", "s1", "n", kind="brace", props=section(area=1.0e-3)),
        member("b2", "s2", "n", kind="brace", props=section(area=4.0e-3)),
    ]
    m = build({"n": (0, 0, 0)} | feet, members, _fan_supports(feet) | {"n": flags("FTFFFF")}, {"n": (0, 0, -load)})
    r = require_success(solve(m), "orthogonal pair")
    check("N1", forces(r, "b1")["axial"], -0.8 * load)
    check("N2", forces(r, "b2")["axial"], -0.6 * load)
    check_vec("R1", reac(r, "s1")[[0, 2]], (0.48 * load, 0.64 * load), abs_tol=1e-6 * load)
    check_vec("R2", reac(r, "s2")[[0, 2]], (-0.48 * load, 0.36 * load), abs_tol=1e-6 * load)


# --- self weight --------------------------------------------------------------


def test_self_weight_cantilever_reaction_and_moment():
    # w = 1000 N/m on a cantilever of length L along unit t. Weight W = w L acts
    # at L/2 along -Z. Reaction force = +W z-hat. Reaction moment M_R = -(r_c x W)
    # with r_c = (L/2) t, W = (0,0,-wL): M_R = (w L^2/2)(t x z-hat).
    w, length = 1000.0, 4.0
    for t_in in ((1, 0, 0), (0, 1, 0), S7, (1, 1, 0)):
        t = unit(t_in)
        m = cantilever_model(t, length, props=section(weightPerLength=w))
        m["analysis"]["selfWeight"] = True
        r = require_success(solve(m), f"self weight {t_in}")
        weight = w * length
        check_vec("reaction force", reac(r, "a")[:3], (0.0, 0.0, weight), abs_tol=1e-6 * weight)
        check_vec("reaction moment", reac(r, "a")[3:], w * length**2 / 2 * np.cross(t, Z_AXIS), abs_tol=1e-6 * weight * length)


def test_self_weight_total_reaction_equals_total_member_weight():
    # Chain a -> b -> c -> d with different weights per length. The only support
    # is fixed at a, so Rz = sum(w_i L_i), Rx = Ry = 0 and the reaction moment is
    # -sum(r_ci x W_i) about the origin with r_ci the member midpoint.
    pts = {"a": (0, 0, 0), "b": (0, 0, 3), "c": (4, 0, 3), "d": (4, 3, 5)}
    w = {"ab": 500.0, "bc": 800.0, "cd": 300.0}
    members = [member(k, k[0], k[1], props=section(weightPerLength=w[k])) for k in w]
    m = build(pts, members, {"a": FIXED}, {}, self_weight=True)
    r = require_success(solve(m), "self weight chain")
    total, moment = 0.0, np.zeros(3)
    for k, wk in w.items():
        p0, p1 = np.array(pts[k[0]], float), np.array(pts[k[1]], float)
        weight = wk * np.linalg.norm(p1 - p0)
        total += weight
        moment += np.cross((p0 + p1) / 2, (0.0, 0.0, -weight))
    check("vertical reaction = total weight", reac(r, "a")[2], total)
    check_zero("horizontal reaction", np.linalg.norm(reac(r, "a")[:2]), total, scale_name="total weight")
    check_vec("reaction moment = -sum(r x W)", reac(r, "a")[3:], -moment, abs_tol=1e-6 * total * 5.0)


def test_self_weight_simply_supported_beam_splits_evenly():
    w, length = 700.0, 6.0
    m = build(
        {"a": (0, 0, 0), "b": (length, 0, 0)},
        [member("ab", "a", "b", props=section(weightPerLength=w))],
        {"a": flags("TTTTFF"), "b": flags("FTTFFF")},
        {},
        self_weight=True,
    )
    r = require_success(solve(m), "self weight beam")
    check("reaction a", reac(r, "a")[2], w * length / 2)
    check("reaction b", reac(r, "b")[2], w * length / 2)


def test_self_weight_off_applies_nothing():
    m = cantilever_model((1, 0, 0), 4.0, props=section(weightPerLength=1000.0))
    r = require_success(solve(m), "self weight off")
    check_zero("reaction force", np.linalg.norm(reac(r, "a")[:3]), 1000.0 * 4.0, scale_name="member weight")
    check_zero("tip deflection", np.linalg.norm(disp(r, "b")[:3]), 1.0e-3, scale_name="1 mm")


# --- 3D triangulated trusses: no false singularity from inactive rotations ------


@pytest.mark.parametrize("kind", ["brace", "beam_pinned"])
def test_pinned_tripod(kind):
    # Base circle r = 2 at 90, 210, 330 degrees, apex at height h = 3, vertical load P.
    # Leg length Lb = sqrt(r^2 + h^2). Apex joint: 3 N h/Lb = -P -> N = -P Lb/(3h) (compression).
    # Apex settles uz: bar shortening N Lb/EA = u . d with d_z = h/Lb -> uz = -P Lb^3/(3 h^2 EA).
    # Reaction at each foot = -N d: vertical P/3, horizontal P r/(3h) toward the axis.
    r_, h, load = 2.0, 3.0, 3.0e5
    lb = math.hypot(r_, h)
    feet = {}
    for i, deg in enumerate((90, 210, 330)):
        phi = math.radians(deg)
        feet[f"f{i}"] = (r_ * math.cos(phi), r_ * math.sin(phi), 0.0)
    pinned = {"start_fixity": "pinned", "end_fixity": "pinned"} if kind == "beam_pinned" else {}
    members = [member(f"l{i}", f"f{i}", "apex", kind="brace" if kind == "brace" else "beam", **pinned) for i in range(3)]
    m = build({"apex": (0, 0, h)} | feet, members, {k: PIN for k in feet}, {"apex": (0, 0, -load)})
    res = require_success(solve(m), f"tripod {kind}")
    st = res["stability"]
    assert st["stable"] and st["mechanisms"] == 0, f"tripod must have no mechanism (inactive rotations are not mechanisms): {st}"
    check("apex settlement", disp(res, "apex")[2], -load * lb**3 / (3 * h**2 * EA))
    check_zero("apex horizontal displacement", np.linalg.norm(disp(res, "apex")[:2]), load * lb**3 / (3 * h**2 * EA), scale_name="settlement")
    for i, (name, foot) in enumerate(feet.items()):
        check(f"leg l{i} axial", forces(res, f"l{i}")["axial"], -load * lb / (3 * h))
        radial = np.array(foot[:2]) / r_
        expected = np.array([*(-load * r_ / (3 * h) * radial), load / 3])
        check_vec(f"reaction at {name}", reac(res, name)[:3], expected, abs_tol=1e-6 * load)


def test_orthogonal_tripod_decouples_load_components():
    # Apex at the origin, bars to feet on +x (length 4), +y (length 3), +z (length 5), areas differ.
    # Orthogonal bars: N_i = -F_i (unit from foot to apex is -e_i); node displacement
    # u_i = F_i L_i / (E A_i). Reaction at foot i = -F_i e_i.
    forces_applied = (2.0e4, -3.0e4, 5.0e4)
    lengths, areas = (4.0, 3.0, 5.0), (1.0e-3, 2.0e-3, 3.0e-3)
    feet = {"fx": (lengths[0], 0, 0), "fy": (0, lengths[1], 0), "fz": (0, 0, lengths[2])}
    members = [member(f"b{i}", name, "o", kind="brace", props=section(area=areas[i])) for i, name in enumerate(feet)]
    m = build({"o": (0, 0, 0)} | feet, members, {k: PIN for k in feet}, {"o": forces_applied})
    r = require_success(solve(m), "orthogonal tripod")
    expected_u = [f * l / (E * a) for f, l, a in zip(forces_applied, lengths, areas)]
    check_vec("apex displacement", disp(r, "o")[:3], expected_u, abs_tol=1e-6 * max(abs(v) for v in expected_u))
    for i, (name, f) in enumerate(zip(feet, forces_applied)):
        check(f"axial force in b{i}", forces(r, f"b{i}")["axial"], -f)
        expected_r = np.zeros(3)
        expected_r[i] = -f
        check_vec(f"reaction at {name}", reac(r, name)[:3], expected_r, abs_tol=1e-6 * abs(f))


def _tetra_model(kind):
    # Equilateral base of circumradius r = 2: a = (0,2,0), b = (-sqrt3,-1,0), c = (sqrt3,-1,0);
    # apex d = (0,0,3). Six bars: three legs, three base ties. Six restraints:
    # a: UX UY UZ, b: UY UZ, c: UZ (the minimum that stops every rigid motion). Statically determinate.
    r_, h = 2.0, 3.0
    pts = {"a": (0, r_, 0), "b": (-math.sqrt(3), -1.0, 0), "c": (math.sqrt(3), -1.0, 0), "d": (0, 0, h)}
    pinned = {"start_fixity": "pinned", "end_fixity": "pinned"} if kind == "beam_pinned" else {}
    k = "brace" if kind == "brace" else "beam"
    names = [("ad", "a", "d"), ("bd", "b", "d"), ("cd", "c", "d"), ("ab", "a", "b"), ("bc", "b", "c"), ("ca", "c", "a")]
    members = [member(i, s, e, kind=k, **pinned) for i, s, e in names]
    supports = {"a": flags("TTTFFF"), "b": flags("FTTFFF"), "c": flags("FFTFFF")}
    return pts, members, supports, r_, h


@pytest.mark.parametrize("kind", ["brace", "beam_pinned"])
def test_tetrahedral_truss(kind):
    # Vertical load P at the apex. Apex joint as for the tripod: leg force N = -P Lb/(3h).
    # Each leg pushes its foot outward with horizontal H = |N| r/Lb = P r/(3h). At a base vertex the two
    # ties (sides of length r sqrt3, 60 degrees interior angle) must balance H radially inward:
    # 2 T cos30 = H -> T = H/sqrt3 = P r/(3 sqrt3 h) (tension). Feet then take only vertical P/3
    # each and no horizontal reaction.
    pts, members, supports, r_, h = _tetra_model(kind)
    load = 3.0e5
    lb = math.hypot(r_, h)
    m = build(pts, members, supports, {"d": (0, 0, -load)})
    res = require_success(solve(m), f"tetrahedron {kind}")
    st = res["stability"]
    assert st["stable"] and st["mechanisms"] == 0, f"tetrahedral truss must be mechanism-free: {st}"
    if kind == "brace":
        assert st["staticIndeterminacy"] == 0, f"6 bars, 6 restraints, 12 DOF: determinate, got {st['staticIndeterminacy']}"
    for leg in ("ad", "bd", "cd"):
        check(f"leg {leg} axial", forces(res, leg)["axial"], -load * lb / (3 * h))
    for tie in ("ab", "bc", "ca"):
        check(f"tie {tie} axial", forces(res, tie)["axial"], load * r_ / (3 * math.sqrt(3) * h))
    for foot in "abc":
        check(f"vertical reaction at {foot}", reac(res, foot)[2], load / 3)
    for foot, comps in (("a", (0, 1)), ("b", (0, 1)), ("c", (0,))):
        for ax in comps:
            check_zero(f"horizontal reaction at {foot} axis {ax}", reac(res, foot)[ax], load, scale_name="applied load")
