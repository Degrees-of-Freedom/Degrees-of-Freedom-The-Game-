"""Incremental-iterative nonlinear static driver.

This module knows nothing about the solver contract. It drives whatever
OpenSees domain a :class:`Problem` builds, following the procedure in
``DESIGN.md`` ("Nonlinear fidelity", "Recovery from a singular reference
state"), and reports an :class:`Outcome`.

INTERFACE ONLY. The seam below is fixed so the engine and the driver can be
written in parallel; ``solve`` is implemented separately.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Protocol

from . import stability


class Problem(Protocol):
    """One component, able to rebuild itself and describe its equations."""

    #: Node, element and material tags at or above this value are unused by
    #: the problem and free for temporary objects such as recovery springs.
    temp_tag_base: int
    #: Largest translation, in metres, that a recovered equilibrium may have
    #: and still be accepted as a stable structure.
    recovery_displacement_limit: float

    def build(self) -> None:
        """Wipe OpenSees and build the domain at its reference state.

        The full reference load must be defined in one ``Plain`` load pattern
        on a ``Linear`` time series, so that a ``LoadControl`` integrator
        scales it and the pseudo-time equals the load factor. No analysis
        objects are created. May be called many times; every call must give
        the same domain and the same tags.
        """

    def assess(self) -> stability.Assessment:
        """Classify the tangent stiffness of the domain at its current state.

        Replaces the analysis objects (see ``tangent.extract_tangent``), so
        the driver must set its analysis up again before the next step.
        """

    def equation_dofs(self) -> list[tuple[int, int]]:
        """``(node tag, dof)`` with dof in 1..6 for each equation of the last ``assess``.

        Lets the driver turn a mode vector into nodal directions, for example
        to place temporary springs.
        """

    def peak_displacement(self) -> float:
        """Largest nodal translation magnitude in the current state, in metres."""


@dataclass(frozen=True)
class Settings:
    """Bounds on the work the driver may do. Values are set by the driver's author."""

    #: Convergence tolerance and iteration limits, step sizes, bisection
    #: accuracy and recovery staging are defined here by the implementation.
    critical_factor_tolerance: float = 0.01


@dataclass
class Outcome:
    #: ``stable``: converged at full load with a positive definite tangent.
    #: ``unstable``: verified mechanism or verified loss of stability.
    #: ``unknown``: no verified conclusion (not converged, timeout).
    state: Literal["stable", "unstable", "unknown"]
    #: Contract reason codes that apply: ``load_induced_instability``,
    #: ``geometrically_stiffened``, ``not_converged``, ``timeout``. Mechanism
    #: naming (rigid body, internal, unsupported) is the engine's job.
    reason_codes: list[str] = field(default_factory=list)
    #: Last load factor in [0, 1] with a verified stable equilibrium. For
    #: ``load_induced_instability`` this is the critical factor estimate.
    load_factor: float = 0.0
    #: Tangent classification behind the verdict: at the final state when
    #: stable, at the first unstable state found when unstable, at the
    #: reference state for a mechanism.
    assessment: stability.Assessment | None = None
    #: Equations of ``assessment``, as returned by ``Problem.equation_dofs``.
    equation_dofs: list[tuple[int, int]] = field(default_factory=list)
    steps: int = 0
    iterations: int = 0


def solve(problem: Problem, deadline: float, settings: Settings = Settings()) -> Outcome:
    """Run the nonlinear analysis of one component.

    Args:
        problem: The component to analyse.
        deadline: ``time.monotonic()`` value after which the driver must stop
            and report ``unknown`` with ``timeout``.
        settings: Work bounds.

    When the outcome is ``stable`` the OpenSees domain is left at the
    full-load equilibrium, with no temporary objects in it, so the caller can
    read displacements, reactions and element forces. For any other outcome
    the state of the domain is unspecified.
    """
    raise NotImplementedError("The nonlinear driver is implemented separately.")
