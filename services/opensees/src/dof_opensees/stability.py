"""Stability assessment from a stiffness or tangent stiffness matrix.

For a free-DOF stiffness matrix ``K`` at an equilibrium state:

* A null vector of ``K`` is a mechanism: a motion that meets no stiffness.
* A direction of negative stiffness means the equilibrium is unstable: the
  structure has passed a buckling or limit load.
* A very small positive eigenvalue is a near-mechanism: stable, but only just.

Used on the elastic stiffness at the reference geometry this is a kinematic
check. Used on the tangent stiffness at a loaded state it also accounts for
stress stiffening and for slack cables, because OpenSees has already put
those into the tangent.

Null vectors are split into those that move nodes and those that only rotate
them in place, because the two are reported differently. Whether either kind
is acceptable is the caller's decision, not this module's.

Cost: one Cholesky factorisation when the matrix is comfortably positive
definite, which is the common case, and one symmetric eigendecomposition
otherwise.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

# Thresholds on the eigenvalues of the diagonally scaled matrix, whose
# diagonal is 1. Rounding noise on a true zero is around n * 1e-16.
#: Magnitudes below this are zero: a mechanism.
ZERO_EIGENVALUE = 1e-10
#: Positive values below this are a near-mechanism. Provisional: to be
#: calibrated against slender but sound structures.
NEAR_MECHANISM = 1e-8
# A null vector whose translational part (after orthonormalisation) has a
# singular value below this is a pure rotation mode.
ROTATION_ONLY = 1e-6
# Relative work threshold above which a load is considered to drive a mode.
LOADED_MODE = 1e-8


@dataclass
class Assessment:
    """Result of :func:`assess`. Mode vectors are indexed like ``K``."""

    free_dofs: int
    #: Null vectors that move at least one node.
    translational_modes: list[np.ndarray] = field(default_factory=list)
    #: Null vectors that only rotate nodes in place.
    rotational_modes: list[np.ndarray] = field(default_factory=list)
    #: Directions of negative stiffness (buckling shapes), most negative first.
    negative_modes: list[np.ndarray] = field(default_factory=list)
    #: True when the loads do work on at least one mechanism of either kind.
    mechanism_loaded: bool = False
    #: True when the loads do work on at least one pure rotation mode.
    rotation_loaded: bool = False
    #: True when the smallest positive scaled eigenvalue is below NEAR_MECHANISM.
    near_mechanism: bool = False
    #: Smallest scaled eigenvalue, or None when the fast path proved the matrix
    #: comfortably positive definite without computing it.
    min_eigenvalue: float | None = None
    #: Set by a caller that knows the matrix is not positive definite from a
    #: failed factorisation, without having computed the spectrum. The mode
    #: lists are then empty even though the state is unstable.
    indefinite: bool = False

    @property
    def mechanisms(self) -> int:
        return len(self.translational_modes) + len(self.rotational_modes)

    @property
    def positive_definite(self) -> bool:
        """No mechanism and no direction of negative stiffness."""
        return self.mechanisms == 0 and not self.negative_modes and not self.indefinite

    @property
    def stable(self) -> bool:
        return self.positive_definite


def _scaled(stiffness: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Symmetrise and scale to a unit diagonal.

    Translational and rotational stiffnesses differ by orders of magnitude and
    by unit, so thresholds only make sense after scaling. The scaling is a
    congruence, which preserves the numbers of zero and negative eigenvalues.
    """
    k = 0.5 * (stiffness + stiffness.T)
    diagonal = np.diag(k)
    scale = np.where(diagonal > 0.0, 1.0 / np.sqrt(np.where(diagonal > 0.0, diagonal, 1.0)), 1.0)
    return k * scale[:, None] * scale[None, :], scale


def _normalised(mode: np.ndarray, translation_mask: np.ndarray) -> np.ndarray:
    """Scale so the largest translation is 1, or the largest entry if there is none."""
    peak = np.max(np.abs(mode[translation_mask])) if translation_mask.any() else 0.0
    if peak < ROTATION_ONLY * np.max(np.abs(mode)):
        peak = np.max(np.abs(mode))
    return mode / peak


def assess(stiffness: np.ndarray, translation_mask: np.ndarray, loads: np.ndarray) -> Assessment:
    """Classify the spectrum of a free-DOF stiffness matrix.

    Args:
        stiffness: Symmetric matrix, shape ``(n, n)``.
        translation_mask: Boolean vector, true where the DOF is a translation.
        loads: Applied load vector on the same DOFs, used only to report
            whether the loads do work on a mechanism.
    """
    n = stiffness.shape[0]
    assessment = Assessment(free_dofs=n)
    if n == 0:
        return assessment

    scaled, scale = _scaled(stiffness)

    # Fast path: positive definite with margin means nothing to report.
    try:
        np.linalg.cholesky(scaled - NEAR_MECHANISM * np.eye(n))
        return assessment
    except np.linalg.LinAlgError:
        pass

    eigenvalues, eigenvectors = np.linalg.eigh(scaled)
    assessment.min_eigenvalue = float(eigenvalues[0])
    negative = eigenvalues < -ZERO_EIGENVALUE
    null = ~negative & (eigenvalues < ZERO_EIGENVALUE)
    assessment.near_mechanism = bool(np.any(~negative & ~null & (eigenvalues < NEAR_MECHANISM)))

    # Undo the scaling to return to physical DOFs.
    for column in np.flatnonzero(negative):
        assessment.negative_modes.append(_normalised(eigenvectors[:, column] * scale, translation_mask))

    if not null.any():
        return assessment
    basis, _ = np.linalg.qr(eigenvectors[:, null] * scale[:, None])
    count = basis.shape[1]

    # Split the null space into the part that moves nodes and the part that
    # only rotates them. The right singular vectors of the translational rows
    # give that split independently of the arbitrary eigenvector basis.
    translational_rows = basis[translation_mask, :]
    singular_values = np.zeros(count)
    combos = np.eye(count)
    if translational_rows.shape[0]:
        _, s, combos = np.linalg.svd(translational_rows, full_matrices=True)
        singular_values[: s.shape[0]] = s

    load_scale = float(np.max(np.abs(loads))) if loads.size else 0.0
    for value, combo in zip(singular_values, combos):
        mode = basis @ combo
        loaded = load_scale > 0.0 and abs(float(mode @ loads)) > LOADED_MODE * load_scale * float(np.max(np.abs(mode)))
        assessment.mechanism_loaded |= loaded
        if value > ROTATION_ONLY:
            assessment.translational_modes.append(mode / np.max(np.abs(mode[translation_mask])))
        else:
            assessment.rotational_modes.append(mode / np.max(np.abs(mode)))
            assessment.rotation_loaded |= loaded
    return assessment
