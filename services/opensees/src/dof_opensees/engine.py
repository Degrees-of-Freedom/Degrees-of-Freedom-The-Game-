"""Translate a ``StructuralModel`` to OpenSees, assess stability, and solve.

Modelling decisions (see also the service README):

* Linear elastic, small-displacement static analysis of one load case made of
  the nodal loads in the request. No self-weight, no member loads.
* Every member is the same steel section (``properties.STEEL_MEMBER``).
* A member pinned at both ends is an axial-only ``Truss`` element. A member
  fixed at both ends is an ``elasticBeamColumn``. A member fixed at one end
  and pinned at the other is an ``elasticBeamColumn`` whose pinned end sits on
  a duplicate node tied to the real node in translation only, which releases
  all three rotations there.
* A node where no member end is fixed is a pure pin joint. Its rotations carry
  no stiffness and no meaning, so they are removed from the system, unless a
  moment load is applied there, in which case they stay and show up as a
  loaded rotational mechanism.
* Nodes with no members and no load are left out of the analysis.

OpenSees keeps one global model per process, so analyses are serialised with
a lock. Run several worker processes to analyse models concurrently.
"""

from __future__ import annotations

import math
import threading
from dataclasses import dataclass, field

import numpy as np
import openseespy.opensees as ops

from . import stability
from .properties import STEEL_MEMBER, MemberProperties
from .schema import StructuralModel

#: Members shorter than this (m) are rejected as zero-length.
MIN_MEMBER_LENGTH = 1e-9
#: Mode-shape entries smaller than this (relative to the peak) are dropped.
MODE_PARTICIPATION = 1e-6
#: Rotational spring stiffness, relative to the largest rotational stiffness in
#: the model, used to hold unloaded spin modes still during the solve.
SPIN_SPRING_RATIO = 1e-6

_LOCK = threading.Lock()


class ModelError(ValueError):
    """The request is well-formed JSON but not an analysable model."""


@dataclass(frozen=True)
class Limits:
    """Upper bounds that keep one request from monopolising the service."""

    max_nodes: int = 2000
    max_members: int = 8000
    #: Maximum number of mechanism shapes returned; counts are never truncated.
    max_modes: int = 12


@dataclass
class _Node:
    id: str
    position: tuple[float, float, float]
    tag: int = 0
    restrained: list[bool] = field(default_factory=lambda: [False] * 6)
    load: list[float] = field(default_factory=lambda: [0.0] * 6)
    has_member: bool = False
    has_fixed_end: bool = False
    #: Equation number per DOF, -1 where the DOF is not in the system.
    equations: list[int] = field(default_factory=lambda: [-1] * 6)
    #: Tags of duplicate nodes that carry pinned beam ends at this node.
    duplicates: list[int] = field(default_factory=list)

    @property
    def loaded(self) -> bool:
        return any(value != 0.0 for value in self.load)

    @property
    def rotations_in_system(self) -> bool:
        return self.has_fixed_end or any(value != 0.0 for value in self.load[3:])

    @property
    def fixity(self) -> list[int]:
        """OpenSees ``fix`` flags: supports plus removed pin-joint rotations."""
        flags = list(self.restrained)
        if not self.rotations_in_system:
            flags[3:] = [True, True, True]
        return [int(flag) for flag in flags]


@dataclass
class _Member:
    id: str
    start: _Node
    end: _Node
    start_fixed: bool
    end_fixed: bool
    tag: int = 0

    @property
    def is_truss(self) -> bool:
        return not self.start_fixed and not self.end_fixed


def _prepare(model: StructuralModel, limits: Limits) -> tuple[list[_Node], list[_Member]]:
    """Validate references and merge supports and loads onto their nodes."""
    if len(model.nodes) > limits.max_nodes:
        raise ModelError(f"Model has {len(model.nodes)} nodes; this service accepts at most {limits.max_nodes}.")
    if len(model.members) > limits.max_members:
        raise ModelError(f"Model has {len(model.members)} members; this service accepts at most {limits.max_members}.")

    nodes: dict[str, _Node] = {}
    for item in model.nodes:
        if item.id in nodes:
            raise ModelError(f"Duplicate node id '{item.id}'.")
        nodes[item.id] = _Node(id=item.id, position=item.position)

    def node_for(node_id: str, owner: str) -> _Node:
        try:
            return nodes[node_id]
        except KeyError:
            raise ModelError(f"{owner} refers to unknown node '{node_id}'.") from None

    members: list[_Member] = []
    seen: set[str] = set()
    for item in model.members:
        if item.id in seen:
            raise ModelError(f"Duplicate member id '{item.id}'.")
        seen.add(item.id)
        start = node_for(item.startNodeId, f"Member '{item.id}'")
        end = node_for(item.endNodeId, f"Member '{item.id}'")
        if start is end or math.dist(start.position, end.position) < MIN_MEMBER_LENGTH:
            raise ModelError(f"Member '{item.id}' has zero length.")
        member = _Member(item.id, start, end, item.startFixity == "fixed", item.endFixity == "fixed")
        start.has_member = end.has_member = True
        start.has_fixed_end |= member.start_fixed
        end.has_fixed_end |= member.end_fixed
        members.append(member)

    for support in model.supports:
        node = node_for(support.nodeId, "A support")
        node.restrained = [a or b for a, b in zip(node.restrained, support.restrained)]
    for load in model.loads:
        node = node_for(load.nodeId, "A load")
        node.load = [a + b for a, b in zip(node.load, (*load.force, *load.moment))]

    return list(nodes.values()), members


def _build(active: list[_Node], members: list[_Member], properties: MemberProperties) -> tuple[int, int]:
    """Create the OpenSees domain.

    Returns the highest node tag used and the number of free DOFs, counted
    here because OpenSees cannot be asked to analyse a system with none.
    """
    ops.wipe()
    ops.model("basic", "-ndm", 3, "-ndf", 6)
    for tag, node in enumerate(active, start=1):
        node.tag = tag
        ops.node(tag, *node.position)
        if any(node.fixity):
            ops.fix(tag, *node.fixity)

    p = properties
    ops.uniaxialMaterial("Elastic", 1, p.elastic_modulus)
    # The section is doubly symmetric, so the orientation of the local axes
    # does not affect results. Two transformations only avoid a reference
    # vector parallel to the member.
    ops.geomTransf("Linear", 1, 0.0, 0.0, 1.0)
    ops.geomTransf("Linear", 2, 1.0, 0.0, 0.0)

    next_node = len(active)
    for tag, member in enumerate(members, start=1):
        member.tag = tag
        start, end = member.start, member.end
        if member.is_truss:
            ops.element("Truss", tag, start.tag, end.tag, p.area, 1)
            continue
        end_tags = []
        for node, fixed in ((start, member.start_fixed), (end, member.end_fixed)):
            if fixed:
                end_tags.append(node.tag)
            else:
                # Pinned end: duplicate node sharing translations only.
                next_node += 1
                ops.node(next_node, *node.position)
                ops.equalDOF(node.tag, next_node, 1, 2, 3)
                node.duplicates.append(next_node)
                end_tags.append(next_node)
        dx, dy, dz = (b - a for a, b in zip(start.position, end.position))
        transformation = 2 if math.hypot(dx, dy) < 1e-6 * abs(dz) else 1
        ops.element(
            "elasticBeamColumn", tag, *end_tags,
            p.area, p.elastic_modulus, p.shear_modulus,
            p.torsion_constant, p.second_moment, p.second_moment, transformation,
        )
    # Each duplicate node contributes its three free rotations.
    free_dofs = sum(6 - sum(node.fixity) + 3 * len(node.duplicates) for node in active)
    return next_node, free_dofs


def _stiffness(active: list[_Node]) -> np.ndarray:
    """Form the free-DOF tangent stiffness and record equation numbers.

    The ``GimmeMCK`` integrator with coefficients (0, 0, 1) makes the system
    matrix equal to K. OpenSees also attempts a solve, which fails harmlessly
    for a mechanism; the matrix read back is the unfactored K either way.
    """
    ops.wipeAnalysis()
    ops.system("FullGeneral")
    ops.numberer("Plain")
    ops.constraints("Transformation")
    ops.algorithm("Linear")
    ops.integrator("GimmeMCK", 0.0, 0.0, 1.0)
    ops.analysis("Transient")
    ops.analyze(1, 0.0)
    size = ops.systemSize()
    matrix = np.array(ops.printA("-ret"), dtype=float).reshape((size, size))
    for node in active:
        node.equations = list(ops.nodeDOFs(node.tag))
    ops.reset()
    return matrix


def _mode_shape(vector: np.ndarray, active: list[_Node], rows: slice) -> dict[str, list[float]]:
    """Map a mode vector to per-node values, scaled so the peak node is 1.

    ``rows`` selects the components that define the peak: translations for a
    translational mode, rotations for a rotational one.
    """
    shape = {
        node.id: [float(vector[eq]) if eq >= 0 else 0.0 for eq in node.equations]
        for node in active
    }
    peak = max((math.hypot(*values[rows]) for values in shape.values()), default=0.0) or 1.0
    return {
        node_id: [value / peak for value in values]
        for node_id, values in shape.items()
        if max(abs(value) for value in values) > MODE_PARTICIPATION * peak
    }


def _stability_report(
    assessment: stability.Assessment, active: list[_Node], members: list[_Member], limits: Limits
) -> dict:
    translational = [("translation", _mode_shape(v, active, slice(0, 3))) for v in assessment.translational_modes]
    rotational = [("rotation", _mode_shape(v, active, slice(3, 6))) for v in assessment.rotational_modes]
    blocking = translational + (rotational if assessment.rotation_loaded else [])
    unstable_ids = {node_id for _, shape in blocking for node_id in shape}
    # Each truss carries one independent internal force and each beam six;
    # the duplicate-node rotations of pinned beam ends are already counted in
    # the free DOFs, so they cancel the released moments.
    internal_forces = sum(1 if member.is_truss else 6 for member in members)
    return {
        "stable": assessment.stable,
        "freeDofs": assessment.free_dofs,
        "mechanisms": assessment.mechanisms,
        "translationalMechanisms": len(translational),
        "rotationalMechanisms": len(rotational),
        "staticIndeterminacy": internal_forces - assessment.free_dofs + assessment.mechanisms,
        "unstableNodeIds": [node.id for node in active if node.id in unstable_ids],
        "modes": [
            {"kind": kind, "displacements": shape}
            for kind, shape in (translational + rotational)[: limits.max_modes]
        ],
    }


def _unstable_message(report: dict, assessment: stability.Assessment) -> str:
    parts = []
    if report["translationalMechanisms"]:
        parts.append(f"{report['translationalMechanisms']} translational mechanism(s)")
    if assessment.rotation_loaded:
        parts.append(f"{report['rotationalMechanisms']} rotational mechanism(s) with a load acting on them")
    return "The structure is unstable: " + " and ".join(parts) + "."


def _add_spin_springs(active: list[_Node], matrix: np.ndarray, first_node_tag: int, first_element_tag: int) -> None:
    """Hold free rotations with very soft springs so unloaded spin modes solve.

    The springs are far softer than any member, so they do not change the
    load-carrying behaviour; they only pin down rotations that are otherwise
    undetermined.
    """
    rotational = [eq for node in active for eq in node.equations[3:] if eq >= 0]
    stiffness = SPIN_SPRING_RATIO * float(np.max(np.diag(matrix)[rotational]))
    ops.uniaxialMaterial("Elastic", 2, stiffness)
    tag, element = first_node_tag, first_element_tag
    for node in active:
        if all(eq < 0 for eq in node.equations[3:]):
            continue
        ops.node(tag, *node.position)
        ops.fix(tag, 1, 1, 1, 1, 1, 1)
        ops.element("zeroLength", element, tag, node.tag, "-mat", 2, 2, 2, "-dir", 4, 5, 6)
        tag += 1
        element += 1


def _solve() -> bool:
    ops.wipeAnalysis()
    ops.system("BandGeneral")
    ops.numberer("RCM")
    ops.constraints("Transformation")
    ops.algorithm("Linear")
    ops.integrator("LoadControl", 1.0)
    ops.analysis("Static")
    if ops.analyze(1) != 0:
        return False
    ops.reactions()
    return True


def _zero_forces() -> dict[str, float]:
    return {"axial": 0.0, "shear": 0.0, "torsion": 0.0, "momentStart": 0.0, "momentEnd": 0.0}


def _member_forces(member: _Member) -> dict[str, float]:
    if member.is_truss:
        return {**_zero_forces(), "axial": float(ops.basicForce(member.tag)[0])}
    # End forces acting on the element in local axes:
    # [N, Vy, Vz, T, My, Mz] at the start, then the same at the end.
    f = ops.eleResponse(member.tag, "localForce")
    return {
        "axial": float(f[6]),
        "shear": math.hypot(f[1], f[2]),
        "torsion": abs(float(f[3])),
        "momentStart": math.hypot(f[4], f[5]),
        "momentEnd": math.hypot(f[10], f[11]),
    }


def analyze(
    model: StructuralModel,
    properties: MemberProperties = STEEL_MEMBER,
    limits: Limits = Limits(),
) -> dict:
    """Analyse a model and return an ``AnalysisResult`` as a JSON-ready dict."""
    try:
        nodes, members = _prepare(model, limits)
    except ModelError as error:
        return {"status": "error", "message": str(error)}

    warnings: list[str] = []
    active = [node for node in nodes if node.has_member or node.loaded]
    skipped = len(nodes) - len(active)
    if skipped:
        warnings.append(f"{skipped} node(s) with no members and no load were left out of the analysis.")

    displacements = {node.id: [0.0] * 6 for node in nodes}
    reactions = {node.id: [0.0] * 6 for node in nodes if any(node.restrained)}
    forces = {member.id: _zero_forces() for member in members}

    with _LOCK:
        try:
            last_node_tag, free_dofs = _build(active, members, properties)
            matrix = _stiffness(active) if free_dofs else np.zeros((0, 0))

            size = matrix.shape[0]
            translation_mask = np.zeros(size, dtype=bool)
            loads = np.zeros(size)
            for node in active:
                for dof, eq in enumerate(node.equations):
                    if eq >= 0:
                        translation_mask[eq] = dof < 3
                        loads[eq] += node.load[dof]

            assessment = stability.assess(matrix, translation_mask, loads)
            report = _stability_report(assessment, active, members, limits)
            if not assessment.stable:
                return {
                    "status": "unstable",
                    "message": _unstable_message(report, assessment),
                    "stability": report,
                    "warnings": warnings,
                }

            if size == 0:
                # Every DOF is restrained: nothing moves and members stay
                # unstressed, so each support simply reacts its own load.
                for node in active:
                    if node.id in reactions:
                        reactions[node.id] = [
                            -value if held else 0.0 for value, held in zip(node.load, node.restrained)
                        ]
            else:
                if assessment.rotational_modes:
                    warnings.append(
                        f"{len(assessment.rotational_modes)} free spin mode(s) were held still: members can "
                        "rotate about their own axis, but no load acts on that rotation."
                    )
                    _add_spin_springs(active, matrix, last_node_tag + 1, len(members) + 1)
                ops.timeSeries("Constant", 1)
                ops.pattern("Plain", 1, 1)
                for node in active:
                    if node.loaded:
                        ops.load(node.tag, *node.load)
                if not _solve():
                    return {
                        "status": "error",
                        "message": "OpenSees failed to solve a model that passed the stability check.",
                    }
                for node in active:
                    displacements[node.id] = [float(value) for value in ops.nodeDisp(node.tag)]
                    if node.id in reactions:
                        reaction = list(ops.nodeReaction(node.tag))
                        # Pinned beam ends deliver their force to the duplicate
                        # node, so fold it back onto the real support.
                        for duplicate in node.duplicates:
                            for dof, value in enumerate(ops.nodeReaction(duplicate)[:3]):
                                reaction[dof] += value
                        reactions[node.id] = [
                            float(value) if held else 0.0 for value, held in zip(reaction, node.restrained)
                        ]
                for member in members:
                    forces[member.id] = _member_forces(member)
        finally:
            ops.wipe()

    return {
        "status": "success",
        "displacements": displacements,
        "reactions": reactions,
        "memberForces": forces,
        "stability": report,
        "warnings": warnings,
    }
