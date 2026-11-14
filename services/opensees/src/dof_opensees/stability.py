"""Kinematic stability assessment from a stiffness matrix.

A linear elastic structure is a mechanism exactly when its free-DOF stiffness
matrix ``K`` is singular: every null vector of ``K`` is a motion that costs no
strain energy. This module counts those motions and returns their shapes.

The check is independent of the load case, apart from one refinement. A
mechanism that only rotates nodes in place (typically a straight run of
rigidly joined members spinning about its own axis) does not stop the
structure from carrying loads that do no work on that spin. Such modes are
reported, but only make the model unstable when the loads excite them.

Cost: one Cholesky factorisation when the model is stable, which is the
common case, and one symmetric eigendecomposition otherwise.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

# Eigenvalues of the diagonally scaled stiffness matrix below this are treated
# as zero. Rounding noise on true zeros is around n * 1e-16; well-conditioned
# game-scale structures have smallest scaled eigenvalues many orders above.
ZERO_EIGENVALUE = 1e-10
# A null vector whose translational part (after orthonormalisation) has a
# singular value below this is a pure rotation mode.
ROTATION_ONLY = 1e-6
# Relative work threshold above which a load is considered to drive a mode.
LOADED_MODE = 1e-8


@dataclass
class Assessment:
    """Result of :func:`assess`. Mode vectors are indexed like ``K``."""

    free_dofs: int
    translational_modes: list[np.ndarray] = field(default_factory=list)
    rotational_modes: list[np.ndarray] = field(default_factory=list)
    #: True when the loads do work on at least one pure rotation mode.
    rotation_loaded: bool = False

    @property
    def mechanisms(self) -> int:
        return len(self.translational_modes) + len(self.rotational_modes)

    @property
    def stable(self) -> bool:
        return not self.translational_modes and not self.rotation_loaded


def _null_space(stiffness: np.ndarray) -> np.ndarray:
    """Orthonormal basis (columns) of the null space of a PSD stiffness matrix.

    Translational and rotational stiffnesses differ by orders of magnitude and
    by unit, so the matrix is scaled to a unit diagonal first. The scaling is
    a congruence, which preserves the dimension of the null space.
    """
    n = stiffness.shape[0]
    k = 0.5 * (stiffness + stiffness.T)
    diagonal = np.diag(k)
    scale = np.where(diagonal > 0.0, 1.0 / np.sqrt(np.where(diagonal > 0.0, diagonal, 1.0)), 1.0)
    scaled = k * scale[:, None] * scale[None, :]

    # Fast path: positive definite with margin means no mechanism at all.
    try:
        np.linalg.cholesky(scaled - ZERO_EIGENVALUE * np.eye(n))
        return np.zeros((n, 0))
    except np.linalg.LinAlgError:
        pass

    eigenvalues, eigenvectors = np.linalg.eigh(scaled)
    null = eigenvectors[:, eigenvalues < ZERO_EIGENVALUE]
    if null.shape[1] == 0:
        return null
    # Undo the scaling to return to physical DOFs, then re-orthonormalise.
    basis, _ = np.linalg.qr(null * scale[:, None])
    return basis


def assess(stiffness: np.ndarray, translation_mask: np.ndarray, loads: np.ndarray) -> Assessment:
    """Classify the mechanisms of a free-DOF stiffness matrix.

    Args:
        stiffness: Symmetric positive semi-definite matrix, shape ``(n, n)``.
        translation_mask: Boolean vector, true where the DOF is a translation.
        loads: Applied load vector on the same DOFs, used only to decide
            whether pure rotation modes are excited.
    """
    n = stiffness.shape[0]
    assessment = Assessment(free_dofs=n)
    if n == 0:
        return assessment

    basis = _null_space(stiffness)
    count = basis.shape[1]
    if count == 0:
        return assessment

    # Split the null space into the part that moves nodes and the part that
    # only rotates them. The right singular vectors of the translational rows
    # give that split independently of the arbitrary eigenvector basis.
    translational_rows = basis[translation_mask, :]
    if translational_rows.shape[0] == 0:
        singular_values = np.zeros(count)
        combos = np.eye(count)
    else:
        _, s, combos = np.linalg.svd(translational_rows, full_matrices=True)
        singular_values = np.zeros(count)
        singular_values[: s.shape[0]] = s

    load_scale = float(np.max(np.abs(loads))) if loads.size else 0.0
    for value, combo in zip(singular_values, combos):
        mode = basis @ combo
        if value > ROTATION_ONLY:
            assessment.translational_modes.append(mode / np.max(np.abs(mode[translation_mask])))
        else:
            mode = mode / np.max(np.abs(mode))
            assessment.rotational_modes.append(mode)
            if load_scale > 0.0 and abs(float(mode @ loads)) > LOADED_MODE * load_scale:
                assessment.rotation_loaded = True
    return assessment
