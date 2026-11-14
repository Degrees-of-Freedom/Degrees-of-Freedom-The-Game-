"""Request schema mirroring ``StructuralModel`` in ``@dof/solver-contract``.

Field names are camelCase on purpose so the JSON matches the TypeScript
contract without aliasing. Unknown fields are rejected: the contract requires
adapters to refuse input they cannot represent rather than silently ignore it.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Vector3 = tuple[float, float, float]
DofFlags = tuple[bool, bool, bool, bool, bool, bool]
EndFixity = Literal["fixed", "pinned"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Node(_Strict):
    id: str = Field(min_length=1)
    position: Vector3


class FrameLaw(_Strict):
    kind: Literal["frame"]
    elasticModulus: float = Field(gt=0)
    shearModulus: float = Field(gt=0)
    area: float = Field(gt=0)
    iy: float = Field(gt=0)
    iz: float = Field(gt=0)
    torsionConstant: float = Field(gt=0)


class CableLaw(_Strict):
    kind: Literal["cable"]
    elasticModulus: float = Field(gt=0)
    area: float = Field(gt=0)
    restLength: float = Field(gt=0)


class CorotationalAnalysis(_Strict):
    type: Literal["corotational"]
    segmentsPerFrame: int = Field(default=8, ge=1, le=32)


class Member(_Strict):
    id: str = Field(min_length=1)
    startNodeId: str
    endNodeId: str
    startFixity: EndFixity = "fixed"
    endFixity: EndFixity = "fixed"
    law: FrameLaw | CableLaw | None = Field(default=None, discriminator="kind")


class Support(_Strict):
    nodeId: str
    restrained: DofFlags


class Load(_Strict):
    nodeId: str
    force: Vector3
    moment: Vector3


class StructuralModel(_Strict):
    units: Literal["SI"]
    nodes: list[Node]
    members: list[Member]
    supports: list[Support]
    loads: list[Load]
    analysis: CorotationalAnalysis | None = None
