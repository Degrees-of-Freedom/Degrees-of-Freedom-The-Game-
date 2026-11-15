"""Model preparation: everything about a request that needs no OpenSees.

``prepare`` turns a schema-valid ``StructuralModel`` into a
:class:`PreparedModel`, following ``DESIGN.md`` ("Preparation", "Connection
capability", "Relevant degrees of freedom"):

1. Validate references, ids, lengths and sizes (failures are ``error``).
2. Normalise every member end to six connection laws in member local axes.
3. Resolve properties and local axes.
4. Decide which joint rotations are relevant, and remove the rest.
5. Anchor the spin of members free in torsion at both ends.
6. Choose the exact OpenSees representation of every end, or refuse the
   model as ``unsupported``.
7. Partition into independent components.

The output is plain data: the builder turns it into an OpenSees domain, and
the counting helpers at the bottom give the numbers the stability report
needs without touching OpenSees.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from .properties import STEEL_MEMBER
from .schema import Member as MemberInput
from .schema import StructuralModel

LOCKED, FREE, ELASTIC = "locked", "free", "elastic"
AXIS_NAMES = ("UX", "UY", "UZ", "RX", "RY", "RZ")
SHORTHANDS: dict[str, tuple[str, ...]] = {
    "fixed": (LOCKED,) * 6,
    "pinned": (LOCKED, LOCKED, LOCKED, FREE, FREE, FREE),
    "free": (FREE,) * 6,
}

# End representations; see "Connection capability" in DESIGN.md.
#: The member end shares the joint node.
SHARED = "shared"
#: Beam end on the joint node with element moment releases (hinge, torsion locked).
RELEASE = "release"
#: Duplicate node tied to the joint by ``equalDOF`` on the three translations.
BALL = "ball"
#: Duplicate node, translations tied, oriented rotational springs.
SPRING_TIED = "spring_tied"
#: Duplicate node joined to the joint only by oriented springs.
SPRING = "spring"
#: Duplicate node tied on global DOFs, for members with global local axes.
ALIGNED = "aligned"
#: The end has its own node and transfers nothing to the joint.
UNATTACHED = "unattached"

#: Members shorter than this (m) are rejected as zero-length.
MIN_MEMBER_LENGTH = 1e-9
#: A member whose direction is within this (sine of the angle) of global Z
#: takes global X as its default orientation reference.
VERTICAL_TOLERANCE = 1e-6
#: Tolerance on unit vectors when deciding that two directions are parallel or
#: orthogonal. Grid geometry is exact, so this only absorbs rounding.
DIRECTION_TOLERANCE = 1e-9


class PreparationError(Exception):
    """The request cannot be analysed: ``status`` is ``error`` or ``unsupported``."""

    def __init__(self, status: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def _error(message: str) -> PreparationError:
    return PreparationError("error", message)


def _unsupported(message: str) -> PreparationError:
    return PreparationError("unsupported", message)


@dataclass(frozen=True)
class Limits:
    """Upper bounds that keep one request from monopolising the service."""

    max_nodes: int = 2000
    max_members: int = 8000
    #: Maximum number of mode shapes returned; counts are never truncated.
    max_modes: int = 12
    #: Time budget when the request does not give ``analysis.timeoutMs``.
    default_timeout_ms: float = 2000.0


@dataclass(frozen=True)
class Properties:
    elastic_modulus: float
    shear_modulus: float
    area: float
    inertia_y: float
    inertia_z: float
    torsion_constant: float
    weight_per_length: float


DEFAULT_PROPERTIES = Properties(
    elastic_modulus=STEEL_MEMBER.elastic_modulus,
    shear_modulus=STEEL_MEMBER.shear_modulus,
    area=STEEL_MEMBER.area,
    inertia_y=STEEL_MEMBER.inertia_y,
    inertia_z=STEEL_MEMBER.inertia_z,
    torsion_constant=STEEL_MEMBER.torsion_constant,
    weight_per_length=STEEL_MEMBER.weight_per_length,
)


@dataclass
class End:
    """One member end and how it is joined to its node."""

    node_id: str
    position: np.ndarray
    #: Laws UX..RX..RZ in member local axes, after every preparation step.
    laws: tuple[str, ...]
    stiffness: tuple[float, ...]
    representation: str = ""
    #: Global DOFs (1..6) of the duplicate node held equal to the joint.
    tied: tuple[int, ...] = ()
    #: Oriented springs as (local direction 1..6, stiffness).
    springs: tuple[tuple[int, float], ...] = ()
    #: True when twist anchoring locked RX here (DESIGN.md, Connection capability).
    anchored: bool = False

    @property
    def attached(self) -> bool:
        return any(law != FREE for law in self.laws)


@dataclass
class Member:
    id: str
    kind: str
    start: End
    end: End
    properties: Properties
    #: Rows are the local X, Y and Z unit vectors in global coordinates.
    axes: np.ndarray
    length: float
    initial_strain: float

    @property
    def axial(self) -> bool:
        return self.kind != "beam"

    @property
    def ends(self) -> tuple[End, End]:
        return (self.start, self.end)


@dataclass
class Joint:
    """A contract node that takes part in the analysis."""

    id: str
    position: np.ndarray
    restrained: tuple[bool, ...]
    load: tuple[float, ...]
    #: OpenSees ``fix`` flags: support restraints plus removed rotations.
    fixed: tuple[bool, ...]

    @property
    def supported(self) -> bool:
        return any(self.restrained)


@dataclass
class Component:
    #: Smallest node id, or ``member:<id>`` for a member attached to nothing.
    id: str
    node_ids: list[str]
    member_ids: list[str]


@dataclass
class PreparedModel:
    joints: dict[str, Joint]
    members: dict[str, Member]
    components: list[Component]
    fidelity: str
    self_weight: bool
    timeout_ms: float
    displacement_limit: float | None
    warnings: list[str] = field(default_factory=list)


# --- preparation --------------------------------------------------------------


def prepare(model: StructuralModel, limits: Limits = Limits()) -> PreparedModel:
    """Validate and normalise a request. Raises :class:`PreparationError`."""
    if len(model.nodes) > limits.max_nodes:
        raise _error(f"Model has {len(model.nodes)} nodes; this service accepts at most {limits.max_nodes}.")
    if len(model.members) > limits.max_members:
        raise _error(f"Model has {len(model.members)} members; this service accepts at most {limits.max_members}.")

    positions: dict[str, np.ndarray] = {}
    for node in model.nodes:
        if node.id in positions:
            raise _error(f"Duplicate node id '{node.id}'.")
        positions[node.id] = np.array(node.position, dtype=float)

    def known(node_id: str, owner: str) -> str:
        if node_id not in positions:
            raise _error(f"{owner} refers to unknown node '{node_id}'.")
        return node_id

    restraints: dict[str, tuple[bool, ...]] = {}
    for support in model.supports:
        known(support.nodeId, "A support")
        if support.nodeId in restraints:
            raise _error(f"Node '{support.nodeId}' has more than one support.")
        restraints[support.nodeId] = tuple(bool(flag) for flag in support.restrained)

    loads: dict[str, np.ndarray] = {}
    for load in model.loads:
        known(load.nodeId, "A load")
        loads[load.nodeId] = loads.get(load.nodeId, np.zeros(6)) + np.array((*load.force, *load.moment), dtype=float)

    warnings: list[str] = []
    options = model.analysis
    members: dict[str, Member] = {}
    for item in model.members:
        if item.id in members:
            raise _error(f"Duplicate member id '{item.id}'.")
        owner = f"Member '{item.id}'"
        members[item.id] = _member(item, known(item.startNodeId, owner), known(item.endNodeId, owner), positions)
        if options.selfWeight and item.properties is not None and item.properties.weightPerLength is None:
            warnings.append(f"Member '{item.id}' has properties without weightPerLength; its self-weight is taken as zero.")

    node_ids = [node.id for node in model.nodes]
    attachments = _attachments(members)
    fixed_rotations, held = _relevant_rotations(node_ids, attachments, restraints, loads, members)
    for member in members.values():
        _anchor_twist(member, held)
        for which, end in (("start", member.start), ("end", member.end)):
            _represent(member, end, which)

    components, joint_ids = _partition(node_ids, members, restraints, loads)
    left_out = [node_id for node_id in node_ids if node_id not in joint_ids]
    if left_out:
        shown = ", ".join(f"'{node_id}'" for node_id in left_out[:10]) + (", ..." if len(left_out) > 10 else "")
        warnings.append(f"{len(left_out)} node(s) with nothing attached were left out of the analysis: {shown}.")

    joints: dict[str, Joint] = {}
    for node_id in node_ids:
        if node_id not in joint_ids:
            continue
        restrained = restraints.get(node_id, (False,) * 6)
        fixed = tuple(bool(restrained[dof] or (dof >= 3 and fixed_rotations[node_id][dof - 3])) for dof in range(6))
        load = loads.get(node_id, np.zeros(6))
        joints[node_id] = Joint(node_id, positions[node_id], restrained, tuple(float(v) for v in load), fixed)

    return PreparedModel(
        joints=joints,
        members=members,
        components=components,
        fidelity=options.fidelity,
        self_weight=options.selfWeight,
        timeout_ms=options.timeoutMs if options.timeoutMs is not None else limits.default_timeout_ms,
        displacement_limit=options.displacementLimit,
        warnings=warnings,
    )


def _member(item: MemberInput, start_id: str, end_id: str, positions: dict[str, np.ndarray]) -> Member:
    owner = f"Member '{item.id}'"
    start, end = positions[start_id], positions[end_id]
    length = float(np.linalg.norm(end - start))
    if start_id == end_id or length < MIN_MEMBER_LENGTH:
        raise _error(f"{owner} has zero length.")
    if item.kind == "beam" and item.initialStrain != 0.0:
        raise _unsupported(f"{owner}: initialStrain on a beam is not supported; use a brace or cable.")

    properties = DEFAULT_PROPERTIES
    if item.properties is not None:
        p = item.properties
        properties = Properties(
            p.elasticModulus, p.shearModulus, p.area, p.inertiaY, p.inertiaZ, p.torsionConstant,
            p.weightPerLength or 0.0,
        )

    member = Member(
        id=item.id,
        kind=item.kind,
        start=_normalise(item, "start", start_id, start),
        end=_normalise(item, "end", end_id, end),
        properties=properties,
        axes=_local_axes(item, start, end, length),
        length=length,
        initial_strain=float(item.initialStrain),
    )
    if member.axial:
        # An axial member cannot transfer moment whatever its connector says.
        for member_end in member.ends:
            member_end.laws = (*member_end.laws[:3], FREE, FREE, FREE)
    return member


def _normalise(item: MemberInput, which: str, node_id: str, position: np.ndarray) -> End:
    fixity = getattr(item, f"{which}Fixity")
    connection = getattr(item, f"{which}Connection")
    if fixity is not None and connection is not None:
        raise _error(f"Member '{item.id}' gives both {which}Fixity and {which}Connection; give one.")
    if connection is None:
        return End(node_id, position, SHORTHANDS[fixity or "fixed"], (0.0,) * 6)
    stiffness = tuple(float(v) for v in connection.stiffness) if connection.stiffness is not None else (0.0,) * 6
    for axis, law in enumerate(connection.laws):
        if law == ELASTIC and not stiffness[axis] > 0.0:
            raise _error(
                f"Member '{item.id}' {which} connection: axis {AXIS_NAMES[axis]} is elastic "
                "but has no positive stiffness."
            )
    return End(node_id, position, tuple(connection.laws), stiffness)


def _local_axes(item: MemberInput, start: np.ndarray, end: np.ndarray, length: float) -> np.ndarray:
    """Local axes by the contract rule: X along the member, Y from the reference, Z = X x Y."""
    x = (end - start) / length
    if item.orientation is not None:
        reference = np.array(item.orientation, dtype=float)
        if not np.linalg.norm(reference) > 0.0:
            raise _error(f"Member '{item.id}' has a zero orientation vector.")
        reference = reference / np.linalg.norm(reference)
    elif math.hypot(x[0], x[1]) < VERTICAL_TOLERANCE:
        reference = np.array([1.0, 0.0, 0.0])
    else:
        reference = np.array([0.0, 0.0, 1.0])
    y = reference - (reference @ x) * x
    if np.linalg.norm(y) < DIRECTION_TOLERANCE:
        raise _error(f"Member '{item.id}' has an orientation parallel to the member.")
    y = y / np.linalg.norm(y)
    return np.array([x, y, np.cross(x, y)])


# --- relevant rotations (DESIGN.md, Relevant degrees of freedom) --------------


def _attachments(members: dict[str, Member]) -> dict[str, list[tuple[Member, End]]]:
    """Beam ends at each node that lock or spring at least one rotation."""
    result: dict[str, list[tuple[Member, End]]] = {}
    for member in members.values():
        if member.axial:
            continue
        for end in member.ends:
            if any(law != FREE for law in end.laws[3:]):
                result.setdefault(end.node_id, []).append((member, end))
    return result


def _span(vectors: list[np.ndarray]) -> np.ndarray:
    """Orthonormal basis (columns) of the span of some 3-vectors."""
    if not vectors:
        return np.zeros((3, 0))
    u, s, _ = np.linalg.svd(np.array(vectors).T, full_matrices=False)
    return u[:, s > DIRECTION_TOLERANCE * max(1.0, float(s[0]))]


def _independent(groups: list[list[np.ndarray]]) -> bool:
    """Whether the spans of these groups of directions are linearly independent."""
    bases = [_span(group) for group in groups]
    total = sum(basis.shape[1] for basis in bases)
    combined = _span([vector for basis in bases for vector in basis.T])
    return combined.shape[1] == total


def _relevant_rotations(
    node_ids: list[str],
    attachments: dict[str, list[tuple[Member, End]]],
    restraints: dict[str, tuple[bool, ...]],
    loads: dict[str, np.ndarray],
    members: dict[str, Member],
) -> tuple[dict[str, list[bool]], dict[str, np.ndarray]]:
    """Decide which joint rotations are removed with ``fix``.

    A joint rotation that nothing locks, springs or restrains has no stiffness
    and no meaning; keeping it would show up as a false mechanism. Removing it
    changes no result because nothing could transmit a moment through it.

    The held directions span a subspace S of rotation space. A full S (rank
    3) is analysed natively, whatever the attachments. OpenSees can only
    ``fix`` global axes, so a partial S is handled in these cases, in order:

    1. S is spanned by global axes: fix the others. No law changes.
    2. A moment load acts: keep every rotation, so an unheld loaded rotation
       appears as the loaded mechanism it is (``unsupported`` if the moment
       lies entirely in a skew S, which could not be reduced exactly).
    3. Independent attachments. Each attachment a (a member end, or the
       support's restrained rotations) can transmit a moment m_a only in the
       span H_a of the directions it holds. With no moment load, rotational
       equilibrium of the joint is sum(m_a) = 0. When the spans are linearly
       independent (the dimension of their sum equals the sum of their
       dimensions; for example one attachment, two non-parallel torsion-only
       ends, or three non-coplanar ones) that sum can only vanish term by
       term: every m_a is zero, so no attachment transmits any moment. Their
       rotational laws are then set to free, which changes no result, and the
       joint rotations not restrained by the support are removed. This
       generalises the single-attachment rule and is, after twist anchoring,
       the other place a requested law is replaced.
    4. Otherwise (dependent attachments spanning a skew line or plane) the
       rotation cannot be reduced exactly: ``unsupported``.

    A joint where nothing holds a rotation but a moment acts keeps only the
    global rotations the moment has a component on; the others are as
    irrelevant as at an unloaded joint.

    Returns the removed rotations per node, and per node the projection onto
    the directions that are held or removed (used to place twist anchors).
    """
    eye = np.eye(3)
    fixed: dict[str, list[bool]] = {}
    held: dict[str, np.ndarray] = {}
    for node_id in node_ids:
        ends = attachments.get(node_id, [])
        restrained = restraints.get(node_id, (False,) * 6)
        moment = loads.get(node_id, np.zeros(6))[3:]
        support_axes = [eye[axis] for axis in range(3) if restrained[3 + axis]]
        vectors = support_axes + [
            member.axes[axis - 3] for member, end in ends for axis in (3, 4, 5) if end.laws[axis] != FREE
        ]
        basis = _span(vectors)
        projection = basis @ basis.T
        rank = basis.shape[1]
        loaded = bool(np.any(moment != 0.0))
        removed = [False, False, False]
        if rank == 0:
            removed = [bool(moment[axis] == 0.0) for axis in range(3)]
        elif rank < 3:
            in_span = [float(eye[axis] @ projection @ eye[axis]) for axis in range(3)]
            if all(min(value, 1.0 - value) < DIRECTION_TOLERANCE for value in in_span):
                removed = [bool(in_span[axis] < 0.5 and moment[axis] == 0.0) for axis in range(3)]
            elif loaded:
                unheld = moment - projection @ moment
                if np.linalg.norm(unheld) <= DIRECTION_TOLERANCE * np.linalg.norm(moment):
                    raise _unsupported(
                        f"Node '{node_id}': its rotation is held about some skew axes only and a moment acts "
                        "on it; the service cannot remove the remaining rotation exactly."
                    )
            elif _independent(
                [[member.axes[axis - 3] for axis in (3, 4, 5) if end.laws[axis] != FREE] for member, end in ends]
                + ([support_axes] if support_axes else [])
            ):
                for _, end in ends:
                    end.laws = (*end.laws[:3], FREE, FREE, FREE)
                # Only the support's restrained global axes remain held.
                basis = _span(support_axes)
                removed = [not restrained[3 + axis] for axis in range(3)]
            else:
                names = ", ".join(sorted({f"'{member.id}'" for member, _ in ends}))
                raise _unsupported(
                    f"Node '{node_id}': members {names} hold its rotation about some skew axes only; "
                    "the service cannot remove the remaining rotation exactly."
                )
        fixed[node_id] = removed
        held_vectors = list(basis.T) + [eye[axis] for axis in range(3) if removed[axis]]
        held_basis = _span(held_vectors)
        held[node_id] = held_basis @ held_basis.T
    return fixed, held


def _anchor_twist(member: Member, held: dict[str, np.ndarray]) -> None:
    """Remove the spin of a beam that is free in torsion at both ends.

    That spin is an irrelevant rotation, not a mechanism. Locking torsion at
    one end adds no stiffness and changes no result, because the other end is
    still free in torsion so no torque can develop. Prefer an end whose joint
    rotation about the member axis is held or removed, so the spin is really
    gone; then the start end.
    """
    if member.axial or member.start.laws[3] != FREE or member.end.laws[3] != FREE:
        return
    candidates = [end for end in member.ends if end.attached]
    if not candidates:
        return  # Attached to nothing: the spin is part of its rigid-body motion.
    x = member.axes[0]
    candidates.sort(key=lambda end: float(x @ held[end.node_id] @ x) < 1.0 - 1e-6)
    for end in candidates:
        laws = (*end.laws[:3], LOCKED, *end.laws[4:])
        if _representation(member, laws) is not None:
            end.laws = laws
            end.anchored = True
            return
    raise _unsupported(
        f"Member '{member.id}' is free in torsion at both ends and neither end can be anchored exactly; "
        "lock torsion at one end."
    )


# --- representation (DESIGN.md, Connection capability) ------------------------


def _aligned_axes(axes: np.ndarray) -> list[tuple[int, float]] | None:
    """Global axis index and sign of each local axis, or None for a skew member."""
    mapping = []
    for axis in axes:
        index = int(np.argmax(np.abs(axis)))
        if abs(abs(axis[index]) - 1.0) > DIRECTION_TOLERANCE:
            return None
        mapping.append((index, float(np.sign(axis[index]))))
    return mapping


def _representation(member: Member, laws: tuple[str, ...]) -> tuple[str, tuple[int, ...]] | None:
    """Representation and tied global DOFs for these laws, or None if unsupported."""
    translations, rotations = laws[:3], laws[3:]
    if all(law == FREE for law in laws):
        return UNATTACHED, ()
    if member.axial:
        if all(law == LOCKED for law in translations):
            return SHARED, ()
        if all(law != LOCKED for law in translations):
            return SPRING, ()
    else:
        if all(law == LOCKED for law in laws):
            return SHARED, ()
        if all(law == LOCKED for law in translations):
            if all(law == FREE for law in rotations):
                return BALL, (1, 2, 3)
            if rotations[0] == LOCKED and ELASTIC not in rotations:
                return RELEASE, ()
            if LOCKED not in rotations:
                return SPRING_TIED, (1, 2, 3)
        if LOCKED not in laws:
            return SPRING, ()
    aligned = _aligned_axes(member.axes)
    if aligned is None:
        return None
    tied = sorted(
        aligned[axis % 3][0] + 1 + (3 if axis >= 3 else 0) for axis in range(6) if laws[axis] == LOCKED
    )
    return ALIGNED, tuple(tied)


def _represent(member: Member, end: End, which: str) -> None:
    found = _representation(member, end.laws)
    if found is None:
        pattern = " ".join(law[0].upper() for law in end.laws)
        raise _unsupported(
            f"Member '{member.id}' {which} connection ({pattern}): this combination of locked and released "
            "axes can only be represented exactly for a member whose local axes are global axes."
        )
    end.representation, end.tied = found
    end.springs = tuple((axis + 1, end.stiffness[axis]) for axis in range(6) if end.laws[axis] == ELASTIC)


# --- components (DESIGN.md, Preparation step 6) -------------------------------


def _partition(
    node_ids: list[str],
    members: dict[str, Member],
    restraints: dict[str, tuple[bool, ...]],
    loads: dict[str, np.ndarray],
) -> tuple[list[Component], set[str]]:
    parent: dict[str, str] = {}

    def find(key: str) -> str:
        parent.setdefault(key, key)
        while parent[key] != key:
            parent[key] = parent[parent[key]]
            key = parent[key]
        return key

    def union(a: str, b: str) -> None:
        parent[find(a)] = find(b)

    joint_ids: set[str] = set()
    for member in members.values():
        find("m:" + member.id)
        for end in member.ends:
            if end.attached:
                union("m:" + member.id, "n:" + end.node_id)
                joint_ids.add(end.node_id)
    for node_id in node_ids:
        # A support that restrains nothing, or a zero load, attaches nothing.
        if any(restraints.get(node_id, ())) or np.any(loads.get(node_id, np.zeros(6)) != 0.0):
            joint_ids.add(node_id)
    for node_id in joint_ids:
        find("n:" + node_id)

    groups: dict[str, tuple[list[str], list[str]]] = {}
    for node_id in node_ids:
        if node_id in joint_ids:
            groups.setdefault(find("n:" + node_id), ([], []))[0].append(node_id)
    for member in members.values():
        groups.setdefault(find("m:" + member.id), ([], []))[1].append(member.id)

    components = []
    for nodes, member_ids in groups.values():
        nodes = sorted(nodes)
        component_id = nodes[0] if nodes else f"member:{member_ids[0]}"
        components.append(Component(component_id, nodes, member_ids))
    components.sort(key=lambda component: component.id)
    return components, joint_ids


# --- counting -----------------------------------------------------------------


def free_dofs(prepared: PreparedModel, component: Component) -> int:
    """Free DOFs of the linear (unsubdivided) analysed system of a component."""
    count = sum(6 - sum(prepared.joints[node_id].fixed) for node_id in component.node_ids)
    for member_id in component.member_ids:
        member = prepared.members[member_id]
        for end in member.ends:
            if end.representation in (SHARED, RELEASE):
                continue
            # Axial members leave the rotations of their own end nodes out.
            count += (3 if member.axial else 6) - len(end.tied)
    return count


def static_counts(prepared: PreparedModel, component: Component) -> tuple[int, int]:
    """Force unknowns and equilibrium equations of a component.

    Counted on an idealised model where every member end has its own end node
    joined to the joint through its connection axes: one unknown per locked or
    elastic axis, per member internal force (1 axial, 6 beam) and per support
    restraint; one equation per relevant DOF of joints and member end nodes.
    That makes the count independent of how OpenSees represents a connection
    and of beam subdivision. Static indeterminacy is then unknowns - equations
    + mechanisms.
    """
    unknowns = equations = 0
    for node_id in component.node_ids:
        joint = prepared.joints[node_id]
        removed = sum(1 for dof in range(6) if joint.fixed[dof] and not joint.restrained[dof])
        equations += 6 - removed
        unknowns += sum(joint.restrained)
    for member_id in component.member_ids:
        member = prepared.members[member_id]
        axes = 3 if member.axial else 6
        unknowns += 1 if member.axial else 6
        for end in member.ends:
            equations += axes
            unknowns += sum(1 for law in end.laws[:axes] if law != FREE)
    return unknowns, equations
