"""Unit tests for the stiffness-matrix stability assessment."""

import numpy as np

from dof_opensees.stability import assess


def test_positive_definite_matrix_has_no_mechanism():
    k = np.array([[4.0, -1.0], [-1.0, 3.0]])
    result = assess(k, np.array([True, True]), np.zeros(2))
    assert result.stable and result.mechanisms == 0 and result.free_dofs == 2


def test_zero_stiffness_translation_is_a_mechanism():
    k = np.diag([5.0, 0.0, 2.0])
    result = assess(k, np.array([True, True, True]), np.zeros(3))
    assert not result.stable
    assert len(result.translational_modes) == 1
    assert np.allclose(np.abs(result.translational_modes[0]), [0.0, 1.0, 0.0])


def test_widely_different_scales_do_not_look_singular():
    # Translation and rotation stiffness differ by many orders of magnitude.
    k = np.diag([1e9, 1e-2])
    assert assess(k, np.array([True, False]), np.zeros(2)).mechanisms == 0


def test_pure_rotation_mode_is_unstable_only_when_loaded():
    k = np.diag([3.0, 0.0])
    mask = np.array([True, False])
    unloaded = assess(k, mask, np.array([10.0, 0.0]))
    assert unloaded.stable and len(unloaded.rotational_modes) == 1 and not unloaded.translational_modes
    loaded = assess(k, mask, np.array([10.0, 1.0]))
    assert not loaded.stable and loaded.rotation_loaded


def test_mixed_null_space_is_split_into_translation_and_rotation():
    # DOFs: [u1, u2, r]. u1 == u2 rigid sway and a free rotation are both null.
    k = np.array([[1.0, -1.0, 0.0], [-1.0, 1.0, 0.0], [0.0, 0.0, 0.0]])
    result = assess(k, np.array([True, True, False]), np.zeros(3))
    assert len(result.translational_modes) == 1 and len(result.rotational_modes) == 1
    sway = result.translational_modes[0]
    assert np.isclose(sway[0], sway[1]) and abs(sway[2]) < 1e-9


def test_empty_system_is_stable():
    result = assess(np.zeros((0, 0)), np.zeros(0, dtype=bool), np.zeros(0))
    assert result.stable and result.free_dofs == 0
