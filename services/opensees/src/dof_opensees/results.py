"""Assemble the contract ``AnalysisResult`` from per-component outcomes.

Pure data (numpy only for type conversion): the engine reads OpenSees and hands over one
:class:`ComponentOutcome` per component; this module applies the contract's
rules (DESIGN.md, "Result assembly"):

* Node, member and reaction entries exist only for components whose results
  are valid (``stable`` or ``marginal``). Absent means unavailable, never zero.
* ``status`` is ``unstable`` if any component is unstable, else ``unresolved``
  if any is unknown, else ``success``.
* The top-level stability report sums the component counts and concatenates
  node ids and modes; modes are capped, counts never are.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .model import Component

STABLE, MARGINAL, UNSTABLE, UNKNOWN = "stable", "marginal", "unstable", "unknown"
VALID_STATES = (STABLE, MARGINAL)

#: Contract order, so reason code lists are deterministic.
REASON_ORDER = (
    "unsupported_component",
    "rigid_body_mechanism",
    "internal_mechanism",
    "near_mechanism",
    "load_induced_instability",
    "geometrically_stiffened",
    "excessive_deformation",
    "cable_slack",
    "not_converged",
    "timeout",
    "equilibrium_not_verified",
    "non_finite_result",
    "solver_error",
)


def native(value):
    """Convert numpy scalars and arrays, anywhere in a result, to Python types.

    Numbers in the engine pass through numpy, and a stray ``np.int64`` or
    ``np.bool_`` makes the whole result unserialisable. Applied once to the
    assembled body so no future code path can reintroduce one.
    """
    if isinstance(value, dict):
        return {str(key): native(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [native(item) for item in value]
    if isinstance(value, np.ndarray):
        return [native(item) for item in value.tolist()]
    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        return float(value)
    return value


def ordered(codes) -> list[str]:
    unique = set(codes)
    return [code for code in REASON_ORDER if code in unique]


@dataclass
class Mode:
    kind: str  # "translation" or "rotation"
    displacements: dict[str, list[float]]


@dataclass
class StabilityData:
    stable: bool
    free_dofs: int
    translational: int = 0
    rotational: int = 0
    static_indeterminacy: int = 0
    unstable_node_ids: list[str] = field(default_factory=list)
    modes: list[Mode] = field(default_factory=list)

    @property
    def mechanisms(self) -> int:
        return self.translational + self.rotational


@dataclass
class ComponentOutcome:
    component: Component
    state: str
    reason_codes: list[str]
    stability: StabilityData
    load_factor: float | None = None
    residual: float | None = None
    displacements: dict[str, list[float]] = field(default_factory=dict)
    reactions: dict[str, list[float]] = field(default_factory=dict)
    member_forces: dict[str, dict] = field(default_factory=dict)

    @property
    def results_valid(self) -> bool:
        return self.state in VALID_STATES


def _report(data: StabilityData, max_modes: int) -> dict:
    return {
        "stable": data.stable,
        "freeDofs": data.free_dofs,
        "mechanisms": data.mechanisms,
        "translationalMechanisms": data.translational,
        "rotationalMechanisms": data.rotational,
        "staticIndeterminacy": data.static_indeterminacy,
        "unstableNodeIds": list(data.unstable_node_ids),
        "modes": [{"kind": mode.kind, "displacements": mode.displacements} for mode in data.modes[:max_modes]],
    }


def _component(outcome: ComponentOutcome, max_modes: int) -> dict:
    body = {
        "id": outcome.component.id,
        "nodeIds": list(outcome.component.node_ids),
        "memberIds": list(outcome.component.member_ids),
        "state": outcome.state,
        "reasonCodes": ordered(outcome.reason_codes),
        "resultsValid": outcome.results_valid,
        "stability": _report(outcome.stability, max_modes),
    }
    if outcome.load_factor is not None:
        body["loadFactor"] = outcome.load_factor
    if outcome.residual is not None:
        body["residual"] = outcome.residual
    return body


def _message(outcomes: list[ComponentOutcome]) -> str:
    counts = {state: 0 for state in (STABLE, MARGINAL, UNSTABLE, UNKNOWN)}
    for outcome in outcomes:
        counts[outcome.state] += 1
    summary = ", ".join(f"{count} {state}" for state, count in counts.items() if count)
    text = f"{len(outcomes)} component(s): {summary}."
    for outcome in outcomes:
        if outcome.state in (UNSTABLE, UNKNOWN):
            reasons = ", ".join(ordered(outcome.reason_codes)) or "no verified conclusion"
            text += f" Component '{outcome.component.id}' is {outcome.state}: {reasons}."
    return text


def assemble(
    outcomes: list[ComponentOutcome],
    *,
    fidelity: str,
    solver: str,
    runtime_ms: float,
    model_version: str | None,
    warnings: list[str],
    max_modes: int,
) -> dict:
    """The JSON-ready ``AnalysisResult`` for a completed analysis."""
    displacements: dict[str, list[float]] = {}
    reactions: dict[str, list[float]] = {}
    member_forces: dict[str, dict] = {}
    for outcome in outcomes:
        if outcome.results_valid:
            displacements.update(outcome.displacements)
            reactions.update(outcome.reactions)
            member_forces.update(outcome.member_forces)

    total = StabilityData(stable=all(outcome.stability.stable for outcome in outcomes), free_dofs=0)
    for outcome in outcomes:
        data = outcome.stability
        total.free_dofs += data.free_dofs
        total.translational += data.translational
        total.rotational += data.rotational
        total.static_indeterminacy += data.static_indeterminacy
        total.unstable_node_ids += data.unstable_node_ids
        total.modes += data.modes[:max_modes]

    if any(outcome.state == UNSTABLE for outcome in outcomes):
        status = "unstable"
    elif any(outcome.state == UNKNOWN for outcome in outcomes):
        status = "unresolved"
    else:
        status = "success"

    analysis = {
        "fidelity": fidelity,
        "solver": solver,
        "runtimeMs": runtime_ms,
        "reasonCodes": ordered(code for outcome in outcomes for code in outcome.reason_codes),
    }
    if model_version is not None:
        analysis = {"modelVersion": model_version, **analysis}

    result = {"status": status}
    if status != "success":
        result["message"] = _message(outcomes)
    result.update(
        {
            "analysis": analysis,
            "components": [_component(outcome, max_modes) for outcome in outcomes],
            "displacements": displacements,
            "reactions": reactions,
            "memberForces": member_forces,
            "stability": _report(total, max_modes),
            "warnings": list(warnings),
        }
    )
    return native(result)
