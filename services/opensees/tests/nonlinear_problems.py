"""Hand-built ``nonlinear.Problem`` implementations for the driver tests.

Each problem is a small OpenSees model written out directly, so the driver
can be tested without the engine. The models are chosen so that a closed
form exists for the quantity under test; the derivations are in the tests.

Units: N, m.
"""

from __future__ import annotations

import math
from collections.abc import Callable

import numpy as np
import openseespy.opensees as ops

from dof_opensees import stability, tangent

E = 210e9
#: Column section: the default steel second moment, with an area 100 times
#: the default so axial shortening (strain at the Euler load about 6e-6)
#: cannot shift buckling loads measurably. Euler's formula is for an
#: inextensible column; this makes it the exact reference.
COLUMN_I = 4.47e-5
COLUMN_A = 0.749
COLUMN_G = 81e9
COLUMN_J = 7.03e-5
COLUMN_LENGTH = 4.0
EI = E * COLUMN_I

#: Cable and bar section for the truss problems.
CABLE_A = 1.0e-4
CABLE_EA = E * CABLE_A

TEMP_TAG_BASE = 1000

Loads = dict[int, tuple[float, ...]]


class HandBuilt:
    """A ``Problem`` whose domain is defined by a function.

    ``define`` creates the model, nodes, elements and fixities, and returns
    the reference loads ``{node: components}``. ``build`` wraps it with a
    wipe and the single ``Plain`` pattern on a ``Linear`` series that the
    driver expects.
    """

    def __init__(self, define: Callable[[], Loads], recovery_displacement_limit: float) -> None:
        self.define = define
        self.temp_tag_base = TEMP_TAG_BASE
        self.recovery_displacement_limit = recovery_displacement_limit
        self.builds = 0
        self._dofs: list[tuple[int, int]] = []

    def build(self) -> None:
        ops.wipe()
        self.loads = self.define()
        ops.timeSeries("Linear", 1)
        ops.pattern("Plain", 1, 1)
        for node, load in self.loads.items():
            ops.load(node, *load)
        self.builds += 1
        # What the domain holds straight after a build, to check later that
        # the driver left nothing of its own behind.
        self.node_tags = list(ops.getNodeTags())
        self.element_tags = list(ops.getEleTags())
        self.fixed_nodes = list(ops.getFixedNodes())
        self.builder_ndf = list(ops.getNDF())

    def assess(self) -> stability.Assessment:
        matrix = tangent.extract_tangent()
        size = matrix.shape[0]
        translation = np.zeros(size, dtype=bool)
        loads = np.zeros(size)
        dofs: list[tuple[int, int]] = [(0, 0)] * size
        for node in ops.getNodeTags():
            ndm = len(ops.nodeCoord(node))
            load = self.loads.get(node, ())
            for dof, equation in enumerate(tangent.equation_numbers(node)):
                if equation < 0:
                    continue
                dofs[equation] = (node, dof + 1)
                translation[equation] = dof < ndm
                loads[equation] = load[dof] if dof < len(load) else 0.0
        self._dofs = dofs
        return stability.assess(matrix, translation, loads)

    def equation_dofs(self) -> list[tuple[int, int]]:
        return list(self._dofs)

    def peak_displacement(self) -> float:
        peak = 0.0
        for node in ops.getNodeTags():
            ndm = len(ops.nodeCoord(node))
            peak = max(peak, math.hypot(*ops.nodeDisp(node)[:ndm]))
        return peak


# Columns (3D, elasticBeamColumn with corotational geometry) ---------------

#: Restraints (UX UY UZ RX RY RZ) at base and top of a column along Z. The
#: base always holds torsion so the member cannot spin about its axis.
COLUMN_ENDS = {
    "pinned": ((1, 1, 1, 0, 0, 1), (1, 1, 0, 0, 0, 0)),
    "cantilever": ((1, 1, 1, 1, 1, 1), (0, 0, 0, 0, 0, 0)),
    "fixed": ((1, 1, 1, 1, 1, 1), (1, 1, 0, 1, 1, 1)),
}
#: Euler load as a multiple of pi^2 EI / L^2: effective lengths L, 2L, L/2.
EULER_FACTOR = {"pinned": 1.0, "cantilever": 0.25, "fixed": 4.0}


def euler_load(ends: str) -> float:
    return EULER_FACTOR[ends] * math.pi**2 * EI / COLUMN_LENGTH**2


def column(ends: str, segments: int, axial: float, lateral: float = 0.0, bow: float = 0.0) -> HandBuilt:
    """Column along +Z, compressed by ``axial`` at the top.

    ``lateral`` is a force along +X at the top; ``bow`` the midspan amplitude
    of a sinusoidal initial imperfection along X, placed on the nodes.
    """
    base, top = COLUMN_ENDS[ends]

    def define() -> Loads:
        ops.model("basic", "-ndm", 3, "-ndf", 6)
        for k in range(segments + 1):
            z = COLUMN_LENGTH * k / segments
            ops.node(k + 1, bow * math.sin(math.pi * z / COLUMN_LENGTH), 0.0, z)
        ops.fix(1, *base)
        ops.fix(segments + 1, *top)
        ops.geomTransf("Corotational", 1, 1.0, 0.0, 0.0)
        for k in range(segments):
            ops.element(
                "elasticBeamColumn", k + 1, k + 1, k + 2,
                COLUMN_A, E, COLUMN_G, COLUMN_J, COLUMN_I, COLUMN_I, 1,
            )  # fmt: skip
        return {segments + 1: (lateral, 0.0, -axial, 0.0, 0.0, 0.0)}

    return HandBuilt(define, 0.1 * COLUMN_LENGTH / segments)


# Truss problems (2D, two DOFs per node, corotTruss) -----------------------

def _tension_only(tag: int, prestrain: float = 0.0) -> None:
    """Cable material: elastic in tension, no stiffness in compression."""
    if prestrain:
        ops.uniaxialMaterial("Elastic", tag + 100, E, 0.0, 0.0)
        ops.uniaxialMaterial("InitStrainMaterial", tag, tag + 100, prestrain)
    else:
        ops.uniaxialMaterial("Elastic", tag, E, 0.0, 0.0)


def braced_cable(load_x: float, span: float = 2.0) -> HandBuilt:
    """Node 1 at the origin, held by a cable to (span, 0), a bar to (-span, 0)
    and a bar to (0, -span). All three far ends are pinned. Element 1 is the
    cable, element 2 the collinear bar, element 3 the transverse bar.
    """

    def define() -> Loads:
        ops.model("basic", "-ndm", 2, "-ndf", 2)
        ops.node(1, 0.0, 0.0)
        ops.node(2, span, 0.0)
        ops.node(3, -span, 0.0)
        ops.node(4, 0.0, -span)
        for node in (2, 3, 4):
            ops.fix(node, 1, 1)
        _tension_only(1)
        ops.uniaxialMaterial("Elastic", 2, E)
        ops.element("corotTruss", 1, 1, 2, CABLE_A, 1)
        ops.element("corotTruss", 2, 1, 3, CABLE_A, 2)
        ops.element("corotTruss", 3, 1, 4, CABLE_A, 2)
        return {1: (load_x, 0.0)}

    return HandBuilt(define, 0.1 * span)


def straight_pair(load_y: float, prestrain: float, tension_only: bool = True, span: float = 2.0) -> HandBuilt:
    """Node 1 at the origin between two collinear members to (-span, 0) and
    (span, 0), both pinned there, each with the given initial strain.
    Loaded transversely (along -Y for a positive ``load_y``).
    """

    def define() -> Loads:
        ops.model("basic", "-ndm", 2, "-ndf", 2)
        ops.node(1, 0.0, 0.0)
        ops.node(2, -span, 0.0)
        ops.node(3, span, 0.0)
        ops.fix(2, 1, 1)
        ops.fix(3, 1, 1)
        if tension_only:
            _tension_only(1, prestrain)
        else:
            ops.uniaxialMaterial("Elastic", 101, E)
            ops.uniaxialMaterial("InitStrainMaterial", 1, 101, prestrain)
        ops.element("corotTruss", 1, 2, 1, CABLE_A, 1)
        ops.element("corotTruss", 2, 1, 3, CABLE_A, 1)
        return {1: (0.0, -load_y)}

    return HandBuilt(define, 0.1 * span)


def four_bar(lateral: float, vertical: float, width: float = 3.0, height: float = 3.0) -> HandBuilt:
    """Pin-jointed portal: two posts pinned at the ground and a top bar, no
    bracing, so it has one sway mechanism. ``lateral`` acts along +X at the
    top-left node; ``vertical`` acts downwards on both top nodes.
    """

    def define() -> Loads:
        ops.model("basic", "-ndm", 2, "-ndf", 2)
        ops.node(1, 0.0, 0.0)
        ops.node(2, width, 0.0)
        ops.node(3, 0.0, height)
        ops.node(4, width, height)
        ops.fix(1, 1, 1)
        ops.fix(2, 1, 1)
        ops.uniaxialMaterial("Elastic", 1, E)
        ops.element("corotTruss", 1, 1, 3, CABLE_A, 1)
        ops.element("corotTruss", 2, 2, 4, CABLE_A, 1)
        ops.element("corotTruss", 3, 3, 4, CABLE_A, 1)
        return {3: (lateral, -vertical), 4: (0.0, -vertical)}

    return HandBuilt(define, 0.1 * min(width, height))


def shallow_truss(load: float, half_span: float = 2.0, rise: float = 0.2) -> HandBuilt:
    """Two bars from (-half_span, 0) and (half_span, 0), pinned there, meeting
    at an apex (0, rise) loaded downwards: a von Mises truss with a limit point.
    """

    def define() -> Loads:
        ops.model("basic", "-ndm", 2, "-ndf", 2)
        ops.node(1, 0.0, rise)
        ops.node(2, -half_span, 0.0)
        ops.node(3, half_span, 0.0)
        ops.fix(2, 1, 1)
        ops.fix(3, 1, 1)
        ops.uniaxialMaterial("Elastic", 1, E)
        ops.element("corotTruss", 1, 2, 1, CABLE_A, 1)
        ops.element("corotTruss", 2, 1, 3, CABLE_A, 1)
        return {1: (0.0, -load)}

    return HandBuilt(define, 0.1 * math.hypot(half_span, rise))


#: Guyed mast (2D, three DOFs per node): the default steel section.
MAST_A = 7.49e-3
MAST_I = 4.47e-5


def guyed_mast(
    load: float, prestrain: float, height: float = 12.0, offset: float = 6.0,
    segments: int = 6, inertia: float = MAST_I,
) -> HandBuilt:  # fmt: skip
    """Mast of ``segments`` corotational beams on a fixed base at the origin,
    guyed from its top (node ``segments + 1``) by two prestrained tension-only
    cables to pinned anchors at (-offset, 0) and (offset, 0); ``load`` acts
    downwards at the top. Elements 1..segments are the mast, then the guys.
    The prestress is not self-equilibrated: the guys pull the top down.
    """

    def define() -> Loads:
        ops.model("basic", "-ndm", 2, "-ndf", 3)
        for k in range(segments + 1):
            ops.node(k + 1, 0.0, height * k / segments)
        ops.fix(1, 1, 1, 1)
        top = segments + 1
        ops.node(top + 1, -offset, 0.0)
        ops.node(top + 2, offset, 0.0)
        ops.fix(top + 1, 1, 1, 1)
        ops.fix(top + 2, 1, 1, 1)
        ops.geomTransf("Corotational", 1)
        for k in range(segments):
            ops.element("elasticBeamColumn", k + 1, k + 1, k + 2, MAST_A, E, inertia, 1)
        _tension_only(1, prestrain)
        ops.element("corotTruss", segments + 1, top + 1, top, CABLE_A, 1)
        ops.element("corotTruss", segments + 2, top + 2, top, CABLE_A, 1)
        return {top: (0.0, -load, 0.0)}

    return HandBuilt(define, 0.1 * height / segments)


#: Node positions of ``single_guy``: free top, mast foot, bar end, guy anchor.
SINGLE_GUY_NODES = {1: (0.0, 4.0), 2: (0.0, 0.0), 3: (-3.0, 4.0), 4: (3.0, 0.0)}


def single_guy(prestrain: float) -> HandBuilt:
    """Pin-jointed post (node 2 to node 1) held sideways by a horizontal bar
    (node 3 to node 1) and pulled towards (3, 0) by one prestrained cable:
    the prestress equilibrium moves node 1 both down and sideways. Elements
    1, 2, 3 are the post, the bar and the cable.
    """

    def define() -> Loads:
        ops.model("basic", "-ndm", 2, "-ndf", 2)
        for node, (x, y) in SINGLE_GUY_NODES.items():
            ops.node(node, x, y)
        for node in (2, 3, 4):
            ops.fix(node, 1, 1)
        ops.uniaxialMaterial("Elastic", 2, E)
        _tension_only(1, prestrain)
        ops.element("corotTruss", 1, 2, 1, CABLE_A, 2)
        ops.element("corotTruss", 2, 3, 1, CABLE_A, 2)
        ops.element("corotTruss", 3, 4, 1, CABLE_A, 1)
        return {}

    return HandBuilt(define, 0.1 * 3.0)


def cable_braced_portal(lateral: float, gravity: float = 0.0, width: float = 4.0, height: float = 3.0) -> HandBuilt:
    """Pin-jointed portal (posts 1-3 and 2-4, top bar 3-4) braced by one
    unstrained cable from base 1 to top 4 (element 4). ``lateral`` acts
    along +X at node 3, putting the cable in tension; ``gravity`` is split
    between the two top nodes. Without the cable it is a sway mechanism; at
    the reference the cable sits at exactly zero strain, on the kink of its
    tension-only law (audit D2).
    """

    def define() -> Loads:
        ops.model("basic", "-ndm", 2, "-ndf", 2)
        ops.node(1, 0.0, 0.0)
        ops.node(2, width, 0.0)
        ops.node(3, 0.0, height)
        ops.node(4, width, height)
        ops.fix(1, 1, 1)
        ops.fix(2, 1, 1)
        ops.uniaxialMaterial("Elastic", 2, E)
        _tension_only(1)
        ops.element("corotTruss", 1, 1, 3, CABLE_A, 2)
        ops.element("corotTruss", 2, 2, 4, CABLE_A, 2)
        ops.element("corotTruss", 3, 3, 4, CABLE_A, 2)
        ops.element("corotTruss", 4, 1, 4, CABLE_A, 1)
        return {3: (lateral, -gravity / 2.0), 4: (0.0, -gravity / 2.0)}

    return HandBuilt(define, 0.1 * min(width, height))


def fully_fixed_bar(load: float) -> HandBuilt:
    """A bar between two fully fixed nodes, loaded at one: no free DOFs."""

    def define() -> Loads:
        ops.model("basic", "-ndm", 2, "-ndf", 2)
        ops.node(1, 0.0, 0.0)
        ops.node(2, 1.0, 0.0)
        ops.fix(1, 1, 1)
        ops.fix(2, 1, 1)
        ops.uniaxialMaterial("Elastic", 1, E)
        ops.element("corotTruss", 1, 1, 2, CABLE_A, 1)
        return {2: (load, 0.0)}

    return HandBuilt(define, 0.1)
