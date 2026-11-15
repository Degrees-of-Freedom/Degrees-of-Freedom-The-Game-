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
#: Largest ``analysis.segmentsPerFrame`` (and adaptive subdivision count).
MAX_SEGMENTS_PER_FRAME = 32


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


class FrameLaw(_Strict):
    """A beam-column with these section properties (``iy``/``iz`` are ``inertiaY``/``inertiaZ``)."""

    kind: Literal["frame"]
    elasticModulus: float = Field(gt=0)
    shearModulus: float = Field(gt=0)
    area: float = Field(gt=0)
    iy: float = Field(gt=0)
    iz: float = Field(gt=0)
    torsionConstant: float = Field(gt=0)


class CableLaw(_Strict):
    """A tension-only cable whose force is ``EA max(0, length / restLength - 1)``."""

    kind: Literal["cable"]
    elasticModulus: float = Field(gt=0)
    area: float = Field(gt=0)
    restLength: float = Field(gt=0)


class Member(_Strict):
    id: str = Field(min_length=1)
    startNodeId: str
    endNodeId: str
    # ``None`` means "not given" (default ``beam``), so preparation can check
    # an explicit kind against ``law``.
    kind: MemberKind | None = None
    properties: MemberProperties | None = None
    orientation: Vector3 | None = None
    initialStrain: float = 0.0
    law: FrameLaw | CableLaw | None = Field(default=None, discriminator="kind")
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
    """Analysis options. Nonlinear is opt-in: ``fidelity: 'nonlinear'`` or ``type: 'corotational'``.

    With neither, or with no ``analysis`` object at all, the analysis is
    linear. ``segmentsPerFrame`` fixes the elements per beam (nonlinear only);
    without it beams are subdivided adaptively. ``timeoutMs`` is an optional
    wall-clock safeguard; the primary work bound is the request's Newton
    attempt budget. Conflicting combinations are refused in preparation.
    """

    fidelity: Fidelity | None = None
    type: Literal["corotational"] | None = None
    segmentsPerFrame: int | None = Field(default=None, ge=1, le=MAX_SEGMENTS_PER_FRAME)
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
