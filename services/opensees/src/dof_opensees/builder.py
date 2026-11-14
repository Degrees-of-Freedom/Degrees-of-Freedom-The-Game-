"""Build the OpenSees domain of one component.

The builder turns a prepared component (``model.py``) into OpenSees nodes,
constraints, elements and one load pattern, for small-displacement
(``linear``) or ``corotational`` geometry. It also reads the equation
numbering back, because OpenSees reports it inconsistently for constrained
nodes. It does not run analyses.

Tags: joint nodes come first, then member nodes, in component order, so a
rebuild gives identical tags. Node, element, material and transformation tags
each count from 1; ``Domain.temp_tag_base`` is above all of them.

Verified OpenSees behaviour this module relies on (OpenSeesPy 3.8):

* With ``constraints('Transformation')``, ``nodeDOFs`` of the constrained
  node of an ``equalDOF`` lists its own free DOFs first, in DOF order, then
  the retained node's equations; for every other node it is in DOF order.
* Forces delivered through a duplicate node appear as ``nodeReaction`` on the
  duplicate, not on the joint; callers fold them back.
* ``elasticBeamColumn`` ``-releasey``/``-releasez`` release the moment about
  local y/z: code 1 at the start, 2 at the end, 3 at both.
* ``uniaxialMaterial('Elastic', tag, E, 0.0, 0.0)`` has zero stiffness and
  stress in compression and the full modulus at exactly zero strain, so an
  unstrained cable counts as active.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import openseespy.opensees as ops

from .model import (
    FREE,
    RELEASE,
    SHARED,
    UNATTACHED,
    Component,
    End,
    Member,
    PreparedModel,
)

#: Elements per beam under nonlinear fidelity, so member buckling and P-delta
#: are captured (DESIGN.md, Elements). Provisional: the count that meets the
#: 2% buckling gate is being determined separately.
NONLINEAR_SEGMENTS = 8

LINEAR, COROTATIONAL = "linear", "corotational"


@dataclass
class Node:
    tag: int
    position: np.ndarray
    fixed: tuple[bool, ...]
    #: Contract node id for joint nodes.
    joint_id: str | None = None
    #: Joint a member end node sits at (duplicate or unattached end node).
    at_joint: str | None = None
    #: Retained joint tag when this node is the constrained side of ``equalDOF``.
    retained: int | None = None
    tied: tuple[int, ...] = ()


@dataclass
class BuiltMember:
    id: str
    kind: str
    #: Element tags from the start of the member to its end.
    elements: list[int]
    #: Node tags along the member, start to end.
    nodes: list[int]


@dataclass
class Domain:
    nodes: dict[int, Node]
    joint_tags: dict[str, int]
    members: dict[str, BuiltMember]
    #: Reference load per node tag: joint loads plus lumped self-weight.
    loads: dict[int, np.ndarray]
    free_dofs: int
    temp_tag_base: int
    geometry: str

    def duplicates_of(self, joint_tag: int) -> list[Node]:
        return [node for node in self.nodes.values() if node.retained == joint_tag]


@dataclass
class _Tags:
    node: int = 0
    element: int = 0
    material: int = 0
    transformation: int = 0

    def next(self, kind: str) -> int:
        setattr(self, kind, getattr(self, kind) + 1)
        return getattr(self, kind)


@dataclass
class _Context:
    domain: Domain
    tags: _Tags = field(default_factory=_Tags)

    def add_node(self, position: np.ndarray, fixed: tuple[bool, ...], **info) -> int:
        tag = self.tags.next("node")
        ops.node(tag, *(float(v) for v in position))
        if any(fixed):
            ops.fix(tag, *(int(flag) for flag in fixed))
        self.domain.nodes[tag] = Node(tag, position, fixed, **info)
        return tag

    def add_load(self, tag: int, load: np.ndarray) -> None:
        self.domain.loads[tag] = self.domain.loads.get(tag, np.zeros(6)) + load


def tag_bound(prepared: PreparedModel, component: Component, segments: int) -> int:
    """A tag above every node, element and material tag the build will use."""
    per_member = segments + 2 + 2 * 6 + 2
    return len(component.node_ids) + per_member * len(component.member_ids) + 1


def build(prepared: PreparedModel, component: Component, geometry: str, segments: int = 1) -> Domain:
    """Wipe OpenSees and build the component at its reference state.

    The full reference load is one ``Plain`` pattern on a ``Linear`` time
    series, so the pseudo-time of a ``LoadControl`` analysis is the load
    factor. Self-weight, when requested, is lumped onto the member's own
    nodes. No analysis objects are created.
    """
    ops.wipe()
    ops.model("basic", "-ndm", 3, "-ndf", 6)
    domain = Domain({}, {}, {}, {}, 0, tag_bound(prepared, component, segments), geometry)
    context = _Context(domain)

    for node_id in component.node_ids:
        joint = prepared.joints[node_id]
        tag = context.add_node(joint.position, joint.fixed, joint_id=node_id)
        domain.joint_tags[node_id] = tag
        if any(value != 0.0 for value in joint.load):
            context.add_load(tag, np.array(joint.load))

    for member_id in component.member_ids:
        member = prepared.members[member_id]
        start = _end_node(context, member, member.start)
        end = _end_node(context, member, member.end)
        if member.axial:
            built = _add_axial(context, member, start, end, geometry)
        else:
            built = add_beam(context, member, start, end, geometry, segments)
        domain.members[member_id] = built
        if prepared.self_weight and member.properties.weight_per_length > 0.0:
            # Half of each element's weight to each of its nodes, along -Z.
            share = member.properties.weight_per_length * member.length / len(built.elements) / 2.0
            for left, right in zip(built.nodes[:-1], built.nodes[1:]):
                for tag in (left, right):
                    context.add_load(tag, np.array([0.0, 0.0, -share, 0.0, 0.0, 0.0]))

    ops.timeSeries("Linear", 1)
    ops.pattern("Plain", 1, 1)
    for tag, load in domain.loads.items():
        if np.any(load != 0.0):
            ops.load(tag, *(float(v) for v in load))

    domain.free_dofs = sum(6 - sum(node.fixed) - len(node.tied) for node in domain.nodes.values())
    if context.tags.node >= domain.temp_tag_base or context.tags.element >= domain.temp_tag_base:
        raise RuntimeError("Tag bound underestimated.")  # Guards tag_bound against future edits.
    return domain


def _end_node(context: _Context, member: Member, end: End) -> int:
    """Node the member element starts or ends on, with its connection to the joint."""
    joint_tag = context.domain.joint_tags.get(end.node_id)
    if end.representation in (SHARED, RELEASE):
        return joint_tag
    # Axial members have no rotational stiffness: their own end nodes' rotations are removed.
    fixed = (False, False, False, True, True, True) if member.axial else (False,) * 6
    if end.representation == UNATTACHED:
        return context.add_node(end.position, fixed, at_joint=end.node_id if joint_tag else None)
    retained = joint_tag if end.tied else None
    tag = context.add_node(end.position, fixed, at_joint=end.node_id, retained=retained, tied=end.tied)
    if end.tied:
        ops.equalDOF(joint_tag, tag, *end.tied)
    if end.springs:
        directions, materials = [], []
        for direction, stiffness in end.springs:
            material = context.tags.next("material")
            ops.uniaxialMaterial("Elastic", material, float(stiffness))
            directions.append(direction)
            materials.append(material)
        # Element local axes are the member's, so the directions are member axes.
        x, y = member.axes[0], member.axes[1]
        ops.element(
            "zeroLength", context.tags.next("element"), joint_tag, tag,
            "-mat", *materials, "-dir", *directions, "-orient", *map(float, x), *map(float, y),
        )
    return tag


def add_beam(context: _Context, member: Member, start: int, end: int, geometry: str, segments: int) -> BuiltMember:
    """Create the elements of one beam between two nodes.

    This is the single place that chooses the beam formulation and its
    subdivision, so either can be changed without touching anything else.
    Currently ``elasticBeamColumn`` with ``segments`` equal elements. Moment
    releases (RELEASE ends) go on the first and last element only.
    """
    p = member.properties
    transformation = context.tags.next("transformation")
    kind = "Corotational" if geometry == COROTATIONAL else "Linear"
    # vecxz lies in the local x-z plane: the local Z axis of the contract rule.
    ops.geomTransf(kind, transformation, *map(float, member.axes[2]))

    nodes = [start]
    for index in range(1, segments):
        position = member.start.position + (member.end.position - member.start.position) * index / segments
        nodes.append(context.add_node(position, (False,) * 6))
    nodes.append(end)

    def released(end_: End, axis: int) -> bool:
        return end_.representation == RELEASE and end_.laws[axis] == FREE

    elements = []
    for index, (i, j) in enumerate(zip(nodes[:-1], nodes[1:])):
        options = []
        for flag, axis in (("-releasey", 4), ("-releasez", 5)):
            code = (1 if index == 0 and released(member.start, axis) else 0) + (
                2 if index == segments - 1 and released(member.end, axis) else 0
            )
            if code:
                options += [flag, code]
        tag = context.tags.next("element")
        ops.element(
            "elasticBeamColumn", tag, i, j,
            p.area, p.elastic_modulus, p.shear_modulus, p.torsion_constant, p.inertia_y, p.inertia_z,
            transformation, *options,
        )
        elements.append(tag)
    return BuiltMember(member.id, member.kind, elements, nodes)


def _add_axial(context: _Context, member: Member, start: int, end: int, geometry: str) -> BuiltMember:
    p = member.properties
    material = context.tags.next("material")
    if member.kind == "cable":
        # Zero modulus and stress in compression: the cable goes slack.
        ops.uniaxialMaterial("Elastic", material, p.elastic_modulus, 0.0, 0.0)
    else:
        ops.uniaxialMaterial("Elastic", material, p.elastic_modulus)
    if member.initial_strain != 0.0:
        wrapped = context.tags.next("material")
        # Positive initial strain is tension, as in the contract.
        ops.uniaxialMaterial("InitStrainMaterial", wrapped, material, member.initial_strain)
        material = wrapped
    tag = context.tags.next("element")
    ops.element("corotTruss" if geometry == COROTATIONAL else "Truss", tag, start, end, p.area, material)
    return BuiltMember(member.id, member.kind, [tag], [start, end])


@dataclass
class Equations:
    """Equation numbering of the current analysis system."""

    size: int
    #: Equation per DOF (index 0..5) for every node tag, -1 where not in the system.
    of_node: dict[int, list[int]]
    #: (node tag, dof 1..6) that owns each equation.
    owners: list[tuple[int, int]]

    def translation_mask(self) -> np.ndarray:
        return np.array([dof <= 3 for _, dof in self.owners], dtype=bool)

    def load_vector(self, loads: dict[int, np.ndarray]) -> np.ndarray:
        vector = np.zeros(self.size)
        for tag, load in loads.items():
            for dof, equation in enumerate(self.of_node[tag]):
                if equation >= 0:
                    vector[equation] += load[dof]
        return vector


def read_equations(domain: Domain, size: int) -> Equations:
    """Read equation numbers straight after ``tangent.extract_tangent``."""
    of_node: dict[int, list[int]] = {}
    owners: list[tuple[int, int] | None] = [None] * size
    # Ordinary nodes first: constrained nodes need their joint's numbers.
    ordered = sorted(domain.nodes.values(), key=lambda node: node.retained is not None)
    for node in ordered:
        raw = list(ops.nodeDOFs(node.tag))
        if node.retained is None:
            equations = raw
            own = [dof for dof in range(6) if equations[dof] >= 0]
        else:
            joint = of_node[node.retained]
            shared = {joint[dof - 1] for dof in node.tied}
            own = [dof for dof in range(6) if not node.fixed[dof] and dof + 1 not in node.tied]
            own_equations = [eq for eq in raw if eq >= 0 and eq not in shared]
            if len(own_equations) != len(own):
                raise RuntimeError(f"Unexpected equation numbering on constrained node {node.tag}.")
            equations = [-1] * 6
            for dof, equation in zip(own, own_equations):
                equations[dof] = equation
            for dof in node.tied:
                equations[dof - 1] = joint[dof - 1]
        of_node[node.tag] = equations
        for dof in own:
            owners[equations[dof]] = (node.tag, dof + 1)
    if any(owner is None for owner in owners):
        raise RuntimeError("Some equations are not owned by any node.")
    return Equations(size, of_node, owners)  # type: ignore[arg-type]


def equations_from_owners(domain: Domain, owners: list[tuple[int, int]]) -> Equations:
    """Rebuild the numbering from ``(node tag, dof)`` per equation, as the nonlinear driver reports it."""
    of_node = {tag: [-1] * 6 for tag in domain.nodes}
    for equation, (tag, dof) in enumerate(owners):
        of_node[tag][dof - 1] = equation
    # A tied DOF of a duplicate node is its joint's equation.
    for node in domain.nodes.values():
        for dof in node.tied:
            of_node[node.tag][dof - 1] = of_node[node.retained][dof - 1]
    return Equations(len(owners), of_node, list(owners))
