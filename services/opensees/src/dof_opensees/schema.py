"""Request schema mirroring ``StructuralModel`` in ``@dof/solver-contract``.

Field names are camelCase on purpose so the JSON matches the TypeScript
contract without aliasing. Unknown fields are rejected: the contract requires
adapters to refuse input they cannot represent rather than silently ignore it.

This module only checks shape and value ranges. Cross-references, defaults,
connection capability and everything else semantic belong to model
preparation, which can report them as ``error`` or ``unsupported`` results.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Vector3 = tuple[float, float, float]
Vector6 = tuple[float, float, float, float, float, float]
DofFlags = tuple[bool, bool, bool, bool, bool, bool]
EndFixity = Literal["fixed", "pinned", "free"]
ConnectionLaw = Literal["locked", "free", "elastic"]
MemberKind = Literal["beam", "brace", "cable"]
Fidelity = Literal["linear", "nonlinear"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Node(_Strict):
    id: str = Field(min_length=1)
    position: Vector3


class Connection(_Strict):
    """Six-axis member-end connection in member local axes: UX, UY, UZ, RX, RY, RZ."""

    laws: tuple[ConnectionLaw, ConnectionLaw, ConnectionLaw, ConnectionLaw, ConnectionLaw, ConnectionLaw]
    stiffness: Vector6 | None = None


class MemberProperties(_Strict):
    elasticModulus: float = Field(gt=0)
    shearModulus: float = Field(gt=0)
    area: float = Field(gt=0)
    inertiaY: float = Field(gt=0)
    inertiaZ: float = Field(gt=0)
    torsionConstant: float = Field(gt=0)
    weightPerLength: float | None = Field(default=None, ge=0)


class Member(_Strict):
    id: str = Field(min_length=1)
    startNodeId: str
    endNodeId: str
    kind: MemberKind = "beam"
    properties: MemberProperties | None = None
    orientation: Vector3 | None = None
    initialStrain: float = 0.0
    # ``None`` means "not given", so preparation can tell an omitted shorthand
    # from an explicit one when a full connection is also present.
    startFixity: EndFixity | None = None
    endFixity: EndFixity | None = None
    startConnection: Connection | None = None
    endConnection: Connection | None = None


class Support(_Strict):
    nodeId: str
    restrained: DofFlags


class Load(_Strict):
    nodeId: str
    force: Vector3
    moment: Vector3


class AnalysisOptions(_Strict):
    fidelity: Fidelity = "nonlinear"
    selfWeight: bool = False
    timeoutMs: float | None = Field(default=None, gt=0)
    displacementLimit: float | None = Field(default=None, gt=0)


class StructuralModel(_Strict):
    units: Literal["SI"]
    version: str | None = None
    nodes: list[Node]
    members: list[Member]
    supports: list[Support]
    loads: list[Load]
    analysis: AnalysisOptions = Field(default_factory=AnalysisOptions)
