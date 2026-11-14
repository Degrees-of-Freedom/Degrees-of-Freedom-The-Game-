"""Engine tests: closed-form results, connection handling, components and classification.

Expected values are hand formulas for prismatic members under nodal loads,
run at linear fidelity. Euler-Bernoulli beam and truss elements reproduce
these cases to rounding, so 1e-6 relative is a loose bound, not a tuned one.
Nonlinear tests skip while the nonlinear driver is not implemented.
"""

import json
import math
import random
import time

import pytest

from dof_opensees.engine import analyze
from dof_opensees.schema import StructuralModel
from helpers import EA, EI, FIXED, GJ, P, PINNED, component, member, model, run

REL = 1e-6


def approx(value):
    return pytest.approx(value, rel=REL, abs=1e-9)


def laws(pattern: str, stiffness=None) -> dict:
    """A connection from a pattern such as ``"LLLEFF"``."""
    names = {"L": "locked", "F": "free", "E": "elastic"}
    connection = {"laws": [names[letter] for letter in pattern]}
    if stiffness is not None:
        connection["stiffness"] = list(stiffness)
    return connection


def rotate_z(point, degrees):
    angle = math.radians(degrees)
    x, y, z = point
    return (x * math.cos(angle) - y * math.sin(angle), x * math.sin(angle) + y * math.cos(angle), z)


# --- closed-form reference cases --------------------------------------------


@pytest.mark.parametrize("load", [25e3, -25e3])
def test_axial_bar(load):
    length = 3.0
    result = run({"a": (0, 0, 0), "b": (length, 0, 0)}, [("a", "b")], {"a": FIXED}, {"b": (load, 0, 0)})
    assert result["status"] == "success"
    assert result["displacements"]["b"][0] == approx(load * length / EA)
    # Tension positive, compression negative.
    assert result["memberForces"]["a-b"]["axial"] == approx(load)
    assert result["reactions"]["a"][0] == approx(-load)
    assert result["analysis"]["fidelity"] == "linear"
    assert result["components"][0]["residual"] < 1e-9


@pytest.mark.parametrize(
    "tip, load_axis, slope_axis",
    [((4.0, 0, 0), 2, 4), ((4.0, 0, 0), 1, 5), ((0, 0, 4.0), 0, 4), ((0, 4.0, 0), 2, 3)],
)
def test_cantilever_tip_load_in_any_orientation(tip, load_axis, slope_axis):
    length, load = 4.0, -10e3
    force = [0.0, 0.0, 0.0]
    force[load_axis] = load
    result = run({"a": (0, 0, 0), "b": tip}, [("a", "b")], {"a": FIXED}, {"b": tuple(force)})
    tip_displacement = result["displacements"]["b"]
    assert tip_displacement[load_axis] == approx(load * length**3 / (3 * EI))
    assert abs(tip_displacement[slope_axis]) == approx(abs(load) * length**2 / (2 * EI))
    forces = result["memberForces"]["a-b"]
    assert forces["shear"] == approx(abs(load))
    assert forces["momentStart"] == approx(abs(load) * length)
    assert forces["momentEnd"] == pytest.approx(0.0, abs=1e-6)
    assert forces["axial"] == pytest.approx(0.0, abs=1e-6)
    assert result["stability"]["staticIndeterminacy"] == 0


def test_cantilever_torsion():
    length, torque = 2.5, 800.0
    result = run({"a": (0, 0, 0), "b": (length, 0, 0)}, [("a", "b")], {"a": FIXED}, {"b": (0, 0, 0, torque, 0, 0)})
    assert result["displacements"]["b"][3] == approx(torque * length / GJ)
    assert result["memberForces"]["a-b"]["torsion"] == approx(torque)
    assert result["reactions"]["a"][3] == approx(-torque)


def test_member_properties_and_orientation_are_used():
    # Deflection along local y bends about local z (Iz), along local z about
    # local y (Iy). Orientation global Y gives y = Y, z = Z; orientation
    # global Z gives y = Z, z = -Y.
    props = {"elasticModulus": 2e11, "shearModulus": 8e10, "area": 1e-2, "inertiaY": 1e-5, "inertiaZ": 4e-5,
             "torsionConstant": 1e-5}
    length, load = 3.0, 1e3
    for orientation, axis, inertia in (([0, 1, 0], 1, 4e-5), ([0, 1, 0], 2, 1e-5), ([0, 0, 1], 1, 1e-5)):
        force = [0.0, 0.0, 0.0]
        force[axis] = load
        bar = member("a", "b", properties=props, orientation=orientation)
        result = run({"a": (0, 0, 0), "b": (length, 0, 0)}, [bar], {"a": FIXED}, {"b": tuple(force)})
        assert result["displacements"]["b"][axis] == approx(load * length**3 / (3 * 2e11 * inertia))


def tripod(kind="brace", extra_leg=False, load=(0, 0, -30e3), fixity="pinned"):
    radius, height = 2.0, 3.0
    nodes = {"top": (0, 0, height)}
    for index in range(4 if extra_leg else 3):
        angle = 2 * math.pi * index / 3 + (0.5 if index == 3 else 0.0)
        nodes[f"s{index}"] = (radius * math.cos(angle), radius * math.sin(angle), 0)
    feet = [key for key in nodes if key != "top"]
    members = [member(foot, "top", kind=kind, startFixity=fixity, endFixity=fixity) for foot in feet]
    return run(nodes, members, {foot: PINNED for foot in feet}, {"top": load}), radius, height


@pytest.mark.parametrize("kind", ["brace", "beam"])
def test_pinned_tripod_is_determinate_and_matches_statics(kind):
    # Pin-jointed beams must behave like braces: their spin about their own
    # axis is anchored, not reported, and they carry no torsion.
    result, radius, height = tripod(kind)
    leg = math.hypot(radius, height)
    load = 30e3
    assert result["status"] == "success"
    stability = result["stability"]
    assert (stability["mechanisms"], stability["staticIndeterminacy"]) == (0, 0)
    if kind == "brace":
        assert stability["freeDofs"] == 3
    for foot in ("s0", "s1", "s2"):
        forces = result["memberForces"][f"{foot}-top"]
        assert forces["axial"] == approx(-load * leg / (3 * height))
        assert forces["torsion"] == pytest.approx(0.0, abs=1e-6)
        assert result["reactions"][foot][2] == approx(load / 3)
    assert result["displacements"]["top"][2] == approx(-load * leg**3 / (3 * height**2 * EA))
    # Pin joints have no rotational degree of freedom.
    assert result["displacements"]["top"][3:] == [0.0, 0.0, 0.0]


def test_extra_leg_adds_one_degree_of_redundancy():
    result, _, _ = tripod(extra_leg=True)
    assert result["status"] == "success"
    assert result["stability"]["staticIndeterminacy"] == 1


def test_simply_supported_beam():
    # One support also holds torsion; otherwise the straight run could spin.
    span, load = 4.0, 12e3
    nodes = {"a": (0, 0, 0), "m": (span / 2, 0, 0), "b": (span, 0, 0)}
    supports = {"a": [True, True, True, True, False, False], "b": PINNED}
    result = run(nodes, [("a", "m"), ("m", "b")], supports, {"m": (0, 0, -load)})
    assert result["status"] == "success"
    assert result["stability"]["mechanisms"] == 0
    assert result["displacements"]["m"][2] == approx(-load * span**3 / (48 * EI))
    assert result["reactions"]["a"][2] == approx(load / 2)
    assert result["memberForces"]["a-m"]["momentEnd"] == approx(load * span / 4)
    # Both supports hold X: one redundant restraint.
    assert result["stability"]["staticIndeterminacy"] == 1


def test_straight_run_on_ball_supports_spins_as_a_rigid_body():
    # Rigidly joined members can spin together about the line of the
    # supports. That is a real rigid-body motion, reported even unloaded.
    nodes = {"a": (0, 0, 0), "m": (2, 0, 0), "b": (4, 0, 0)}
    for loads in ({"m": (0, 0, -1e3)}, {"m": (0, 0, 0, 500.0, 0, 0)}):
        result = run(nodes, [("a", "m"), ("m", "b")], {"a": PINNED, "b": PINNED}, loads)
        assert result["status"] == "unstable"
        part = result["components"][0]
        assert part["reasonCodes"] == ["rigid_body_mechanism"]
        assert part["stability"]["rotationalMechanisms"] == 1
        assert set(part["stability"]["unstableNodeIds"]) == {"a", "m", "b"}
        assert not part["resultsValid"] and result["displacements"] == {}


def test_propped_cantilever_with_pinned_member_end():
    # Fixed at a, member pinned onto a roller at b, load at midspan.
    span, load = 6.0, 20e3
    nodes = {"a": (0, 0, 0), "m": (span / 2, 0, 0), "b": (span, 0, 0)}
    members = [("a", "m"), ("m", "b", "fixed", "pinned")]
    roller = [False, True, True, False, False, False]
    result = run(nodes, members, {"a": FIXED, "b": roller}, {"m": (0, 0, -load)})
    assert result["status"] == "success"
    assert result["reactions"]["b"][2] == approx(5 * load / 16)
    assert result["memberForces"]["a-m"]["momentStart"] == approx(3 * load * span / 16)
    assert result["memberForces"]["m-b"]["momentEnd"] == pytest.approx(0.0, abs=1e-6)
    # In 3D the roller props the beam vertically and laterally: two redundants.
    assert result["stability"]["staticIndeterminacy"] == 2


# --- connection representations ---------------------------------------------


def test_shorthands_equal_their_full_connections():
    span, load = 6.0, 20e3
    nodes = {"a": (0, 0, 0), "m": (span / 2, 0, 0), "b": (span, 0, 0)}
    roller = [False, True, True, False, False, False]
    supports, loads = {"a": FIXED, "b": roller}, {"m": (0, 0, -load)}
    short = run(nodes, [("a", "m"), ("m", "b", "fixed", "pinned")], supports, loads)
    full = run(
        nodes,
        [member("a", "m", startConnection=laws("LLLLLL")), member("m", "b", endConnection=laws("LLLFFF"))],
        supports,
        loads,
    )
    assert full["status"] == short["status"] == "success"
    assert full["displacements"] == short["displacements"]
    assert full["memberForces"] == short["memberForces"]


def test_rotational_laws_mean_nothing_to_axial_members():
    fixed, _, _ = tripod(fixity="fixed")
    pinned, _, _ = tripod(fixity="pinned")
    assert fixed["status"] == "success"
    assert fixed["memberForces"] == pinned["memberForces"]
    assert fixed["stability"] == pinned["stability"]


@pytest.mark.parametrize("plan_angle", [0.0, 30.0])
def test_hinge_with_torsion_locked_releases_bending(plan_angle):
    # Cantilever a-m, then m-b hinged at m (torsion locked) onto a pin at b.
    # The hinged member is a two-force link along its axis, so the cantilever
    # takes the whole vertical load.
    length, load = 3.0, 5e3
    nodes = {key: rotate_z(point, plan_angle) for key, point in
             {"a": (0, 0, 0), "m": (length, 0, 0), "b": (2 * length, 0, 0)}.items()}
    members = [("a", "m"), member("m", "b", startConnection=laws("LLLLFF"))]
    result = run(nodes, members, {"a": FIXED, "b": PINNED}, {"m": (0, 0, -load)})
    assert result["status"] == "success"
    assert result["displacements"]["m"][2] == approx(-load * length**3 / (3 * EI))
    link = result["memberForces"]["m-b"]
    assert link["momentStart"] == pytest.approx(0.0, abs=1e-6) and link["shear"] == pytest.approx(0.0, abs=1e-6)
    assert result["memberForces"]["a-m"]["momentStart"] == approx(load * length)


@pytest.mark.parametrize("plan_angle", [0.0, 30.0])
def test_semi_rigid_base_adds_spring_rotation(plan_angle):
    length, load, k = 4.0, 10e3, 2e6
    nodes = {"a": (0, 0, 0), "b": rotate_z((length, 0, 0), plan_angle)}
    bar = member("a", "b", startConnection=laws("LLLEEE", [0, 0, 0, k, k, k]))
    result = run(nodes, [bar], {"a": FIXED}, {"b": (0, 0, -load)})
    assert result["status"] == "success"
    expected = load * length**3 / (3 * EI) + load * length**2 / k
    assert result["displacements"]["b"][2] == approx(-expected)
    assert result["memberForces"]["a-b"]["momentStart"] == approx(load * length)
    # The springs are real: base moment is reacted by the support.
    assert math.hypot(*result["reactions"]["a"][3:]) == approx(load * length)


def test_elastic_coupler_adds_translational_and_rotational_flexibility():
    length, load, kt, kr = 4.0, 10e3, 5e7, 2e6
    bar = member("a", "b", startConnection=laws("EEEEEE", [kt, kt, kt, kr, kr, kr]))
    result = run({"a": (0, 0, 0), "b": (length, 0, 0)}, [bar], {"a": FIXED}, {"b": (0, 0, -load)})
    assert result["status"] == "success"
    expected = load * length**3 / (3 * EI) + load * length**2 / kr + load / kt
    assert result["displacements"]["b"][2] == approx(-expected)


def test_slider_on_a_global_axis_releases_axial_force():
    # a-m slides along X at a; all axial load goes into m-b.
    load = 30e3
    nodes = {"a": (0, 0, 0), "m": (2, 0, 0), "b": (5, 0, 0)}
    members = [member("a", "m", startConnection=laws("FLLLLL")), ("m", "b")]
    result = run(nodes, members, {"a": FIXED, "b": FIXED}, {"m": (load, 0, 0)})
    assert result["status"] == "success"
    assert result["memberForces"]["a-m"]["axial"] == pytest.approx(0.0, abs=1e-6)
    assert result["memberForces"]["m-b"]["axial"] == approx(-load)
    assert result["displacements"]["m"][0] == approx(load * 3 / EA)
    assert result["warnings"] == []


def test_slider_warns_under_nonlinear_fidelity():
    nodes = {"a": (0, 0, 0), "m": (2, 0, 0), "b": (5, 0, 0)}
    members = [member("a", "m", startConnection=laws("FLLLLL")), ("m", "b")]
    result = run(nodes, members, {"a": FIXED, "b": FIXED}, {"m": (1e3, 0, 0)}, analysis={"fidelity": "nonlinear"})
    assert any("global axes" in warning for warning in result["warnings"])


@pytest.mark.parametrize(
    "fields, fragment",
    [
        ({"startConnection": laws("FLLLLL")}, "local axes are global axes"),
        ({"startConnection": laws("LLLFLL")}, "local axes are global axes"),
        ({"initialStrain": 1e-4}, "initialStrain on a beam"),
    ],
)
def test_unrepresentable_requests_are_unsupported(fields, fragment):
    nodes = {"a": (0, 0, 0), "b": rotate_z((3, 0, 0), 30.0)}
    result = run(nodes, [member("a", "b", **fields)], {"a": FIXED, "b": FIXED})
    assert result["status"] == "unsupported"
    assert fragment in result["message"] and "'a-b'" in result["message"]


def test_unattached_end_connects_nothing():
    # The member end at b is free: b is not joined to the cantilever, so the
    # load at b has nothing holding it, and the cantilever stays unloaded.
    nodes = {"a": (0, 0, 0), "b": (3, 0, 0)}
    result = run(nodes, [member("a", "b", endFixity="free")], {"a": FIXED}, {"b": (0, 0, -1e3)})
    assert result["status"] == "unstable"
    assert [part["id"] for part in result["components"]] == ["a", "b"]
    cantilever, loose = result["components"]
    assert cantilever["state"] == "stable" and cantilever["nodeIds"] == ["a"]
    assert loose["reasonCodes"] == ["unsupported_component"] and loose["memberIds"] == []
    assert result["memberForces"]["a-b"]["shear"] == pytest.approx(0.0, abs=1e-9)
    assert "b" not in result["displacements"]


def test_coincident_nodes_are_not_connected():
    nodes = {"a": (0, 0, 0), "b": (3, 0, 0), "b2": (3, 0, 0), "c": (6, 0, 0)}
    result = run(nodes, [("a", "b"), ("b2", "c")], {"a": FIXED, "c": FIXED}, {"b": (0, 0, -1e3)})
    assert result["status"] == "success"
    assert len(result["components"]) == 2
    assert result["memberForces"]["b2-c"]["shear"] == pytest.approx(0.0, abs=1e-9)


# --- twist anchoring and relevant degrees of freedom -------------------------


@pytest.mark.parametrize("axis", [0, 2])
def test_ball_ball_beam_is_stable_and_carries_no_torsion(axis):
    # A beam with ball joints at both ends could spin about its own axis. The
    # spin is anchored, so it is stable with no mechanism, and b, free only
    # along the member, makes it an axial tie.
    end = [0.0, 0.0, 0.0]
    end[axis] = 4.0
    load = [0.0, 0.0, 0.0]
    load[axis] = 3e3
    restrained = [index != axis for index in range(3)] + [False, False, False]
    result = run({"a": (0, 0, 0), "b": tuple(end)}, [("a", "b", "pinned", "pinned")],
                 {"a": PINNED, "b": restrained}, {"b": tuple(load)})
    assert result["status"] == "success"
    stability = result["stability"]
    assert stability["mechanisms"] == 0 and stability["stable"]
    assert stability["staticIndeterminacy"] == 0
    forces = result["memberForces"]["a-b"]
    assert forces["torsion"] == pytest.approx(0.0, abs=1e-9)
    assert forces["axial"] == approx(3e3)
    assert result["displacements"]["b"][axis] == approx(3e3 * 4.0 / EA)


def test_moment_on_a_pin_joint_keeps_its_rotations_as_a_mechanism():
    result, _, _ = tripod(load=(0, 0, -1e3, 0, 50.0, 0))
    assert result["status"] == "unstable"
    stability = result["stability"]
    assert stability["translationalMechanisms"] == 0
    assert stability["rotationalMechanisms"] == 3
    assert stability["unstableNodeIds"] == ["top"]
    assert result["components"][0]["reasonCodes"] == ["internal_mechanism"]


def test_partly_held_joint_rotation_on_global_axes_is_removed():
    # At b only the hinged member's torsion (about global X) holds the joint
    # rotation; rotations about Y and Z are removed instead of reported.
    nodes = {"a": (0, 0, 0), "b": (3, 0, 0), "c": (3, 0, -3)}
    members = [member("a", "b", endConnection=laws("LLLLFF")), member("c", "b", kind="brace")]
    result = run(nodes, members, {"a": FIXED, "c": PINNED}, {"b": (1e3, 0, -1e3)})
    assert result["status"] == "success"
    assert result["stability"]["mechanisms"] == 0
    assert result["displacements"]["b"][4:] == [0.0, 0.0]


def test_skew_joint_rotation_held_by_one_hinge_is_freed_exactly():
    # Same as above but skew: the single hinge transmits no moment, so it is
    # treated as a ball joint, and results equal the ball-joint model.
    nodes = {"a": (0, 0, 0), "b": rotate_z((3, 0, 0), 30.0), "c": rotate_z((3, 0, -3), 30.0)}
    loads = {"b": (1e3, 0, -1e3)}
    hinge = run(nodes, [member("a", "b", endConnection=laws("LLLLFF")), member("c", "b", kind="brace")],
                {"a": FIXED, "c": PINNED}, loads)
    ball = run(nodes, [member("a", "b", endFixity="pinned"), member("c", "b", kind="brace")],
               {"a": FIXED, "c": PINNED}, loads)
    assert hinge["status"] == ball["status"] == "success"
    assert hinge["displacements"]["b"] == pytest.approx(ball["displacements"]["b"], rel=1e-9, abs=1e-15)


# --- mechanisms and reason codes --------------------------------------------


def test_two_pinned_bars_fold_out_of_plane_as_a_rigid_body():
    nodes = {"l": (-2, 0, 0), "r": (2, 0, 0), "top": (0, 0, 3)}
    members = [member("l", "top", kind="brace"), member("r", "top", kind="brace")]
    result = run(nodes, members, {"l": PINNED, "r": PINNED}, {"top": (0, 0, -1e3)})
    assert result["status"] == "unstable"
    part = result["components"][0]
    # The whole triangle swings about the line through its supports.
    assert part["reasonCodes"] == ["rigid_body_mechanism"]
    stability = part["stability"]
    assert (stability["freeDofs"], stability["mechanisms"], stability["staticIndeterminacy"]) == (3, 1, 0)
    assert stability["unstableNodeIds"] == ["top"]
    shape = stability["modes"][0]["displacements"]["top"]
    assert abs(shape[1]) == approx(1.0) and abs(shape[0]) < 1e-9 and abs(shape[2]) < 1e-9
    assert result["displacements"] == {} and result["memberForces"] == {}


def portal(fixity, brace=False):
    nodes = {"a": (0, 0, 0), "b": (4, 0, 0), "c": (0, 0, 3), "d": (4, 0, 3)}
    members = [("a", "c", fixity, fixity), ("b", "d", fixity, fixity), ("c", "d", fixity, fixity)]
    if brace:
        members.append(member("a", "d", kind="brace"))
    in_plane = [False, True, False, False, False, False]
    supports = {"a": PINNED, "b": PINNED, "c": in_plane, "d": in_plane}
    return run(nodes, members, supports, {"c": (5e3, 0, 0)})


def test_pinned_portal_sways_until_braced():
    racking = portal("pinned")
    assert racking["status"] == "unstable"
    part = racking["components"][0]
    assert part["reasonCodes"] == ["internal_mechanism"]
    assert part["stability"]["translationalMechanisms"] == 1
    assert part["stability"]["rotationalMechanisms"] == 0
    assert set(part["stability"]["unstableNodeIds"]) == {"c", "d"}
    shape = part["stability"]["modes"][0]["displacements"]
    assert shape["c"][0] == pytest.approx(shape["d"][0])

    braced = portal("pinned", brace=True)
    assert braced["status"] == "success"
    assert braced["stability"]["staticIndeterminacy"] == 0
    assert braced["memberForces"]["a-d"]["axial"] > 0


def test_rigid_portal_resists_sway_without_a_brace():
    result = portal("fixed")
    assert result["status"] == "success"
    assert result["stability"]["translationalMechanisms"] == 0
    assert result["memberForces"]["a-c"]["momentEnd"] > 0


def test_beam_on_one_ball_support_is_a_rigid_body_mechanism():
    result = run({"a": (0, 0, 0), "b": (3, 0, 0)}, [("a", "b")], {"a": PINNED})
    assert result["status"] == "unstable"
    assert result["components"][0]["reasonCodes"] == ["rigid_body_mechanism"]
    assert result["components"][0]["stability"]["mechanisms"] == 3


def test_unsupported_structure_has_six_rigid_body_mechanisms():
    result = run({"a": (0, 0, 0), "b": (2, 0, 0), "c": (0, 2, 0)}, [("a", "b"), ("b", "c"), ("c", "a")])
    assert result["status"] == "unstable"
    part = result["components"][0]
    assert part["reasonCodes"] == ["unsupported_component"]
    assert part["stability"]["mechanisms"] == 6


def test_unloaded_mechanism_is_never_stable():
    result = portal("pinned")
    unloaded = run({"a": (0, 0, 0), "b": (4, 0, 0), "c": (0, 0, 3), "d": (4, 0, 3)},
                   [("a", "c", "pinned", "pinned"), ("b", "d", "pinned", "pinned"), ("c", "d", "pinned", "pinned")],
                   {"a": PINNED, "b": PINNED, "c": [False, True, False, False, False, False],
                    "d": [False, True, False, False, False, False]})
    assert result["status"] == unloaded["status"] == "unstable"


# --- components ---------------------------------------------------------------


def test_stable_component_keeps_valid_results_beside_an_unstable_one():
    nodes = {"a": (0, 0, 0), "b": (2, 0, 0), "loose": (5, 5, 5), "p": (9, 0, 0), "q": (9, 0, 3)}
    members = [("a", "b"), member("p", "q", kind="brace")]
    result = run(nodes, members, {"a": FIXED, "p": PINNED}, {"b": (0, 0, -1e3), "loose": (0, 0, -1.0)})
    assert result["status"] == "unstable"
    assert [part["id"] for part in result["components"]] == ["a", "loose", "p"]
    good = component(result, "a")
    assert good["state"] == "stable" and good["resultsValid"]
    assert good["nodeIds"] == ["a", "b"] and good["memberIds"] == ["a-b"]
    loose = component(result, "loose")
    assert loose["state"] == "unstable" and not loose["resultsValid"]
    assert loose["reasonCodes"] == ["unsupported_component"]
    assert loose["stability"]["translationalMechanisms"] == 3
    hanging = component(result, "p")
    assert hanging["reasonCodes"] == ["rigid_body_mechanism"]
    # Results exist for the valid component only; nothing is zero-filled.
    assert set(result["displacements"]) == {"a", "b"}
    assert set(result["memberForces"]) == {"a-b"}
    assert set(result["reactions"]) == {"a"}
    assert result["displacements"]["b"][2] < 0
    assert result["stability"]["mechanisms"] == 3 + 2
    assert set(result["analysis"]["reasonCodes"]) == {"unsupported_component", "rigid_body_mechanism"}
    assert "3 component(s)" in result["message"]


def test_nodes_with_nothing_attached_are_left_out_with_a_warning():
    nodes = {"a": (0, 0, 0), "b": (2, 0, 0), "spare": (9, 9, 9)}
    result = run(nodes, [("a", "b")], {"a": FIXED}, {"b": (0, 0, -1e3)})
    assert result["status"] == "success"
    assert "spare" not in result["displacements"]
    assert all("spare" not in part["nodeIds"] for part in result["components"])
    assert any("left out" in warning and "'spare'" in warning for warning in result["warnings"])


def test_member_attached_to_nothing_is_its_own_unsupported_component():
    bar = member("a", "b", startFixity="free", endFixity="free")
    result = run({"a": (0, 0, 0), "b": (2, 0, 0)}, [bar])
    assert result["status"] == "unstable"
    part = result["components"][0]
    assert part["id"] == "member:a-b" and part["nodeIds"] == [] and part["memberIds"] == ["a-b"]
    assert part["reasonCodes"] == ["unsupported_component"]


def test_fully_restrained_model_reacts_its_own_loads():
    result = run({"a": (0, 0, 0), "b": (2, 0, 0)}, [("a", "b")], {"a": FIXED, "b": FIXED}, {"b": (0, 0, -7e3)})
    assert result["status"] == "success"
    assert result["reactions"]["b"][2] == approx(7e3)
    assert result["stability"]["freeDofs"] == 0
    assert result["stability"]["staticIndeterminacy"] == 6


def test_pretensioned_brace_between_fixed_supports():
    strain = 1e-4
    bar = member("a", "b", kind="brace", initialStrain=strain)
    result = run({"a": (0, 0, 0), "b": (2, 0, 0)}, [bar], {"a": FIXED, "b": FIXED})
    assert result["status"] == "success"
    assert result["memberForces"]["a-b"]["axial"] == approx(EA * strain)
    assert result["reactions"]["a"][0] == approx(-EA * strain)
    assert result["reactions"]["b"][0] == approx(EA * strain)


def test_empty_model_succeeds():
    result = run({}, [])
    assert result["status"] == "success" and result["displacements"] == {} and result["components"] == []


# --- cables -------------------------------------------------------------------


def cable_pair(load, strain=0.0):
    nodes = {"a": (0, 0, 0), "c": (1, 0, 0), "b": (2, 0, 0)}
    members = [member("a", "c", kind="cable", initialStrain=strain), member("c", "b", kind="cable", initialStrain=strain)]
    supports = {"a": FIXED, "b": FIXED, "c": [False, True, True, False, False, False]}
    return run(nodes, members, supports, {"c": (load, 0, 0)})


def test_cable_goes_slack_rather_than_compress():
    load = 5e3
    result = cable_pair(load)
    assert result["status"] == "success"
    part = result["components"][0]
    assert part["state"] == "stable" and part["reasonCodes"] == ["cable_slack"]
    slack = result["memberForces"]["c-b"]
    assert slack["axial"] == 0.0 and slack["state"] == "slack"
    assert result["memberForces"]["a-c"]["state"] == "active"
    assert result["memberForces"]["a-c"]["axial"] == approx(load)
    assert result["displacements"]["c"][0] == approx(load / EA)


def test_pretensioned_cables_share_load_while_taut():
    strain, load = 1e-3, 1e5
    result = cable_pair(load, strain)
    assert result["status"] == "success" and result["components"][0]["reasonCodes"] == []
    assert result["memberForces"]["a-c"]["axial"] == approx(EA * strain + load / 2)
    assert result["memberForces"]["c-b"]["axial"] == approx(EA * strain - load / 2)


def test_pushed_cable_is_never_reported_stable():
    nodes = {"a": (0, 0, 0), "c": (1, 0, 0)}
    supports = {"a": FIXED, "c": [False, True, True, False, False, False]}
    result = run(nodes, [member("a", "c", kind="cable")], supports, {"c": (-1e3, 0, 0)})
    assert result["status"] in ("unstable", "unresolved")
    assert not result["components"][0]["resultsValid"]
    assert result["displacements"] == {} and result["memberForces"] == {}


# --- self-weight -------------------------------------------------------------


def test_self_weight_totals_balance_the_reactions():
    custom = {"elasticModulus": 2e11, "shearModulus": 8e10, "area": 1e-2, "inertiaY": 1e-5, "inertiaZ": 1e-5,
              "torsionConstant": 1e-5, "weightPerLength": 800.0}
    nodes = {"a": (0, 0, 0), "b": (0, 0, 3), "c": (4, 0, 3), "d": (4, 0, 0), "e": (6, 0, 3)}
    members = [("a", "b"), member("b", "c", properties=custom), ("d", "c"),
               member("c", "e", endFixity="free")]  # unattached tip still carries its weight
    result = run(nodes, members, {"a": FIXED, "d": FIXED}, analysis={"fidelity": "linear", "selfWeight": True})
    assert result["status"] == "success"
    total = P.weight_per_length * (3 + 3 + 2) + 800.0 * 4
    assert sum(result["reactions"][key][2] for key in ("a", "d")) == approx(total)
    assert result["memberForces"]["c-e"]["momentStart"] == approx(P.weight_per_length * 2 * 2 / 2)


def test_self_weight_is_off_by_default_and_missing_weight_warns():
    custom = {"elasticModulus": 2e11, "shearModulus": 8e10, "area": 1e-2, "inertiaY": 1e-5, "inertiaZ": 1e-5,
              "torsionConstant": 1e-5}
    nodes = {"a": (0, 0, 0), "b": (2, 0, 0)}
    off = run(nodes, [member("a", "b", properties=custom)], {"a": FIXED})
    assert off["status"] == "success" and off["reactions"]["a"] == [0.0] * 6
    on = run(nodes, [member("a", "b", properties=custom)], {"a": FIXED},
             analysis={"fidelity": "linear", "selfWeight": True})
    assert any("weightPerLength" in warning for warning in on["warnings"])
    assert on["reactions"]["a"] == [0.0] * 6


# --- status, verification and time budget -----------------------------------


def test_status_aggregation():
    stable = run({"a": (0, 0, 0), "b": (2, 0, 0)}, [("a", "b")], {"a": FIXED}, {"b": (0, 0, -1e3)})
    assert stable["status"] == "success" and "message" not in stable
    assert stable["analysis"]["solver"].startswith("OpenSees ") and "dof-opensees" in stable["analysis"]["solver"]
    timed_out = run({"a": (0, 0, 0), "b": (2, 0, 0)}, [("a", "b")], {"a": FIXED}, {"b": (0, 0, -1e3)},
                    analysis={"fidelity": "linear", "timeoutMs": 1e-6})
    assert timed_out["status"] == "unresolved" and "unknown" in timed_out["message"]
    unstable = run({"a": (0, 0, 0), "b": (2, 0, 0), "loose": (5, 0, 0)}, [("a", "b")], {"a": FIXED},
                   {"loose": (1, 0, 0)})
    assert unstable["status"] == "unstable" and "1 stable, 1 unstable" in unstable["message"]


def test_timeout_makes_components_unknown_without_results():
    nodes, members, supports, loads = grid_frame(3)
    result = run(nodes, members, supports, loads, analysis={"fidelity": "linear", "timeoutMs": 1e-6})
    assert result["status"] == "unresolved"
    part = result["components"][0]
    assert part["state"] == "unknown" and part["reasonCodes"] == ["timeout"] and not part["resultsValid"]
    assert part["loadFactor"] == 0.0
    # The reference classification never ran: no mechanism count, so 0, and not stable.
    assert part["stability"]["staticIndeterminacy"] == 0 and not part["stability"]["stable"]
    assert result["displacements"] == {} and result["reactions"] == {}


def test_excessive_deformation_is_marginal():
    result = run({"a": (0, 0, 0), "b": (4, 0, 0)}, [("a", "b")], {"a": FIXED}, {"b": (0, 0, -10e3)},
                 analysis={"fidelity": "linear", "displacementLimit": 1e-3})
    assert result["status"] == "success"
    part = result["components"][0]
    assert part["state"] == "marginal" and part["reasonCodes"] == ["excessive_deformation"] and part["resultsValid"]


def test_model_version_is_echoed():
    body = model({"a": (0, 0, 0)}, [], {"a": FIXED}, analysis={"fidelity": "linear"})
    result = analyze(StructuralModel.model_validate({**body, "version": "rev-7"}))
    assert result["analysis"]["modelVersion"] == "rev-7"


@pytest.mark.parametrize(
    "nodes, members, supports, loads, fragment",
    [
        ({"a": (0, 0, 0)}, [("a", "missing")], None, None, "unknown node 'missing'"),
        ({"a": (0, 0, 0)}, [], {"ghost": FIXED}, None, "unknown node 'ghost'"),
        ({"a": (0, 0, 0)}, [], None, {"ghost": (1, 0, 0)}, "unknown node 'ghost'"),
        ({"a": (0, 0, 0), "b": (0, 0, 0)}, [("a", "b")], None, None, "zero length"),
        ({"a": (0, 0, 0), "b": (1, 0, 0)}, [("a", "b"), ("a", "b")], None, None, "Duplicate member id"),
        ({"a": (0, 0, 0), "b": (1, 0, 0)}, [member("a", "b", startFixity="fixed", startConnection=laws("LLLLLL"))],
         None, None, "both startFixity and startConnection"),
        ({"a": (0, 0, 0), "b": (1, 0, 0)}, [member("a", "b", endConnection=laws("LLLEFF"))], None, None,
         "no positive stiffness"),
        ({"a": (0, 0, 0), "b": (1, 0, 0)}, [member("a", "b", orientation=[2, 0, 0])], None, None,
         "orientation parallel"),
    ],
)
def test_invalid_models_return_an_error(nodes, members, supports, loads, fragment):
    result = run(nodes, members, supports, loads)
    assert result["status"] == "error" and fragment in result["message"]


def test_two_supports_on_one_node_is_an_error():
    body = model({"a": (0, 0, 0)}, [], {"a": FIXED})
    body["supports"].append({"nodeId": "a", "restrained": PINNED})
    result = analyze(StructuralModel.model_validate(body))
    assert result["status"] == "error" and "more than one support" in result["message"]


# --- global checks ----------------------------------------------------------


def grid_frame(size, fixity="fixed"):
    """A cubic lattice of ``size`` nodes per side, 2 m spacing, fixed at the base."""
    spacing = 2.0
    nodes, members, supports, loads = {}, [], {}, {}
    for i in range(size):
        for j in range(size):
            for k in range(size):
                key = f"{i}.{j}.{k}"
                nodes[key] = (i * spacing, j * spacing, k * spacing)
                if k == 0:
                    supports[key] = FIXED
                if k == size - 1:
                    loads[key] = (300.0 * (i + 1), -200.0 * (j + 1), -5e3)
                for di, dj, dk in ((1, 0, 0), (0, 1, 0), (0, 0, 1)):
                    if i + di < size and j + dj < size and k + dk < size:
                        members.append((key, f"{i + di}.{j + dj}.{k + dk}", fixity, fixity))
    return nodes, members, supports, loads


def test_reactions_balance_applied_loads():
    nodes, members, supports, loads = grid_frame(3)
    result = run(nodes, members, supports, loads)
    assert result["status"] == "success"
    scale = sum(abs(component) for load in loads.values() for component in load)

    def resultant(vectors):
        force = [0.0] * 3
        moment = [0.0] * 3
        for key, vector in vectors.items():
            x, y, z = nodes[key]
            fx, fy, fz, *couple = list(vector) + [0.0] * (6 - len(vector))
            force = [a + b for a, b in zip(force, (fx, fy, fz))]
            arm = (y * fz - z * fy, z * fx - x * fz, x * fy - y * fx)
            moment = [a + b + c for a, b, c in zip(moment, arm, couple)]
        return force + moment

    for applied, reacted in zip(resultant(loads), resultant(result["reactions"])):
        assert applied + reacted == pytest.approx(0.0, abs=1e-6 * scale)
    assert result["components"][0]["residual"] < 1e-9


def test_unbraced_pinned_lattice_reports_its_mechanisms():
    nodes, members, supports, loads = grid_frame(3, fixity="pinned")
    result = run(nodes, members, supports, loads)
    assert result["status"] == "unstable"
    assert result["stability"]["translationalMechanisms"] > 0
    assert result["components"][0]["reasonCodes"] == ["internal_mechanism"]


def test_game_scale_model_is_fast():
    # 512 nodes, 1344 members, 2688 free DOFs. The bound is deliberately loose
    # so the test only catches order-of-magnitude regressions.
    nodes, members, supports, loads = grid_frame(8)
    started = time.perf_counter()
    result = run(nodes, members, supports, loads, analysis={"fidelity": "linear", "timeoutMs": 60000})
    elapsed = time.perf_counter() - started
    print(f"\n8x8x8 rigid lattice: {result['stability']['freeDofs']} DOFs in {elapsed:.2f} s")
    assert result["status"] == "success"
    assert elapsed < 30.0


# --- robustness ---------------------------------------------------------------


def random_model(rng: random.Random) -> dict:
    letters = "LFE"
    nodes = {f"n{i}": (rng.randint(0, 2) * 2.0, rng.randint(0, 2) * 2.0, rng.randint(0, 2) * 2.0) for i in range(6)}
    ids = list(nodes)
    members = []
    for index in range(rng.randint(0, 7)):
        start, end = rng.sample(ids, 2)
        item = {"id": f"m{index}", "startNodeId": start, "endNodeId": end,
                "kind": rng.choice(["beam", "beam", "brace", "cable"])}
        for which in ("start", "end"):
            choice = rng.random()
            if choice < 0.5:
                item[f"{which}Fixity"] = rng.choice(["fixed", "pinned", "free"])
            elif choice < 0.8:
                pattern = "".join(rng.choice(letters) for _ in range(6))
                item[f"{which}Connection"] = laws(pattern, [rng.choice([1e3, 1e6, 1e9])] * 6)
        if item["kind"] != "beam" and rng.random() < 0.3:
            item["initialStrain"] = rng.choice([-1e-3, 1e-4, 1e-3])
        if rng.random() < 0.2:
            item["orientation"] = [rng.uniform(-1, 1) for _ in range(3)]
        members.append(item)
    supports = {key: [rng.random() < 0.6 for _ in range(6)] for key in rng.sample(ids, rng.randint(0, 3))}
    loads = {key: tuple(rng.choice([0.0, 1e3, -5e3]) for _ in range(6)) for key in rng.sample(ids, rng.randint(0, 3))}
    analysis = {"fidelity": rng.choice(["linear", "nonlinear"]), "selfWeight": rng.random() < 0.3}
    return model(nodes, members, supports, loads, analysis)


def test_random_models_never_raise():
    rng = random.Random(20261114)
    statuses = set()
    for _ in range(150):
        body = random_model(rng)
        try:
            parsed = StructuralModel.model_validate(body)
        except Exception:  # noqa: BLE001 - only schema-valid input is in scope
            continue
        result = analyze(parsed)
        statuses.add(result["status"])
        assert result["status"] in ("success", "unstable", "unresolved", "unsupported", "error")
        # JSON-ready and free of NaN or infinity.
        json.dumps(result, allow_nan=False)
        if result["status"] in ("success", "unstable", "unresolved"):
            valid = {node for part in result["components"] if part["resultsValid"] for node in part["nodeIds"]}
            assert set(result["displacements"]) == valid
            assert all(part["stability"]["staticIndeterminacy"] >= 0 for part in result["components"])
    assert len(statuses) >= 3


# --- nonlinear fidelity (skips until the driver exists) ---------------------


NONLINEAR = {"fidelity": "nonlinear", "timeoutMs": 20000}


def run_nonlinear(*args, **kwargs) -> dict:
    result = run(*args, analysis=NONLINEAR, **kwargs)
    if any("NotImplementedError" in warning for warning in result.get("warnings", [])):
        pytest.skip("nonlinear.solve is not implemented yet")
    return result


def test_nonlinear_small_load_matches_linear():
    args = ({"a": (0, 0, 0), "b": (4, 0, 0)}, [("a", "b")], {"a": FIXED}, {"b": (0, 0, -100.0)})
    result = run_nonlinear(*args)
    assert result["status"] == "success"
    assert result["analysis"]["fidelity"] == "nonlinear"
    assert result["displacements"]["b"][2] == pytest.approx(-100.0 * 64 / (3 * EI), rel=1e-3)
    assert result["components"][0]["residual"] <= 1e-5


def test_nonlinear_column_buckles_near_the_euler_load():
    length = 4.0
    critical = math.pi**2 * EI / (4 * length**2)  # cantilever column
    result = run_nonlinear({"a": (0, 0, 0), "b": (0, 0, length)}, [("a", "b")], {"a": FIXED},
                           {"b": (0, 0, -2 * critical)})
    assert result["status"] == "unstable"
    part = result["components"][0]
    assert part["reasonCodes"] == ["load_induced_instability"]
    assert part["loadFactor"] == pytest.approx(0.5, rel=0.03)
    assert part["stability"]["modes"]


def test_nonlinear_cable_stiffens_under_transverse_load():
    nodes = {"a": (0, 0, 0), "c": (2, 0, 0), "b": (4, 0, 0)}
    members = [member("a", "c", kind="cable"), member("c", "b", kind="cable")]
    result = run_nonlinear(nodes, members, {"a": FIXED, "b": FIXED}, {"c": (0, 0, -1e4)})
    assert result["status"] == "success"
    part = result["components"][0]
    assert "geometrically_stiffened" in part["reasonCodes"]
    sag = -result["displacements"]["c"][2]
    assert sag == pytest.approx(2.0 * (1e4 / EA) ** (1 / 3), rel=0.05)
    # Counted with the reference mechanisms (two transverse modes), not the
    # final state's none: two collinear cables between fixed supports have one
    # redundant axial restraint.
    assert part["stability"]["staticIndeterminacy"] == 1


def test_nonlinear_mechanism_is_unstable_with_its_reason():
    nodes = {"a": (0, 0, 0), "b": (4, 0, 0), "c": (0, 0, 3), "d": (4, 0, 3)}
    members = [("a", "c", "pinned", "pinned"), ("b", "d", "pinned", "pinned"), ("c", "d", "pinned", "pinned")]
    in_plane = [False, True, False, False, False, False]
    result = run_nonlinear(nodes, members, {"a": PINNED, "b": PINNED, "c": in_plane, "d": in_plane})
    assert result["status"] == "unstable"
    assert result["components"][0]["reasonCodes"] == ["internal_mechanism"]


# --- subdivision rules (nonlinear fidelity) ---------------------------------


def _beam(length=4.0):
    from dof_opensees.model import prepare

    body = model({"a": (0, 0, 0), "b": (length, 0, 0)}, [("a", "b")], {"a": FIXED})
    return prepare(StructuralModel.model_validate(body)).members["a-b"]


def test_required_segments_rotation_rule():
    from dof_opensees.builder import required_segments

    beam = _beam()
    # n_rot = ceil(12.5 theta): 1 rad needs 13 elements, small rotations need one.
    assert required_segments(beam, 0.0, 1.0) == 13
    assert required_segments(beam, 0.0, 0.05) == 1
    assert required_segments(beam, 0.0, 0.0) == 1
    assert required_segments(beam, 0.0, 100.0) == 32
    # The larger of the buckling and rotation counts.
    euler = math.pi**2 * EI / 4.0**2
    assert required_segments(beam, euler, 0.0) == 29
    assert required_segments(beam, euler, 1.0) == 29
    assert required_segments(beam, 0.01 * euler, 1.0) == 13


def preview_segments(load):
    """Segments the linear preview asks for on a 4 m cantilever with a tip load."""
    from dof_opensees import engine
    from dof_opensees.model import prepare

    body = model({"a": (0, 0, 0), "b": (4, 0, 0)}, [("a", "b")], {"a": FIXED}, {"b": (0, 0, -load)},
                 {"fidelity": "nonlinear"})
    prepared = prepare(StructuralModel.model_validate(body))
    part = prepared.components[0]
    with engine._LOCK:
        reference = engine._coarse_reference(prepared, part)
        return engine._preview_segments(prepared, part, reference[0])["a-b"]


def test_large_preview_rotation_refines_the_beam():
    # P L^2 / EI = 2. Linear tip deflection P L^3 / 3EI = 2L/3, so the chord
    # turns 2/3 rad; the root (fixed, rotation 0) is 2/3 rad off the chord and
    # the tip (P L^2 / 2EI = 1 rad) 1/3 rad. Largest 2/3: ceil(12.5 * 2/3) = 9.
    load = 2 * EI / 4.0**2
    assert preview_segments(load) == 9


def test_small_preview_rotation_keeps_one_element():
    # A tip rotation of 1e-3 rad is an ordinary structure: one element.
    load = 1e-3 * 2 * EI / 4.0**2
    assert preview_segments(load) == 1
