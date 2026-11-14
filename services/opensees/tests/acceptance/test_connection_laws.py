"""Connection-law acceptance tests (solver criteria M04, M05, section 7 row 3).

Closed-form references for moment connections, ball joints, hinges with torsion
locked, one-axis hinges, semi-rigid joints, all-elastic couplers and unattached
ends. Transmitted and released force and moment components are checked through
the member forces and reactions. Every case that the service must support is
run both axis-aligned and rotated to a skew direction ("orientation
independence"); where the contract pattern is not representable on a skew
member the service must answer ``unsupported`` and the test asserts that.

Law order is UX UY UZ RX RY RZ in member local axes (L locked, F free,
E elastic). Local axes follow the contract rule; every model here sets
``orientation`` explicitly to global +Y for members along global X, so
local y = +Y, local z = x cross y = +Z (member along +X).

Tolerances as in the other acceptance files: ``REL`` = 1e-4 relative on nonzero
values; zeros below 1e-6 x a stated characteristic scale.
"""

from __future__ import annotations

import numpy as np
import pytest
from accept_linear_models import (
    EA,
    EI,
    FIXED,
    GJ,
    PIN,
    X_AXIS,
    Y_AXIS,
    Z_AXIS,
    build,
    check,
    check_vec,
    check_zero,
    conn,
    disp,
    flags,
    forces,
    member,
    reac,
    require_success,
    section,
    solve,
    transform_model,
    unit,
)

L = 4.0


def skew_frame() -> np.ndarray:
    """Right-handed Q with Q x = t = (2,3,6)/7, Q z = n = (3,-2,0)/sqrt13, Q y = n x t."""
    t, n = unit((2, 3, 6)), unit((3, -2, 0))
    return np.column_stack([t, np.cross(n, t), n])


FRAMES = {"aligned": np.eye(3), "skew": skew_frame()}


# --- shared joint: moment connection, ball joint, hinges, unattached end -----------
#
# Members A: a(-L,0,0) -> j(0,0,0) and B: b(L,0,0) -> j, both with their root fixed to a
# FIXED support and both ends at the free joint j. Load F along +z at j. Both members are
# cantilevers of the same EI and length L meeting at j; A's end at j is always rigid.
# B's end connection to j varies:
#   fixed : j has no rotation by symmetry, each member is guided at j. Stiffness 12EI/L^3
#           per member: d = F L^3/(24 EI), V = F/2 each, M = V L/2 = F L/4 at both ends.
#   pinned: B transmits shear only. B is a propped cantilever (3EI/L^3 at its pinned end),
#           A a free-rotating cantilever (3EI/L^3): d = F L^3/(6 EI), V = F/2 each,
#           root moments V L = F L/2, zero moment at j for both.
#   free  : B transmits nothing. A carries all: d = F L^3/(3 EI), V_A = F, M_A = F L,
#           B carries no force at all and its support b has zero reaction.

# fraction table: (d coefficient of F L^3/EI, V_A/F, V_B/F, (A start, A end, B start, B end) in F L)
SHARED_EXPECTED = {
    "fixed": (1 / 24, 0.5, 0.5, (0.25, 0.25, 0.25, 0.25)),
    "pinned": (1 / 6, 0.5, 0.5, (0.5, 0.0, 0.5, 0.0)),
    "free": (1 / 3, 1.0, 0.0, (1.0, 0.0, 0.0, 0.0)),
}

# name: (kwargs for B's end at j, expected family, also valid on a skew member?)
SHARED_SPECS = {
    "fixed_shorthand": ({"end_fixity": "fixed"}, "fixed", True),
    "fixed_LLLLLL": ({"end_connection": conn("LLLLLL")}, "fixed", True),
    "ball_shorthand": ({"end_fixity": "pinned"}, "pinned", True),
    "ball_LLLFFF": ({"end_connection": conn("LLLFFF")}, "pinned", True),
    # Hinge with torsion locked: both bending rotations released.
    "hinge_torsion_locked_LLLLFF": ({"end_connection": conn("LLLLFF")}, "pinned", True),
    # Local y = +Y; B runs b->j along -X so its z = x cross y = -Z. A z-load bends B about local y.
    "hinge_about_local_y_LLLLFL": ({"end_connection": conn("LLLLFL")}, "pinned", True),
    "hinge_about_local_z_LLLLLF": ({"end_connection": conn("LLLLLF")}, "fixed", True),
    # Only the member-axis rotation released: bending is untouched by a z-load. Not an
    # in-element release pattern, so only valid where the member is axis-aligned.
    "torsion_release_only_LLLFLL": ({"end_connection": conn("LLLFLL")}, "fixed", False),
    "free_shorthand": ({"end_fixity": "free"}, "free", True),
    "free_FFFFFF": ({"end_connection": conn("FFFFFF")}, "free", True),
}


def shared_joint_model(end_kwargs: dict, Q: np.ndarray, load: float) -> dict:
    nodes = {"a": (-L, 0, 0), "j": (0, 0, 0), "b": (L, 0, 0)}
    members = [
        member("A", "a", "j", orientation=Y_AXIS),
        member("B", "b", "j", orientation=Y_AXIS, **end_kwargs),
    ]
    m = build(nodes, members, {"a": FIXED, "b": FIXED}, {"j": (0, 0, load)})
    return transform_model(m, Q)


@pytest.mark.parametrize("frame", list(FRAMES))
@pytest.mark.parametrize("spec", list(SHARED_SPECS))
def test_shared_joint_transmits_and_releases_per_law(spec, frame):
    end_kwargs, family, skew_ok = SHARED_SPECS[spec]
    if frame == "skew" and not skew_ok:
        pytest.skip("pattern is only representable on axis-aligned members (see test_unsupported_patterns_on_skew_members)")
    Q = FRAMES[frame]
    load = 2.0e4
    n = Q @ Z_AXIS
    r = require_success(solve(shared_joint_model(end_kwargs, Q, load)), f"{spec}/{frame}")
    d_coef, v_a, v_b, (a_start, a_end, b_start, b_end) = SHARED_EXPECTED[family]
    d = d_coef * load * L**3 / EI
    check_vec("joint displacement", disp(r, "j")[:3], d * n, abs_tol=1e-6 * d)
    for mid, v, (ms, me) in (("A", v_a, (a_start, a_end)), ("B", v_b, (b_start, b_end))):
        f = forces(r, mid)
        check(f"{mid} shear", f["shear"], v * load, abs_tol=1e-6 * load)
        check(f"{mid} moment at root", f["momentStart"], ms * load * L, abs_tol=1e-6 * load * L)
        check(f"{mid} moment at joint", f["momentEnd"], me * load * L, abs_tol=1e-6 * load * L)
        check_zero(f"{mid} axial", f["axial"], load, scale_name="applied load")
        check_zero(f"{mid} torsion", f["torsion"], load * L, scale_name="load x length")
    check_vec("reaction at a", reac(r, "a")[:3], -v_a * load * n, abs_tol=1e-6 * load)
    check_vec("reaction at b", reac(r, "b")[:3], -v_b * load * n, abs_tol=1e-6 * load)
    if family == "fixed":
        check_zero("joint rotation (symmetric, guided)", np.linalg.norm(disp(r, "j")[3:]), load * L**2 / EI, scale_name="P L^2/EI")


# --- one-axis hinges, ball joint and fixed at the start of a beam, pinned far end --------
#
# j(0,0,0) FIXED support, m(L/2 = 3), t(6,0,0) FIXED support. Member jm has the law under test
# at j; member mt is fixed to m and hinged at t with law L L L L F F (bending released, torsion
# locked to the fixed node, so a start law that frees RX cannot let the beam spin). Load P at m
# along Y or Z.
# Plane released at j  -> simply supported beam: d = P S^3/(48 EI), M_j = 0, M_m = P S/4, R = P/2 each.
# Plane locked at j    -> fixed-pinned beam, S = 6: d = 7 P S^3/(768 EI), M_j = 3 P S/16,
#                         M_m = 5 P S/32, R_j = 11 P/16, R_t = 5 P/16.
SPAN = 6.0

# law: (plane released for Z-load?, plane released for Y-load?, valid on skew?)
HINGE_LAWS = {
    "fixed_LLLLLL": ("LLLLLL", False, False, True),
    "ball_LLLFFF": ("LLLFFF", True, True, True),
    "hinge_torsion_locked_LLLLFF": ("LLLLFF", True, True, True),
    # rotation about local y (= +Y) permits bending in the XZ plane, i.e. displacement along Z
    "hinge_about_Y_LLLLFL": ("LLLLFL", True, False, True),
    # rotation about local z (= +Z) permits bending in the XY plane, i.e. displacement along Y
    "hinge_about_Z_LLLLLF": ("LLLLLF", False, True, True),
    # torsion-only release: both bending planes stay locked
    "torsion_release_LLLFLL": ("LLLFLL", False, False, False),
}


def hinge_beam_model(laws: str, axis: np.ndarray, load: float, Q: np.ndarray) -> dict:
    nodes = {"j": (0, 0, 0), "m": (SPAN / 2, 0, 0), "t": (SPAN, 0, 0)}
    members = [
        member("jm", "j", "m", orientation=Y_AXIS, start_connection=conn(laws)),
        # Far end: bending released, torsion locked to a fixed node (same bending physics as a
        # pin, but no rigid spin of the whole beam about its own axis when the start law frees RX).
        member("mt", "m", "t", orientation=Y_AXIS, end_connection=conn("LLLLFF")),
    ]
    m = build(nodes, members, {"j": FIXED, "t": FIXED}, {"m": tuple(load * axis)})
    return transform_model(m, Q)


@pytest.mark.parametrize("frame", list(FRAMES))
@pytest.mark.parametrize("load_axis", ["Y", "Z"])
@pytest.mark.parametrize("name", list(HINGE_LAWS))
def test_start_connection_releases_exactly_the_free_rotation(name, load_axis, frame):
    laws, rel_z, rel_y, skew_ok = HINGE_LAWS[name]
    if frame == "skew" and not skew_ok:
        pytest.skip("pattern is only representable on axis-aligned members")
    Q = FRAMES[frame]
    axis = Z_AXIS if load_axis == "Z" else Y_AXIS
    n = Q @ axis
    released = rel_z if load_axis == "Z" else rel_y
    load = 1.2e4
    r = require_success(solve(hinge_beam_model(laws, axis, load, Q)), f"{name}/{load_axis}/{frame}")
    if released:
        d, m_j, m_m, r_j, r_t = load * SPAN**3 / (48 * EI), 0.0, load * SPAN / 4, load / 2, load / 2
    else:
        d, m_j, m_m, r_j, r_t = 7 * load * SPAN**3 / (768 * EI), 3 * load * SPAN / 16, 5 * load * SPAN / 32, 11 * load / 16, 5 * load / 16
    check_vec("midspan displacement", disp(r, "m")[:3], d * n, abs_tol=1e-6 * d)
    check("moment transmitted at j", forces(r, "jm")["momentStart"], m_j, abs_tol=1e-6 * load * SPAN)
    check("moment at m (jm end)", forces(r, "jm")["momentEnd"], m_m)
    check("moment at m (mt start)", forces(r, "mt")["momentStart"], m_m)
    check_zero("moment at pinned t", forces(r, "mt")["momentEnd"], load * SPAN, scale_name="load x length")
    check("shear in jm", forces(r, "jm")["shear"], r_j)
    check("shear in mt", forces(r, "mt")["shear"], r_t)
    check_vec("reaction force at j", reac(r, "j")[:3], -r_j * n, abs_tol=1e-6 * load)
    check_vec("reaction force at t", reac(r, "t")[:3], -r_t * n, abs_tol=1e-6 * load)
    check("reaction moment at j (magnitude)", np.linalg.norm(reac(r, "j")[3:]), m_j, abs_tol=1e-6 * load * SPAN)


# --- hinge with torsion locked still carries torque --------------------------------


@pytest.mark.parametrize("laws", ["LLLLFF", "LLLLFL", "LLLLLF", "LLLLLL"])
def test_torsion_locked_connection_transmits_torque_and_no_bending(laws):
    # Beam j -> t along X; j fixed support with the law under test at the member start;
    # t restrained in UY, UZ only. Torque T about X at t. RX locked at j, so the member twists
    # phi = T L/(G J), carries torsion T, and j reacts -T about X. No bending is created.
    torque = 3.0e3
    m = build(
        {"j": (0, 0, 0), "t": (L, 0, 0)},
        [member("jt", "j", "t", orientation=Y_AXIS, start_connection=conn(laws))],
        {"j": FIXED, "t": flags("FTTFFF")},
        {"t": (0, 0, 0, torque, 0, 0)},
    )
    r = require_success(solve(m), f"torque through {laws}")
    check("tip twist T L/GJ", disp(r, "t")[3], torque * L / GJ)
    check("torsion transmitted", forces(r, "jt")["torsion"], torque)
    check("reaction torque at j", reac(r, "j")[3], -torque)
    for key in ("momentStart", "momentEnd"):
        check_zero(f"bending {key}", forces(r, "jt")[key], torque, scale_name="applied torque")
    check_zero("support force at t", np.linalg.norm(reac(r, "t")[:3]), torque / L, scale_name="T / L")


# --- moment connection and ball joint at a column/arm corner -------------------------

H, ARM, P_CORNER = 3.0, 2.0, 1.0e4


def _corner_model(arm_start: dict):
    nodes = {"c": (0, 0, 0), "j": (0, 0, H), "t": (ARM, 0, H)}
    members = [member("col", "c", "j"), member("arm", "j", "t", orientation=Y_AXIS, **arm_start)]
    return build(nodes, members, {"c": FIXED}, {"t": (0, 0, -P_CORNER)})


@pytest.mark.parametrize("arm_start", [{"start_fixity": "fixed"}, {"start_connection": conn("LLLLLL")}], ids=["shorthand", "LLLLLL"])
def test_moment_connection_carries_arm_moment_into_column(arm_start):
    # Load P down at the arm tip, arm length a, column height H, all fixed.
    # Moment transmitted at the corner = P a; the column carries it as constant bending
    # (momentStart = momentEnd = P a) plus axial compression P.
    # Corner rotation theta = P a H/EI about +y; column top moves +x by P a H^2/(2 EI);
    # arm tip drops P a^3/(3EI) (own bending) + theta a (corner rotation) + P H/EA (column shortening).
    r = require_success(solve(_corner_model(arm_start)), "corner")
    p, a = P_CORNER, ARM
    check("moment into column (top)", forces(r, "col")["momentEnd"], p * a)
    check("moment in column (base)", forces(r, "col")["momentStart"], p * a)
    check("column axial (compression)", forces(r, "col")["axial"], -p)
    check("arm moment at corner", forces(r, "arm")["momentStart"], p * a)
    check("arm shear", forces(r, "arm")["shear"], p)
    check_zero("arm moment at tip", forces(r, "arm")["momentEnd"], p * a, scale_name="load x length")
    d_z = p * a**3 / (3 * EI) + p * a**2 * H / EI + p * H / EA
    check("arm tip vertical deflection", disp(r, "t")[2], -d_z)
    check("arm tip horizontal displacement", disp(r, "t")[0], p * a * H**2 / (2 * EI))
    check("corner rotation about +y", disp(r, "j")[4], p * a * H / EI)
    check("base reaction force z", reac(r, "c")[2], p)
    check("base reaction moment about y", reac(r, "c")[4], -p * a)


@pytest.mark.parametrize("arm_start", [{"start_fixity": "pinned"}, {"start_connection": conn("LLLFFF")}], ids=["shorthand", "LLLFFF"])
def test_ball_joint_arm_transmits_force_not_moment(arm_start):
    # Same column. Arm j -> m -> t is ball-jointed to the column at j and hinged at t (law
    # L L L L F F onto a fixed support node: bending free, translations rigid), load P down at
    # midspan m (arm length a). The arm is a simply supported beam:
    # R_j = R_t = P/2, midspan moment P a/4, zero moment at both ends. The column gets only the
    # arm's vertical reaction: axial -P/2 and no bending, no sway.
    # Midspan drop = P a^3/(48 EI) + half the column shortening ((P/2) H/EA)/2 (support j settles,
    # t does not).
    a, p = ARM * 2, P_CORNER
    nodes = {"c": (0, 0, 0), "j": (0, 0, H), "m": (a / 2, 0, H), "t": (a, 0, H)}
    members = [
        member("col", "c", "j"),
        member("jm", "j", "m", orientation=Y_AXIS, **arm_start),
        member("mt", "m", "t", orientation=Y_AXIS, end_connection=conn("LLLLFF")),
    ]
    m = build(nodes, members, {"c": FIXED, "t": FIXED}, {"m": (0, 0, -p)})
    r = require_success(solve(m), "ball joint arm")
    check("column axial", forces(r, "col")["axial"], -p / 2)
    for key in ("momentStart", "momentEnd"):
        check_zero(f"column {key}", forces(r, "col")[key], p * a, scale_name="load x arm length")
    check_zero("arm moment at the ball joint", forces(r, "jm")["momentStart"], p * a, scale_name="load x arm length")
    check("arm moment at midspan", forces(r, "jm")["momentEnd"], p * a / 4)
    check("arm shear", forces(r, "jm")["shear"], p / 2)
    check("midspan drop", disp(r, "m")[2], -(p * a**3 / (48 * EI) + p * H / (4 * EA)))
    check_zero("column top sway", disp(r, "j")[0], p * a**3 / (48 * EI), scale_name="midspan deflection")
    check("reaction at t", reac(r, "t")[2], p / 2)
    check("reaction at column base", reac(r, "c")[2], p / 2)


# --- semi-rigid joint -----------------------------------------------------------------

K_ROT = (8.0e6, 2.0e7, 4.0e7)  # RX, RY, RZ spring stiffness in local axes, N m/rad


# NOTE: the builders below take CANONICAL loads (member along +X, axes X/Y/Z) and rotate the whole
# model, loads included, with transform_model(m, Q). Expected values in the tests use the rotated
# directions Q @ axis. (Round one passed the rotated vectors in, rotating the load twice.)
def _semi_rigid_model(Q, force=(0, 0, 0), moment=(0, 0, 0)):
    m = build(
        {"j": (0, 0, 0), "t": (L, 0, 0)},
        [member("jt", "j", "t", orientation=Y_AXIS, start_connection=conn("LLLEEE", (0, 0, 0, *K_ROT)))],
        {"j": FIXED},
        {"t": (*force, *moment)},
    )
    return transform_model(m, Q)


@pytest.mark.parametrize("frame", list(FRAMES))
@pytest.mark.parametrize("axis_name", ["Z", "Y"])
def test_semi_rigid_joint_bending(axis_name, frame):
    # Rigid translations, rotational spring k at the root (local y spring for a Z-load, local z
    # spring for a Y-load, since local y = Y and local z = Z). The spring carries the root moment
    # M = P L and rotates phi = P L/k; the member then rotates rigidly by phi, adding phi L to the tip.
    #   tip deflection = P L^3/(3EI) + P L^2/k;  tip rotation = P L^2/(2EI) + P L/k.
    Q = FRAMES[frame]
    axis, k = (Z_AXIS, K_ROT[1]) if axis_name == "Z" else (Y_AXIS, K_ROT[2])
    load = 1.0e4
    n, t = Q @ axis, Q @ X_AXIS
    r = require_success(solve(_semi_rigid_model(Q, force=tuple(load * axis))), f"semi-rigid {axis_name}/{frame}")
    d = load * L**3 / (3 * EI) + load * L**2 / k
    theta = load * L**2 / (2 * EI) + load * L / k
    check_vec("tip deflection", disp(r, "t")[:3], d * n, abs_tol=1e-6 * d)
    check_vec("tip rotation", disp(r, "t")[3:], theta * np.cross(t, n), abs_tol=1e-6 * theta)
    check("moment transmitted through the spring", forces(r, "jt")["momentStart"], load * L)
    check("shear", forces(r, "jt")["shear"], load)
    check_vec("reaction force", reac(r, "j")[:3], -load * n, abs_tol=1e-6 * load)
    check_vec("reaction moment", reac(r, "j")[3:], -load * L * np.cross(t, n), abs_tol=1e-6 * load * L)
    # Spring rotation: the root of the member rotates relative to the (fixed) joint by P L/k about t x n.
    assert disp(r, "t")[3:] @ np.cross(t, n) > 0, "tip rotation must follow the rotation sense t x n"


@pytest.mark.parametrize("frame", list(FRAMES))
def test_semi_rigid_joint_torsion(frame):
    # Torque T about the member axis passes through the RX spring: twist = T L/GJ + T/k_x.
    Q = FRAMES[frame]
    torque, t = 2.0e3, Q @ X_AXIS
    r = require_success(solve(_semi_rigid_model(Q, moment=tuple(torque * X_AXIS))), f"semi-rigid torsion/{frame}")
    twist = torque * L / GJ + torque / K_ROT[0]
    check_vec("tip rotation", disp(r, "t")[3:], twist * t, abs_tol=1e-6 * twist)
    check("torsion", forces(r, "jt")["torsion"], torque)
    check_vec("reaction torque", reac(r, "j")[3:], -torque * t, abs_tol=1e-6 * torque)


@pytest.mark.parametrize("frame", list(FRAMES))
def test_semi_rigid_joint_axial_load_is_rigid(frame):
    # Translations are locked (exact), so an axial load stretches only the member: F L/EA.
    Q = FRAMES[frame]
    load, t = 3.0e4, Q @ X_AXIS
    r = require_success(solve(_semi_rigid_model(Q, force=tuple(load * X_AXIS))), "semi-rigid axial")
    check_vec("tip translation", disp(r, "t")[:3], load * L / EA * t, abs_tol=1e-6 * load * L / EA)
    check("axial force", forces(r, "jt")["axial"], load)


# --- all-elastic coupler in series with the member ------------------------------------

K_ALL = (1.0e9, 5.0e7, 3.0e7, 8.0e6, 2.0e7, 4.0e7)  # UX UY UZ RX RY RZ, N/m and N m/rad


def _coupler_model(Q, force=(0, 0, 0), moment=(0, 0, 0)):
    m = build(
        {"j": (0, 0, 0), "t": (L, 0, 0)},
        [member("jt", "j", "t", orientation=Y_AXIS, start_connection=conn("EEEEEE", K_ALL))],
        {"j": FIXED},
        {"t": (*force, *moment)},
    )
    return transform_model(m, Q)


@pytest.mark.parametrize("frame", list(FRAMES))
def test_elastic_coupler_axial_series(frame):
    # Spring k_x in series with the bar: u = F/k_x + F L/EA; the spring force and member axial force are F.
    Q = FRAMES[frame]
    load, t = 2.0e4, Q @ X_AXIS
    r = require_success(solve(_coupler_model(Q, force=tuple(load * X_AXIS))), "coupler axial")
    u = load / K_ALL[0] + load * L / EA
    check_vec("tip translation", disp(r, "t")[:3], u * t, abs_tol=1e-6 * u)
    check("axial force through the coupler", forces(r, "jt")["axial"], load)
    check_vec("reaction", reac(r, "j")[:3], -load * t, abs_tol=1e-6 * load)


@pytest.mark.parametrize("frame", list(FRAMES))
@pytest.mark.parametrize("axis_name", ["Z", "Y"])
def test_elastic_coupler_transverse_series(axis_name, frame):
    # A transverse load P at the tip loads the coupler with shear P and moment P L. Springs in
    # series: translation P/k_t (k_t = UZ for a Z-load, UY for a Y-load), rotation phi = P L/k_r
    # (k_r = RY for a Z-load, RZ for a Y-load), which adds phi L to the tip.
    #   tip deflection = P L^3/(3EI) + P/k_t + P L^2/k_r;  tip rotation = P L^2/(2EI) + P L/k_r.
    Q = FRAMES[frame]
    axis, kt, kr = (Z_AXIS, K_ALL[2], K_ALL[4]) if axis_name == "Z" else (Y_AXIS, K_ALL[1], K_ALL[5])
    load = 1.0e4
    n, t = Q @ axis, Q @ X_AXIS
    r = require_success(solve(_coupler_model(Q, force=tuple(load * axis))), f"coupler {axis_name}/{frame}")
    d = load * L**3 / (3 * EI) + load / kt + load * L**2 / kr
    theta = load * L**2 / (2 * EI) + load * L / kr
    check_vec("tip deflection", disp(r, "t")[:3], d * n, abs_tol=1e-6 * d)
    check_vec("tip rotation", disp(r, "t")[3:], theta * np.cross(t, n), abs_tol=1e-6 * theta)
    check("shear through the coupler", forces(r, "jt")["shear"], load)
    check("moment through the coupler", forces(r, "jt")["momentStart"], load * L)
    check_vec("reaction moment", reac(r, "j")[3:], -load * L * np.cross(t, n), abs_tol=1e-6 * load * L)


@pytest.mark.parametrize("frame", list(FRAMES))
def test_elastic_coupler_torsion_series(frame):
    # twist = T L/GJ + T/k_rx
    Q = FRAMES[frame]
    torque, t = 2.0e3, Q @ X_AXIS
    r = require_success(solve(_coupler_model(Q, moment=tuple(torque * X_AXIS))), "coupler torsion")
    twist = torque * L / GJ + torque / K_ALL[3]
    check_vec("tip rotation", disp(r, "t")[3:], twist * t, abs_tol=1e-6 * twist)
    check("torsion", forces(r, "jt")["torsion"], torque)


# --- sliding connection ------------------------------------------------------------------


def test_slider_on_axis_aligned_member_releases_exactly_the_axial_force():
    # Start law F L L L L L (axial slide) on a member along global X. Tip restrained in UX only.
    # Transverse load P: cantilever bending is untouched, d = P L^3/(3EI), axial force 0.
    load = 1.0e4
    m = build(
        {"j": (0, 0, 0), "t": (L, 0, 0)},
        [member("jt", "j", "t", orientation=Y_AXIS, start_connection=conn("FLLLLL"))],
        {"j": FIXED, "t": flags("TFFFFF")},
        {"t": (0, 0, -load)},
    )
    r = require_success(solve(m), "slider, transverse load")
    check("tip deflection", disp(r, "t")[2], -load * L**3 / (3 * EI))
    check_zero("axial force", forces(r, "jt")["axial"], load, scale_name="applied load")
    check("root moment", forces(r, "jt")["momentStart"], load * L)
    # Axial load F at the tip: nothing goes through the member; the tip support takes it all.
    load = 5.0e3
    m = build(
        {"j": (0, 0, 0), "t": (L, 0, 0)},
        [member("jt", "j", "t", orientation=Y_AXIS, start_connection=conn("FLLLLL"))],
        {"j": FIXED, "t": flags("TFFFFF")},
        {"t": (load, 0, 0)},
    )
    r = require_success(solve(m), "slider, axial load")
    check_zero("axial force through the slider", forces(r, "jt")["axial"], load, scale_name="applied load")
    check("tip support reaction", reac(r, "t")[0], -load)
    check_zero("joint axial reaction", reac(r, "j")[0], load, scale_name="applied load")


@pytest.mark.parametrize("laws", ["FLLLLL", "FLLFFF", "FFLLLL"])
def test_unsupported_patterns_on_skew_members(laws):
    # A pattern that needs an exact lock of some global DOFs but not others cannot be built
    # exactly on a member whose local axes are not aligned with global axes. The contract says
    # such models are answered 'unsupported', with a message, never guessed.
    t = unit((2, 3, 6))
    m = build(
        {"j": (0, 0, 0), "t": tuple(L * t)},
        [member("jt", "j", "t", start_connection=conn(laws))],
        {"j": FIXED},
        {"t": (0, 0, -1.0e3)},
    )
    r = solve(m)
    assert r["status"] == "unsupported", f"{laws} on a skew member: expected 'unsupported', got {r['status']!r}"
    assert isinstance(r.get("message"), str) and r["message"].strip(), "an unsupported answer must carry a message"
    assert "displacements" not in r and "reactions" not in r


# --- unattached end -----------------------------------------------------------------------


@pytest.mark.parametrize("which", ["end_free", "start_free"])
@pytest.mark.parametrize("axis", [(1, 0, 0), (0, 1, 0), (2, 3, 6)], ids=["x", "y", "skew"])
def test_member_with_one_free_end_is_a_cantilever(axis, which):
    # Fixed end at node a (FIXED support), unattached end at b. With self-weight w along -Z the
    # member is a cantilever: reaction force w L up, reaction moment (w L^2/2)(t x z-hat)
    # (weight W = w L at the midpoint (L/2) t; M_R = -(r x W)). The unattached end transfers nothing
    # to node b, but its half of the weight is still the member's, so the total is unchanged.
    t = unit(axis)
    w, length = 900.0, 4.0
    props = section(weightPerLength=w)
    if which == "end_free":
        mem = member("m", "a", "b", props=props, end_fixity="free")
    else:
        mem = member("m", "b", "a", props=props, start_fixity="free")
    m = build({"a": (0, 0, 0), "b": tuple(length * t)}, [mem], {"a": FIXED}, {}, self_weight=True)
    r = require_success(solve(m), f"free end {which}")
    weight = w * length
    check_vec("reaction force", reac(r, "a")[:3], (0.0, 0.0, weight), abs_tol=1e-6 * weight)
    check_vec("reaction moment", reac(r, "a")[3:], w * length**2 / 2 * np.cross(t, Z_AXIS), abs_tol=1e-6 * weight * length)


def test_load_on_a_node_reaches_only_attached_member_ends():
    # Covered in detail by the shared-joint family; here a direct statement: a node loaded in z
    # whose only attached member end is rigid carries the whole load, a second member with an
    # unattached end at that node carries none and its support reacts nothing.
    load = 2.0e4
    nodes = {"a": (-L, 0, 0), "j": (0, 0, 0), "b": (L, 0, 0)}
    members = [member("A", "a", "j"), member("B", "b", "j", end_fixity="free", props=section(inertiaY=5e-4, inertiaZ=5e-4))]
    m = build(nodes, members, {"a": FIXED, "b": FIXED}, {"j": (0, 0, load)})
    r = require_success(solve(m), "free end beside a rigid one")
    check("joint deflection (A alone)", disp(r, "j")[2], load * L**3 / (3 * EI))
    check("reaction at a", reac(r, "a")[2], -load)
    check_zero("reaction at b", np.linalg.norm(reac(r, "b")), load, scale_name="applied load")
    for key in ("axial", "shear", "torsion", "momentStart", "momentEnd"):
        check_zero(f"B {key}", forces(r, "B")[key], load * L, scale_name="load x length")


# --- invalid connection input --------------------------------------------------------------


@pytest.mark.parametrize("end", ["start", "end"])
@pytest.mark.parametrize("shorthand", ["fixed", "pinned", "free"])
def test_shorthand_plus_full_connection_is_an_error(end, shorthand):
    kwargs = {f"{end}_fixity": shorthand, f"{end}_connection": conn("LLLLLL")}
    m = build(
        {"a": (0, 0, 0), "b": (L, 0, 0)},
        [member("ab", "a", "b", **kwargs)],
        {"a": FIXED},
        {"b": (0, 0, -1.0e3)},
    )
    r = solve(m)
    assert r["status"] == "error", f"{end}: both shorthand and full connection must be 'error', got {r['status']!r}"
    assert isinstance(r.get("message"), str) and r["message"].strip()


@pytest.mark.parametrize(
    "stiffness",
    [None, (0, 0, 0, 0, 0, 0), (1e7, 1e7, 1e7, 1e7, 1e7, 0.0), (1e7, 1e7, 1e7, 1e7, 1e7, -5e6)],
    ids=["missing", "all_zero", "one_zero", "negative"],
)
def test_elastic_law_without_positive_stiffness_is_an_error(stiffness):
    m = build(
        {"a": (0, 0, 0), "b": (L, 0, 0)},
        [member("ab", "a", "b", start_connection=conn("LLLEEE", stiffness))],
        {"a": FIXED},
        {"b": (0, 0, -1.0e3)},
    )
    r = solve(m)
    assert r["status"] == "error", f"elastic axis with stiffness {stiffness}: expected 'error', got {r['status']!r}"
    assert isinstance(r.get("message"), str) and r["message"].strip()


# --- axial members never transfer moment ----------------------------------------------------

BRACE_CONNECTIONS = {
    "LLLLLL": conn("LLLLLL"),
    "LLLFFF": conn("LLLFFF"),
    "LLLEEE_springs_ignored": conn("LLLEEE", (1e6, 1e6, 1e6, 1e3, 2e3, 3e3)),
    "shorthand_fixed": None,
}


@pytest.mark.parametrize("kind", ["brace", "cable"])
@pytest.mark.parametrize("name", list(BRACE_CONNECTIONS))
def test_rotational_laws_on_axial_members_are_ignored(name, kind):
    # A brace or cable carries axial force only. Whatever the rotational laws say at either end,
    # tension F elongates it by F L/EA, carries axial F and no moment or shear.
    load = 2.0e4
    spec = BRACE_CONNECTIONS[name]
    kwargs = {"start_connection": spec, "end_connection": spec} if spec is not None else {}
    m = build(
        {"a": (0, 0, 0), "b": (L, 0, 0)},
        [member("ab", "a", "b", kind=kind, **kwargs)],
        {"a": PIN, "b": flags("FTTFFF")},
        {"b": (load, 0, 0)},
    )
    r = require_success(solve(m), f"{kind} with {name}")
    check("elongation F L/EA", disp(r, "b")[0], load * L / EA)
    check("axial force", forces(r, "ab")["axial"], load)
    for key in ("shear", "torsion", "momentStart", "momentEnd"):
        check_zero(f"{kind} {key}", forces(r, "ab")[key], load * L, scale_name="load x length")
    if kind == "cable":
        assert forces(r, "ab").get("state", "active") == "active", "a taut cable must be reported active"


def test_moment_on_a_brace_only_joint_cannot_be_carried():
    # A rigid connector cannot create bending resistance in an axial-only brace: the joint has no
    # rotational stiffness, so a moment load on it has nothing to push against (unloaded
    # rotation would be an irrelevant DOF, a loaded one is a genuine rotational mechanism).
    m = build(
        {"a": (0, 0, 0), "b": (L, 0, 0)},
        [member("ab", "a", "b", kind="brace", start_connection=conn("LLLLLL"), end_connection=conn("LLLLLL"))],
        {"a": PIN, "b": flags("FTTFFF")},
        {"b": (0, 0, 0, 0, 0, 500.0)},
    )
    r = solve(m)
    assert r["status"] == "unstable", f"moment on a brace-only joint must be unstable, got {r['status']!r}"
