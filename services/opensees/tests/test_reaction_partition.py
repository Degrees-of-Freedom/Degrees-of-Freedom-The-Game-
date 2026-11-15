"""Linear reaction partition and coordinate invariance at the service boundary."""

import math

import numpy as np
import pytest

from helpers import EA, FIXED, PINNED, run


@pytest.mark.parametrize("count", [2, 3, 4])
@pytest.mark.parametrize("asymmetric", [False, True])
def test_axial_supports_share_a_common_vertical_displacement(count, asymmetric):
    # A vertical guide constrains transverse displacement at the loaded node.
    # Each radial pin-ended bar therefore contributes kz = EA * h² / L³.
    # The guide's horizontal reactions are physical and do not enter vertical share.
    high, gravity = 2.0, 2000.0
    nodes = {"top": (0, 0, high)}
    supports = {"top": [True, True, False, False, False, False]}
    members, stiffness = [], {}
    for i in range(count):
        radius = 1.0 + (i * 0.4 if asymmetric else 0)
        theta, key = 2 * math.pi * i / count, f"foot-{i}"
        nodes[key] = (radius * math.cos(theta), radius * math.sin(theta), 0)
        supports[key] = PINNED
        members.append((key, "top", "pinned", "pinned"))
        stiffness[key] = EA * high**2 / math.hypot(radius, high)**3

    result = run(nodes, members, supports, {"top": (0, 0, -gravity)})
    assert result["status"] == "success", result
    displacement = -gravity / sum(stiffness.values())
    assert result["displacements"]["top"][2] == pytest.approx(displacement, rel=1e-9)
    for key, k in stiffness.items():
        assert result["reactions"][key][2] == pytest.approx(-k * displacement, rel=1e-9)
    assert result["reactions"]["top"][2] == pytest.approx(0, abs=1e-9)


def test_rotating_and_reordering_a_frame_rotates_signed_si_responses():
    nodes = {"base": (0.2, -0.8, 0.3), "knee": (0.3, -0.6, 2.3), "tip": (2.0, 0.4, 2.0)}
    members = [("base", "knee"), ("knee", "tip")]
    load = np.array([120, -420, -630])
    baseline = run(nodes, members, {"base": FIXED}, {"tip": load})
    # Proper rotation about (1,1,1), avoiding a coordinate-axis-only fixture.
    direction = np.ones(3) / math.sqrt(3)
    angle = math.radians(38)
    cross = np.array([[0, -1, 1], [1, 0, -1], [-1, 1, 0]]) / math.sqrt(3)
    rot = np.eye(3) + math.sin(angle)*cross + (1-math.cos(angle))*(np.outer(direction, direction)-np.eye(3))
    rotated = {key: rot @ nodes[key] for key in reversed(nodes)}
    result = run(rotated, list(reversed(members)), {"base": FIXED}, {"tip": rot @ load})
    assert baseline["status"] == result["status"] == "success"
    for field, objects in [("reactions", ["base"]), ("displacements", list(nodes))]:
        for obj in objects:
            for first in (0, 3):
                values = np.array(baseline[field][obj][first:first+3])
                np.testing.assert_allclose(result[field][obj][first:first+3], rot @ values,
                                           rtol=1e-7, atol=1e-10)
