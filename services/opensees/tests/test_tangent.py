"""The two ways of reading stability out of an OpenSees domain must agree.

``extract_tangent`` plus ``stability.assess`` is the reference: it computes
the spectrum. ``is_positive_definite`` is the cheap test used along a load
path. These tests pin down the behaviour the engine relies on: agreement on
either side of a buckling load, and no disturbance of the domain.
"""

import math

import numpy as np
import openseespy.opensees as ops
import pytest

from dof_opensees import stability, tangent

E, A, I, G, J = 210e9, 7.49e-3, 4.47e-5, 81e9, 7.03e-5
LENGTH = 6.0
EULER = math.pi**2 * E * I / LENGTH**2
SEGMENTS = 16


def loaded_column(load_ratio: float) -> None:
    """A pin-ended corotational column carried to a multiple of its Euler load."""
    ops.wipe()
    ops.model("basic", "-ndm", 3, "-ndf", 6)
    for i in range(SEGMENTS + 1):
        ops.node(i + 1, 0.0, 0.0, LENGTH * i / SEGMENTS)
    ops.fix(1, 1, 1, 1, 0, 0, 1)
    ops.fix(SEGMENTS + 1, 1, 1, 0, 0, 0, 0)
    ops.geomTransf("Corotational", 1, 1.0, 0.0, 0.0)
    for i in range(SEGMENTS):
        ops.element("elasticBeamColumn", i + 1, i + 1, i + 2, A, E, G, J, I, I, 1)
    ops.timeSeries("Linear", 1)
    ops.pattern("Plain", 1, 1)
    ops.load(SEGMENTS + 1, 0, 0, -EULER * load_ratio, 0, 0, 0)
    static_step(0.25, 4)


def static_step(increment: float, steps: int) -> int:
    ops.wipeAnalysis()
    ops.system("UmfPack")
    ops.numberer("RCM")
    ops.constraints("Transformation")
    ops.test("NormDispIncr", 1e-10, 30)
    ops.algorithm("Newton")
    ops.integrator("LoadControl", increment)
    ops.analysis("Static")
    return ops.analyze(steps)


def spectrum_says_positive_definite() -> bool:
    matrix = tangent.extract_tangent()
    mask = np.ones(matrix.shape[0], dtype=bool)
    return stability.assess(matrix, mask, np.zeros(matrix.shape[0])).positive_definite


# 16 segments overestimate the Euler load by about 0.3%, so 0.9 and 1.1 are
# safely on either side of the discrete critical load.
@pytest.mark.parametrize("load_ratio, expected", [(0.25, True), (0.9, True), (1.1, False), (2.0, False)])
def test_cheap_test_agrees_with_the_spectrum_either_side_of_buckling(load_ratio, expected):
    loaded_column(load_ratio)
    assert tangent.is_positive_definite() is expected
    assert spectrum_says_positive_definite() is expected
    ops.wipe()


@pytest.mark.parametrize("probe", [tangent.is_positive_definite, tangent.extract_tangent])
def test_reading_stability_does_not_disturb_the_domain(probe):
    loaded_column(0.5)
    before = (ops.getTime(), ops.nodeDisp(SEGMENTS + 1), ops.nodeDisp(SEGMENTS // 2 + 1))
    probe()
    assert (ops.getTime(), ops.nodeDisp(SEGMENTS + 1), ops.nodeDisp(SEGMENTS // 2 + 1)) == before
    # The load path continues from the same state once analysis objects exist again.
    assert static_step(0.0, 1) == 0
    assert ops.nodeDisp(SEGMENTS + 1) == pytest.approx(before[1], rel=1e-9, abs=1e-12)
    ops.wipe()


def test_indefinite_flag_makes_an_assessment_not_positive_definite():
    assessment = stability.Assessment(free_dofs=3, indefinite=True)
    assert not assessment.positive_definite and not assessment.stable
    assert assessment.mechanisms == 0 and not assessment.negative_modes
