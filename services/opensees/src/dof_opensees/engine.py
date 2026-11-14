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
from .schema import CableLaw, FrameLaw, StructuralModel

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
    law: FrameLaw | CableLaw | None = None

    @property
    def is_truss(self) -> bool:
        return not isinstance(self.law, FrameLaw) and not self.start_fixed and not self.end_fixed


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
        if item.law and not model.analysis:
            raise ModelError("An explicit member law requires the corotational analysis option.")
        if isinstance(item.law, CableLaw) and (item.startFixity != "pinned" or item.endFixity != "pinned"):
            raise ModelError(f"Cable '{item.id}' requires pinned ends.")
        member = _Member(item.id, start, end, item.startFixity == "fixed", item.endFixity == "fixed", law=item.law)
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


def _build(active: list[_Node], members: list[_Member], properties: MemberProperties, corotational=False) -> tuple[int, int]:
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
    formulation = "Corotational" if corotational else "Linear"
    ops.geomTransf(formulation, 1, 0.0, 0.0, 1.0)
    ops.geomTransf(formulation, 2, 1.0, 0.0, 0.0)

    next_node = len(active)
    for tag, member in enumerate(members, start=1):
        member.tag = tag
        start, end = member.start, member.end
        law = member.law
        area = law.area if law else p.area
        modulus = law.elasticModulus if law else p.elastic_modulus
        if member.is_truss:
            material = 1
            if isinstance(law, CableLaw):
                # CorotTruss measures strain on the reference chord. Convert
                # its slope and offset to yield exactly EA*(l/Lrest - 1).
                ratio = math.dist(start.position, end.position) / law.restLength
                elastic = 2 * tag + 1
                material = elastic + 1
                ops.uniaxialMaterial("Elastic", elastic, modulus * ratio, 0.0, 0.0)
                ops.uniaxialMaterial("InitStrainMaterial", material, elastic, 1 - 1 / ratio)
            elif law:
                material = 2 * tag + 1
                ops.uniaxialMaterial("Elastic", material, modulus)
            ops.element("corotTruss" if corotational else "Truss", tag, start.tag, end.tag, area, material)
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
            area, modulus, law.shearModulus if law else p.shear_modulus,
            law.torsionConstant if law else p.torsion_constant,
            law.iy if law else p.second_moment, law.iz if law else p.second_moment, transformation,
        )
    # Each duplicate node contributes its three free rotations.
    free_dofs = sum(6 - sum(node.fixity) + 3 * len(node.duplicates) for node in active)
    return next_node, free_dofs


def _discretize(nodes: list[_Node], members: list[_Member], segments: int, limits: Limits):
    """Keep member-end releases outside the continuous internal beam mesh."""
    parents = {}
    mesh_nodes = list(nodes)
    mesh_members = []
    for member in members:
        count = 1 if member.is_truss else segments
        if len(mesh_members) + count > limits.max_members or len(mesh_nodes) + count - 1 > limits.max_nodes:
            raise ModelError("Requested nonlinear mesh exceeds the service node or member limit.")
        stations = [member.start]
        for station in range(1, count):
            position = tuple(a + (b-a)*station/count for a, b in zip(member.start.position, member.end.position))
            node = _Node(f"mesh:{member.id}:{station}", position, has_member=True, has_fixed_end=True)
            mesh_nodes.append(node)
            stations.append(node)
        stations.append(member.end)
        children = []
        for i in range(count):
            child = _Member(member.id, stations[i], stations[i+1],
                            i > 0 or member.start_fixed, i+1 < count or member.end_fixed,
                            law=member.law)
            children.append(child)
        mesh_members.extend(children)
        parents[member.id] = children
    return mesh_nodes, mesh_members, parents


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


def _advance_nonlinear() -> int | None:
    """Reach full dead load with bounded Newton iterations and cutbacks."""
    ops.constraints("Transformation")
    ops.numberer("RCM")
    ops.system("BandGeneral")
    ops.test("NormDispIncr", 1e-11, 30)
    ops.algorithm("Newton")
    step = 0.125
    ops.integrator("LoadControl", step)
    ops.analysis("Static")
    for attempt in range(96):
        step = min(step, 1 - ops.getTime())
        ops.integrator("LoadControl", step)
        if ops.analyze(1) == 0:
            if ops.getTime() >= 1 - 1e-12:
                return attempt + 1
            step = min(0.25, 2 * step)
        else:
            step /= 2
            if step < 1 / 4096:
                break
    return None


def _nonlinear_response(model: StructuralModel, nodes: list[_Node], members: list[_Member],
                        properties: MemberProperties, limits: Limits) -> dict:
    """Extract an equilibrium of the deformed model with no stabilizing springs."""
    segments = model.analysis.segmentsPerFrame
    mesh_nodes, mesh_members, parents = _discretize(nodes, members, segments, limits)
    active = [node for node in mesh_nodes if node.has_member or node.loaded]
    _, free = _build(active, mesh_members, properties, corotational=True)
    # Bound the dense final-tangent check before allocating its matrix.
    if free > 1200:
        return {"status": "unresolved", "message": "Expanded nonlinear mesh exceeds the 1200-equation tangent check limit."}
    ops.timeSeries("Linear", 1)
    ops.pattern("Plain", 1, 1)
    for node in active:
        if node.loaded:
            ops.load(node.tag, *node.load)
    if free:
        steps = _advance_nonlinear()
        if steps is None:
            return {"status": "unresolved", "message": "Full nonlinear load could not be equilibrated within the increment budget."}
    else:
        # An all-restrained cable can still carry physical pretension.
        ops.initialize()
        ops.setTime(1.0)
        steps = 0
    ops.reactions()
    displacements, reactions, fr, mr, nr = _nonlinear_nodal_response(nodes, active)
    if not math.isfinite(fr + mr + nr) or max(fr, mr, nr) > 1e-5:
        return {"status": "unresolved", "message": "Deformed-state nodal, force or moment balance did not meet 1e-5."}
    forces, cable_state = {}, {}
    for member in members:
        children = parents[member.id]
        first = _member_forces(children[0])
        if len(children) > 1:
            first["momentEnd"] = _member_forces(children[-1])["momentEnd"]
        if not all(math.isfinite(value) for value in first.values()):
            return {"status": "unresolved", "message": f"Nonfinite internal force on '{member.id}'."}
        forces[member.id] = first
        if isinstance(member.law, CableLaw):
            start = np.array(member.start.position) + displacements[member.start.id][:3]
            end = np.array(member.end.position) + displacements[member.end.id][:3]
            strain = np.linalg.norm(end - start) / member.law.restLength - 1
            target = member.law.elasticModulus * member.law.area * max(0., strain)
            if not math.isclose(first["axial"], target, rel_tol=1e-6, abs_tol=1e-5):
                return {"status": "unresolved", "message": f"Cable '{member.id}' failed its tension-only force law."}
            cable_state[member.id] = "taut" if target > 0 else "slack"
    if free and not _positive_final_tangent(active):
        return {"status": "unresolved", "message": "Final nonlinear tangent is singular, marginal or indefinite."}
    return {"status": "success", "displacements": displacements, "reactions": reactions,
            "memberForces": forces, "warnings": ["Geometrically nonlinear elastic response under the supplied nodal loads."],
            "nonlinear": {"segmentsPerFrame": segments, "steps": steps, "forceResidual": fr,
                          "momentResidual": mr, "nodalResidual": nr, "cableState": cable_state}}


def _nonlinear_nodal_response(nodes: list[_Node], active: list[_Node]):
    """Check global equilibrium about the deformed nodes and each free nodal direction."""
    displacements, reactions = {}, {}
    residual_force = np.zeros(3)
    residual_moment = np.zeros(3)
    origin = np.array(active[0].position) if active else np.zeros(3)
    length_scale = max([1., *(math.dist(node.position, origin) for node in active)])
    force_scale = 1.
    moment_scale = 1.
    max_free_force = max_free_moment = 0.
    nodal_forces = {}
    for node in active:
        nodal = np.array(ops.nodeReaction(node.tag))
        for duplicate in node.duplicates:
            duplicate_force = np.array(ops.nodeReaction(duplicate))
            nodal[:3] += duplicate_force[:3]
            max_free_moment = max(max_free_moment, np.linalg.norm(duplicate_force[3:]))
        nodal_forces[node.tag] = nodal
        free_residual = np.where(node.restrained, 0., nodal)
        max_free_force = max(max_free_force, np.linalg.norm(free_residual[:3]))
        max_free_moment = max(max_free_moment, np.linalg.norm(free_residual[3:]))
    for node in nodes:
        displacement = ops.nodeDisp(node.tag) if node.tag else [0.] * 6
        displacements[node.id] = list(displacement)
        reaction = np.zeros(6)
        if any(node.restrained):
            if node.tag:
                reaction = nodal_forces[node.tag].copy()
            reaction[~np.array(node.restrained)] = 0.
            reactions[node.id] = reaction.tolist()
        net = np.array(node.load) + reaction
        residual_force += net[:3]
        arm = np.array(node.position) + displacement[:3] - origin
        residual_moment += net[3:] + np.cross(arm, net[:3])
        force_scale += np.linalg.norm(node.load[:3]) + np.linalg.norm(reaction[:3])
        moment_scale += np.linalg.norm(node.load[3:]) + np.linalg.norm(reaction[3:])
    fr = float(np.linalg.norm(residual_force)) / force_scale
    mr = float(np.linalg.norm(residual_moment)) / (moment_scale + force_scale * length_scale)
    nr = max(max_free_force / force_scale, max_free_moment / (moment_scale + force_scale * length_scale))
    return displacements, reactions, fr, mr, nr


def _positive_final_tangent(active: list[_Node]) -> bool:
    # A converged iterate can be an unstable equilibrium. Require a positive
    # constrained tangent in work-conjugate, diagonally scaled coordinates.
    tangent = _stiffness(active)
    diagonal = np.diag(tangent)
    if not np.all(np.isfinite(tangent)) or np.any(diagonal <= 0):
        return False
    scales = 1 / np.sqrt(diagonal)
    scaled = scales[:, None] * ((tangent + tangent.T) / 2) * scales[None, :]
    try:
        np.linalg.cholesky(scaled - np.eye(len(scales))*1e-10)
    except np.linalg.LinAlgError:
        return False
    return True


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

    if model.analysis:
        with _LOCK:
            try:
                return _nonlinear_response(model, nodes, members, properties, limits)
            except ModelError as error:
                return {"status": "error", "message": str(error)}
            except (ops.OpenSeesError, ArithmeticError, np.linalg.LinAlgError) as error:
                return {"status": "unresolved", "message": f"Nonlinear response unavailable: {type(error).__name__}."}
            finally:
                ops.wipe()

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
