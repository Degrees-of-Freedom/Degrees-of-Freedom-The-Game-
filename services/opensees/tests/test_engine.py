"""Engine tests against closed-form results and determinacy counts.

Expected values are hand formulas for prismatic members under nodal loads.
Tolerances are relative; Euler-Bernoulli beam and truss elements reproduce
these cases to rounding, so 1e-6 is a loose bound, not a tuned one.
"""

import math
import time

import pytest

from helpers import EA, EI, FIXED, GJ, PINNED, run

REL = 1e-6


def approx(value):
    return pytest.approx(value, rel=REL, abs=1e-12)


# --- closed-form reference cases -------------------------------------------


@pytest.mark.parametrize("load", [25e3, -25e3])
def test_axial_bar(load):
    length = 3.0
    result = run({"a": (0, 0, 0), "b": (length, 0, 0)}, [("a", "b")], {"a": FIXED}, {"b": (load, 0, 0)})
    assert result["status"] == "success"
    assert result["displacements"]["b"][0] == approx(load * length / EA)
    # Tension positive, compression negative.
    assert result["memberForces"]["a-b"]["axial"] == approx(load)
    assert result["reactions"]["a"][0] == approx(-load)


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


def tripod(extra_leg=False, load=(0, 0, -30e3)):
    radius, height = 2.0, 3.0
    nodes = {"top": (0, 0, height)}
    for index in range(4 if extra_leg else 3):
        angle = 2 * math.pi * index / 3 + (0.5 if index == 3 else 0.0)
        nodes[f"s{index}"] = (radius * math.cos(angle), radius * math.sin(angle), 0)
    feet = [key for key in nodes if key != "top"]
    members = [(foot, "top", "pinned", "pinned") for foot in feet]
    return run(nodes, members, {foot: PINNED for foot in feet}, {"top": load}), radius, height


def test_pinned_tripod_is_determinate_and_matches_statics():
    result, radius, height = tripod()
    leg = math.hypot(radius, height)
    load = 30e3
    assert result["status"] == "success"
    stability = result["stability"]
    assert (stability["freeDofs"], stability["mechanisms"], stability["staticIndeterminacy"]) == (3, 0, 0)
    for foot in ("s0", "s1", "s2"):
        assert result["memberForces"][f"{foot}-top"]["axial"] == approx(-load * leg / (3 * height))
        assert result["reactions"][foot][2] == approx(load / 3)
    assert result["displacements"]["top"][2] == approx(-load * leg**3 / (3 * height**2 * EA))
    # Pin joints have no rotational degree of freedom.
    assert result["displacements"]["top"][3:] == [0.0, 0.0, 0.0]


def test_extra_leg_adds_one_degree_of_redundancy():
    result, _, _ = tripod(extra_leg=True)
    assert result["status"] == "success"
    assert result["stability"]["staticIndeterminacy"] == 1


def test_simply_supported_beam_ignores_unloaded_axial_spin():
    # Rigidly joined straight beam on two pin supports can spin about its own
    # axis. A transverse load does no work on that spin, so the solve proceeds.
    span, load = 4.0, 12e3
    nodes = {"a": (0, 0, 0), "m": (span / 2, 0, 0), "b": (span, 0, 0)}
    result = run(nodes, [("a", "m"), ("m", "b")], {"a": PINNED, "b": PINNED}, {"m": (0, 0, -load)})
    assert result["status"] == "success"
    stability = result["stability"]
    assert stability["stable"] and stability["rotationalMechanisms"] == 1 and stability["translationalMechanisms"] == 0
    assert stability["unstableNodeIds"] == []
    assert stability["modes"][0]["kind"] == "rotation"
    # Both supports hold X, so the axial direction has one redundant restraint.
    assert stability["staticIndeterminacy"] == 1
    assert any("spin" in warning for warning in result["warnings"])
    # The soft springs that hold the spin are 1e-6 of the member stiffness.
    assert result["displacements"]["m"][2] == pytest.approx(-load * span**3 / (48 * EI), rel=1e-5)
    assert result["reactions"]["a"][2] == pytest.approx(load / 2, rel=1e-5)
    assert result["memberForces"]["a-m"]["momentEnd"] == pytest.approx(load * span / 4, rel=1e-5)


def test_torque_on_a_free_spin_mode_is_unstable():
    nodes = {"a": (0, 0, 0), "m": (2, 0, 0), "b": (4, 0, 0)}
    result = run(nodes, [("a", "m"), ("m", "b")], {"a": PINNED, "b": PINNED}, {"m": (0, 0, 0, 500.0, 0, 0)})
    assert result["status"] == "unstable"
    assert result["stability"]["rotationalMechanisms"] == 1
    assert set(result["stability"]["unstableNodeIds"]) == {"a", "m", "b"}
    assert "rotational" in result["message"]


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


# --- mechanisms -------------------------------------------------------------


def test_two_pinned_bars_fold_out_of_plane():
    nodes = {"l": (-2, 0, 0), "r": (2, 0, 0), "top": (0, 0, 3)}
    members = [("l", "top", "pinned", "pinned"), ("r", "top", "pinned", "pinned")]
    result = run(nodes, members, {"l": PINNED, "r": PINNED}, {"top": (0, 0, -1e3)})
    assert result["status"] == "unstable"
    stability = result["stability"]
    assert not stability["stable"]
    assert (stability["freeDofs"], stability["mechanisms"], stability["staticIndeterminacy"]) == (3, 1, 0)
    assert stability["unstableNodeIds"] == ["top"]
    mode = stability["modes"][0]
    assert mode["kind"] == "translation"
    shape = mode["displacements"]["top"]
    # The apex swings perpendicular to the plane of the two bars.
    assert abs(shape[1]) == approx(1.0) and abs(shape[0]) < 1e-9 and abs(shape[2]) < 1e-9
    assert "displacements" not in result


def portal(fixity, brace=False):
    nodes = {"a": (0, 0, 0), "b": (4, 0, 0), "c": (0, 0, 3), "d": (4, 0, 3)}
    members = [("a", "c", fixity, fixity), ("b", "d", fixity, fixity), ("c", "d", fixity, fixity)]
    if brace:
        members.append(("a", "d", "pinned", "pinned"))
    in_plane = [False, True, False, False, False, False]
    supports = {"a": PINNED, "b": PINNED, "c": in_plane, "d": in_plane}
    return run(nodes, members, supports, {"c": (5e3, 0, 0)})


def test_pinned_portal_sways_until_braced():
    racking = portal("pinned")
    assert racking["status"] == "unstable"
    assert racking["stability"]["translationalMechanisms"] == 1
    assert set(racking["stability"]["unstableNodeIds"]) == {"c", "d"}
    shape = racking["stability"]["modes"][0]["displacements"]
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


def test_moment_on_a_pin_joint_is_unstable():
    result, _, _ = tripod(load=(0, 0, -1e3, 0, 50.0, 0))
    assert result["status"] == "unstable"
    assert result["stability"]["translationalMechanisms"] == 0
    assert result["stability"]["rotationalMechanisms"] == 3
    assert result["stability"]["unstableNodeIds"] == ["top"]


def test_loaded_node_without_members_is_unstable():
    nodes = {"a": (0, 0, 0), "b": (2, 0, 0), "loose": (5, 5, 5)}
    result = run(nodes, [("a", "b")], {"a": FIXED}, {"loose": (0, 0, -1.0)})
    assert result["status"] == "unstable"
    assert result["stability"]["translationalMechanisms"] == 3
    assert result["stability"]["unstableNodeIds"] == ["loose"]


def test_unsupported_structure_has_six_rigid_body_mechanisms():
    result = run({"a": (0, 0, 0), "b": (2, 0, 0), "c": (0, 2, 0)}, [("a", "b"), ("b", "c"), ("c", "a")])
    assert result["status"] == "unstable"
    assert result["stability"]["mechanisms"] == 6


# --- bookkeeping and validation ---------------------------------------------


def test_unused_nodes_are_skipped_with_a_warning():
    nodes = {"a": (0, 0, 0), "b": (2, 0, 0), "spare": (9, 9, 9)}
    result = run(nodes, [("a", "b")], {"a": FIXED}, {"b": (0, 0, -1e3)})
    assert result["status"] == "success"
    assert result["displacements"]["spare"] == [0.0] * 6
    assert any("left out" in warning for warning in result["warnings"])


def test_fully_restrained_model_reacts_its_own_loads():
    result = run({"a": (0, 0, 0), "b": (2, 0, 0)}, [("a", "b")], {"a": FIXED, "b": FIXED}, {"b": (0, 0, -7e3)})
    assert result["status"] == "success"
    assert result["reactions"]["b"][2] == approx(7e3)
    assert result["stability"]["freeDofs"] == 0
    assert result["stability"]["staticIndeterminacy"] == 6


def test_empty_model_succeeds():
    result = run({}, [])
    assert result["status"] == "success" and result["displacements"] == {}


@pytest.mark.parametrize(
    "nodes, members, supports, loads, fragment",
    [
        ({"a": (0, 0, 0)}, [("a", "missing")], None, None, "unknown node 'missing'"),
        ({"a": (0, 0, 0)}, [], {"ghost": FIXED}, None, "unknown node 'ghost'"),
        ({"a": (0, 0, 0)}, [], None, {"ghost": (1, 0, 0)}, "unknown node 'ghost'"),
        ({"a": (0, 0, 0), "b": (0, 0, 0)}, [("a", "b")], None, None, "zero length"),
        ({"a": (0, 0, 0), "b": (1, 0, 0)}, [("a", "b"), ("a", "b")], None, None, "Duplicate member id"),
    ],
)
def test_invalid_models_return_an_error(nodes, members, supports, loads, fragment):
    result = run(nodes, members, supports, loads)
    assert result["status"] == "error" and fragment in result["message"]


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


def test_unbraced_pinned_lattice_reports_its_mechanisms():
    nodes, members, supports, loads = grid_frame(3, fixity="pinned")
    result = run(nodes, members, supports, loads)
    assert result["status"] == "unstable"
    assert result["stability"]["translationalMechanisms"] > 0


def test_game_scale_model_is_fast():
    # 512 nodes, 1344 members, 2688 free DOFs. The bound is deliberately loose
    # so the test only catches order-of-magnitude regressions.
    nodes, members, supports, loads = grid_frame(8)
    started = time.perf_counter()
    result = run(nodes, members, supports, loads)
    elapsed = time.perf_counter() - started
    print(f"\n8x8x8 rigid lattice: {result['stability']['freeDofs']} DOFs in {elapsed:.2f} s")
    assert result["status"] == "success"
    assert elapsed < 30.0
