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
from dataclasses import dataclass, field, replace
from fractions import Fraction

import numpy as np
import openseespy.opensees as ops

from . import stability
from .component_results import compose
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
    #: Dense linear extraction is benchmarked through the 2,688-DOF lattice.
    #: Count released end rotations too, before allocating any dense matrix.
    max_linear_equations: int = 2688
    max_nonlinear_attempts: int = 96


@dataclass
class _IncrementBudget:
    remaining: int


@dataclass
class _Node:
    id: str
    position: tuple[float, float, float]
    tag: int = 0
    restrained: list[bool] = field(default_factory=lambda: [False] * 6)
    load: list[float] = field(default_factory=lambda: [0.0] * 6)
    load_overflow: bool = False
    has_member: bool = False
    has_fixed_end: bool = False
    #: Equation number per DOF, -1 where the DOF is not in the system.
    equations: list[int] = field(default_factory=lambda: [-1] * 6)
    #: Tags of duplicate nodes that carry pinned beam ends at this node.
    duplicates: list[int] = field(default_factory=list)

    @property
    def loaded(self) -> bool:
        return self.load_overflow or any(value != 0.0 for value in self.load)

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
        member = _Member(item.id, start, end, item.startFixity == "fixed", item.endFixity == "fixed", law=item.law)
        start.has_member = end.has_member = True
        start.has_fixed_end |= member.start_fixed
        end.has_fixed_end |= member.end_fixed
        members.append(member)

    for support in model.supports:
        node = node_for(support.nodeId, "A support")
        node.restrained = [a or b for a, b in zip(node.restrained, support.restrained)]
    loads_by_node: dict[str, list[tuple[float, ...]]] = {}
    for load in model.loads:
        node = node_for(load.nodeId, "A load")
        loads_by_node.setdefault(node.id, []).append((*load.force, *load.moment))
    for node_id, vectors in loads_by_node.items():
        try:
            nodes[node_id].load = [_sum_component(values) for values in zip(*vectors)]
        except OverflowError:
            nodes[node_id].load_overflow = True

    return list(nodes.values()), members


def _sum_component(values: tuple[float, ...]) -> float:
    # Equal/opposite loads can follow an intermediate sum larger than a double.
    # Accumulate those rare cases exactly before rounding the final SI component.
    try:
        return math.fsum(values)
    except OverflowError:
        return float(sum(map(Fraction.from_float, values), Fraction()))


def _check_element_range(member: _Member, properties: MemberProperties) -> None:
    """Check the actual derived coefficients supplied to the native element.

    Finite authored scalars can still overflow or underflow at a short element
    or after frame subdivision at a large coordinate offset.
    """
    length = math.dist(member.start.position, member.end.position)
    if length == 0:
        raise ModelError(f"Member '{member.id}' has coincident mesh stations at the supplied coordinate precision.")
    p = member.law
    e = p.elasticModulus if p else properties.elastic_modulus
    area = p.area if p else properties.area
    ea = e * area
    values = [length * length, ea, ea / length]
    if isinstance(p, CableLaw):
        ratio = length / p.restLength
        if ratio == 0:
            raise ModelError(f"Cable '{member.id}' has an unrepresentable length ratio.")
        values.extend((ratio, 1 / ratio, e * ratio, ea / p.restLength))
        if not math.isfinite(ea * (ratio - 1)):
            raise ModelError(f"Cable '{member.id}' has an unrepresentable reference force.")
    elif not member.is_truss:
        gj = p.shearModulus * p.torsionConstant if p else properties.shear_modulus * properties.torsion_constant
        inertias = (p.iy, p.iz) if p else (properties.second_moment,)
        values.extend((gj, gj / length, length * length * length))
        for inertia in inertias:
            ei = e * inertia
            values.extend((ei, 4 * ei / length, 12 * ei / length / length / length))
    if not all(value > 0 and math.isfinite(value) for value in values):
        raise ModelError(f"Member '{member.id}' has geometry or section stiffness outside the OpenSees numeric range.")


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
        _check_element_range(member, properties)
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
            position = tuple(a + (b-a)*(station/count) for a, b in zip(member.start.position, member.end.position))
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
    if not np.all(np.isfinite(matrix)):
        raise FloatingPointError("Nonfinite assembled stiffness matrix.")
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
    modes = []
    unstable_ids: set[str] = set()
    for kind, vectors, rows, blocks in (
        ("translation", assessment.translational_modes, slice(0, 3), True),
        ("rotation", assessment.rotational_modes, slice(3, 6), assessment.rotation_loaded),
    ):
        for vector in vectors:
            if len(modes) >= limits.max_modes and not blocks:
                break
            shape = _mode_shape(vector, active, rows)
            if blocks:
                unstable_ids.update(shape)
            if len(modes) < limits.max_modes:
                modes.append({"kind": kind, "displacements": shape})
    # Each truss carries one independent internal force and each beam six;
    # the duplicate-node rotations of pinned beam ends are already counted in
    # the free DOFs, so they cancel the released moments.
    internal_forces = sum(1 if member.is_truss else 6 for member in members)
    return {
        "stable": assessment.stable,
        "freeDofs": assessment.free_dofs,
        "mechanisms": assessment.mechanisms,
        "translationalMechanisms": len(assessment.translational_modes),
        "rotationalMechanisms": len(assessment.rotational_modes),
        "staticIndeterminacy": internal_forces - assessment.free_dofs + assessment.mechanisms,
        "unstableNodeIds": [node.id for node in active if node.id in unstable_ids],
        "modes": modes,
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
        f = ops.basicForce(member.tag)
        if not f:
            raise FloatingPointError("Missing native truss force.")
        return {**_zero_forces(), "axial": float(f[0])}
    # End forces acting on the element in local axes:
    # [N, Vy, Vz, T, My, Mz] at the start, then the same at the end.
    f = ops.eleResponse(member.tag, "localForce")
    if len(f) != 12 or not all(map(math.isfinite, f)):
        raise FloatingPointError("Incomplete or nonfinite native frame actions.")
    return {
        "axial": float(f[6]),
        "shear": math.hypot(f[1], f[2]),
        "torsion": abs(float(f[3])),
        "momentStart": math.hypot(f[4], f[5]),
        "momentEnd": math.hypot(f[10], f[11]),
    }


def _advance_nonlinear(budget: _IncrementBudget) -> int | None:
    """Reach full dead load with bounded Newton iterations and cutbacks."""
    ops.constraints("Transformation")
    ops.numberer("RCM")
    ops.system("BandGeneral")
    ops.test("NormDispIncr", 1e-11, 30)
    ops.algorithm("Newton")
    step = 0.125
    ops.integrator("LoadControl", step)
    ops.analysis("Static")
    for attempt in range(budget.remaining):
        budget.remaining -= 1
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
                        properties: MemberProperties, limits: Limits, budget: _IncrementBudget) -> dict:
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
        steps = _advance_nonlinear(budget)
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
            if not np.isfinite(duplicate_force).all():
                raise FloatingPointError("Nonfinite released-end residual.")
            nodal[:3] += duplicate_force[:3]
            max_free_moment = max(max_free_moment, math.hypot(*duplicate_force[3:]))
        nodal_forces[node.tag] = nodal
        free_residual = np.where(node.restrained, 0., nodal)
        if not np.isfinite(nodal).all():
            raise FloatingPointError("Nonfinite nodal residual.")
        max_free_force = max(max_free_force, math.hypot(*free_residual[:3]))
        max_free_moment = max(max_free_moment, math.hypot(*free_residual[3:]))
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
        arm = (np.array(node.position) - origin) + displacement[:3]
        residual_moment += net[3:] + np.cross(arm, net[:3])
        force_scale += math.hypot(*node.load[:3]) + math.hypot(*reaction[:3])
        moment_scale += math.hypot(*node.load[3:]) + math.hypot(*reaction[3:])
    moment_scale += force_scale * length_scale
    if not all(map(math.isfinite, (force_scale, moment_scale, max_free_force, max_free_moment))):
        raise FloatingPointError("Nonfinite equilibrium reference scale.")
    fr = math.hypot(*residual_force) / force_scale
    mr = math.hypot(*residual_moment) / moment_scale
    nr = max(max_free_force / force_scale, max_free_moment / moment_scale)
    return displacements, reactions, fr, mr, nr


def _positive_final_tangent(active: list[_Node]) -> bool:
    # A converged iterate can be an unstable equilibrium. Require a positive
    # constrained tangent in work-conjugate, diagonally scaled coordinates.
    tangent = _stiffness(active)
    diagonal = np.diag(tangent)
    if not np.all(np.isfinite(tangent)) or np.any(diagonal <= 0):
        return False
    scales = 1 / np.sqrt(diagonal)
    scaled = scales[:, None] * (tangent * 0.5 + tangent.T * 0.5) * scales[None, :]
    try:
        np.linalg.cholesky(scaled - np.eye(len(scales))*1e-10)
    except np.linalg.LinAlgError:
        return False
    return True


def _linear_equilibrium(nodes: list[_Node], reactions: dict[str, list[float]]) -> bool:
    """Scale loads and moment arms before summing to avoid overflow in r × F."""
    positions, actions = [], []
    for node in nodes:
        for vector in (node.load, reactions.get(node.id, ())):
            if any(vector):
                positions.append(node.position)
                actions.append(vector)
    if not actions:
        return True
    vectors = np.asarray(actions)
    if not np.isfinite(vectors).all():
        return False
    arms = np.asarray(positions) - positions[0]
    length = max(1., float(np.max(np.abs(arms))))
    forces = vectors[:, :3]
    force_scale = max(1., float(np.max(np.abs(forces))))
    forces_scaled = forces / force_scale
    net_force = np.linalg.norm(np.sum(forces_scaled, axis=0))
    if net_force > 1e-5 * max(1., np.linalg.norm(forces_scaled, axis=1).sum()):
        return False
    moments_per_length = vectors[:, 3:] / length
    moment_scale = max(force_scale, float(np.max(np.abs(moments_per_length))))
    couples = moments_per_length / moment_scale
    moments = np.cross(arms / length, forces / moment_scale)
    scale = max(1., np.linalg.norm(couples, axis=1).sum() + np.linalg.norm(moments, axis=1).sum())
    return np.linalg.norm(np.sum(couples + moments, axis=0)) <= 1e-5 * scale


def _solve_component(model: StructuralModel, nodes: list[_Node], members: list[_Member],
                     properties: MemberProperties, limits: Limits, budget: _IncrementBudget) -> dict:
    for node in nodes:
        if node.load_overflow:
            raise ModelError(f"The combined force or moment at node '{node.id}' exceeds the numeric range.")
    for member in members:
        length = math.dist(member.start.position, member.end.position)
        if length < MIN_MEMBER_LENGTH:
            raise ModelError(f"Member '{member.id}' has zero length.")
        if not math.isfinite(length * length):
            raise ModelError(f"Member '{member.id}' has a reference span outside the numeric range of OpenSees.")
        if member.law and not model.analysis:
            raise ModelError("An explicit member law requires the corotational analysis option.")
        if isinstance(member.law, CableLaw) and (member.start_fixed or member.end_fixed):
            raise ModelError(f"Cable '{member.id}' requires pinned ends.")

    if model.analysis:
        with _LOCK:
            try:
                return _nonlinear_response(model, nodes, members, properties, limits, budget)
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
            if free_dofs > limits.max_linear_equations:
                return {"status": "unresolved", "message":
                        f"The {free_dofs}-equation linear model exceeds the {limits.max_linear_equations}-equation dense analysis limit."}
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

    if not _linear_equilibrium(active, reactions):
        return {"status": "unresolved", "message": "Linear force or moment equilibrium did not meet 1e-5."}
    return {
        "status": "success",
        "displacements": displacements,
        "reactions": reactions,
        "memberForces": forces,
        "stability": report,
        "warnings": warnings,
    }


def _finite_response(value) -> bool:
    if isinstance(value, float):
        return math.isfinite(value)
    if isinstance(value, dict):
        return all(map(_finite_response, value.values()))
    if isinstance(value, (tuple, list)):
        return all(map(_finite_response, value))
    return True


def _checked_component(model: StructuralModel, nodes: list[_Node], members: list[_Member],
                       properties: MemberProperties, limits: Limits, budget: _IncrementBudget) -> dict:
    try:
        with np.errstate(over="raise", invalid="raise", divide="raise"):
            result = _solve_component(model, nodes, members, properties, limits, budget)
        if not _finite_response(result):
            raise FloatingPointError("Nonfinite response from OpenSees.")
        return result
    except ModelError as error:
        return {"status": "error", "message": str(error)}
    except (ArithmeticError, np.linalg.LinAlgError, ops.OpenSeesError) as error:
        return {"status": "unresolved", "message": f"Numerical response unavailable: {type(error).__name__}."}


def analyze(model: StructuralModel, properties: MemberProperties = STEEL_MEMBER, limits: Limits = Limits()) -> dict:
    """Solve each connected physical component. Preserve old unscoped responses for one component."""
    try:
        nodes, members = _prepare(model, limits)
    except ModelError as error:
        return {"status": "error", "message": str(error)}
    active = [n for n in nodes if n.has_member or n.loaded]
    # Only named end-node references are edges. In particular, coincident
    # coordinates in distinct regions introduce no constraint or reaction.
    neighbours = {n.id: [] for n in active}
    for m in members:
        neighbours[m.start.id].append(m.end.id)
        neighbours[m.end.id].append(m.start.id)
    groups = {}
    for n in active:
        if n.id in groups:
            continue
        groups[n.id] = n.id
        stack = [n.id]
        while stack:
            for other in neighbours[stack.pop()]:
                if other not in groups:
                    groups[other] = n.id
                    stack.append(other)
    budget = _IncrementBudget(limits.max_nonlinear_attempts)
    # Keep global cardinality, expanded mesh, equation, increment and mode
    # budgets across all native calls. Skipping an oversized region consumes
    # no native allocation and leaves independent small regions eligible.
    extra_left = min(limits.max_nodes - len(nodes), limits.max_members - len(members))
    equations_left = 1200 if model.analysis else limits.max_linear_equations
    modes_left = limits.max_modes

    def solve_region(region_nodes, region_members):
        nonlocal extra_left, equations_left, modes_left
        internal = ((model.analysis.segmentsPerFrame - 1) * sum(not m.is_truss for m in region_members)
                    if model.analysis else 0)
        if internal > extra_left:
            return {"status": "error", "message": "Requested nonlinear mesh exceeds the service node or member limit."}
        free = 6 * internal + sum(6 - sum(n.fixity) for n in region_nodes if n.has_member or n.loaded)
        free += sum(3 * (2 - m.start_fixed - m.end_fixed) for m in region_members if not m.is_truss)
        if free > equations_left:
            message = ("Expanded nonlinear mesh exceeds the 1200-equation tangent check limit." if model.analysis else
                       f"The {free}-equation linear model exceeds the {equations_left}-equation dense analysis limit.")
            return {"status": "unresolved", "message": message}
        equations_left -= free
        extra_left -= internal
        result = _checked_component(model, region_nodes, region_members, properties,
                                    replace(limits, max_modes=modes_left), budget)
        modes_left -= len(result.get("stability", {}).get("modes", []))
        return result

    if len(set(groups.values())) <= 1:
        return solve_region(nodes, members)

    separated = {}
    for n in active:
        separated.setdefault(groups[n.id], ([], []))[0].append(n)
    for m in members:
        separated[groups[m.start.id]][1].append(m)
    scopes = []
    # Resolve anchored regions before unsupported ones spend the remaining
    # bounded Newton attempts. Stable ordering makes the boundary reproducible.
    ordered = sorted(separated.values(), key=lambda group: (
        not any(any(n.restrained) for n in group[0]), len(group[1]), min(n.id for n in group[0])))
    for region_nodes, region_members in ordered:
        result = solve_region(region_nodes, region_members)
        scopes.append({"nodeIds": [n.id for n in region_nodes], "memberIds": [m.id for m in region_members],
                       "result": result})
    return compose(scopes, [n for n in nodes if n.id not in groups], limits.max_modes)
