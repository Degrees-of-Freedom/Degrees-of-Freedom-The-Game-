"""Model builders and independent reference solutions for the nonlinear acceptance tests.

Nothing in this module imports or imitates the engine. Every expected value is
derived here from mechanics: a closed form, or a small numerical solution of
the governing equation (bisection, Fourier series) written out below. The
derivation of each reference is stated next to the function that computes it.

Models are plain dicts in the JSON shape of ``StructuralModel`` in
``packages/solver-contract/src/index.ts``: SI units, global Z up, member ends
default to ``fixed``, ``pinned`` is a ball joint. Every member carries its own
``properties`` so the references do not depend on the service's default
section.

Assumptions that the contract leaves open are listed in ``ASSUMPTIONS`` and
repeated where they are used.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Iterable

import numpy as np

ASSUMPTIONS = (
    # Cable initial strain. The contract says positive initialStrain is
    # tension and the member is shorter than its nodes' distance. It does not
    # say which length the strain is measured against. The references use
    # T = EA * (eps0 + (l - a) / a), a being the reference node distance.
    # The two rest-length readings, l0 = a / (1 + eps0) or l0 = a (1 - eps0)
    # with T = EA (l - l0) / l0, were solved too for the pretensioned pair
    # case (eps0 = 2e-3, P = 5.2 kN): sag differs by at most 0.11 % and
    # tension by at most 0.12 %, inside the 1 % gate whichever is meant.
    "cable tension T = EA * (initialStrain + (l - a) / a)",
    # Strain measure. Small elastic strains (A02): engineering strain. Green
    # strain differs by a relative eps/2 (< 0.1 % here).
    "small strain: engineering strain, elastic modulus constant",
    # Beams are Euler-Bernoulli (the contract gives no shear area).
    "beams have no shear deformation",
    # Loads are dead loads: fixed global direction, no follower effect.
    "nodal loads keep their global direction",
)

# --- sections -----------------------------------------------------------------

# A slender doubly symmetric column section (radius of gyration 0.02 m). With
# L = 6 m the slenderness L/r is 300, so the axial strain at the pin-ended Euler
# load is pi^2 / 300^2 = 1.1e-4 (4.4e-4 for fixed-fixed). Pre-buckling
# shortening therefore moves a critical load by well under 0.1 %, which keeps
# the 2 % buckling gate a test of the buckling physics, not of length changes.
COLUMN_E = 210e9
COLUMN_A = 2.0e-3
COLUMN_I = 8.0e-7
COLUMN_EI = COLUMN_E * COLUMN_I
COLUMN_EA = COLUMN_E * COLUMN_A
COLUMN_SECTION = {
    "elasticModulus": COLUMN_E,
    "shearModulus": 81e9,
    "area": COLUMN_A,
    "inertiaY": COLUMN_I,
    "inertiaZ": COLUMN_I,
    "torsionConstant": 2 * COLUMN_I,
}
COLUMN_LENGTH = 6.0

# Stiff axial section for braces (leaning column, links, mechanism frames).
BRACE_E = 210e9
BRACE_A = 5.0e-3
BRACE_EA = BRACE_E * BRACE_A
BRACE_SECTION = {
    "elasticModulus": BRACE_E,
    "shearModulus": 81e9,
    "area": BRACE_A,
    "inertiaY": 1e-5,
    "inertiaZ": 1e-5,
    "torsionConstant": 2e-5,
}

CABLE_E = 160e9


def cable_section(area: float) -> dict:
    """Cable section. Bending and torsion values are required by the schema but unused for cables."""
    return {
        "elasticModulus": CABLE_E,
        "shearModulus": 60e9,
        "area": area,
        "inertiaY": 1e-10,
        "inertiaZ": 1e-10,
        "torsionConstant": 2e-10,
    }


FIXED = [True] * 6
BALL = [True, True, True, False, False, False]

# --- generic builders ---------------------------------------------------------


def node(node_id: str, position: Iterable[float]) -> dict:
    return {"id": node_id, "position": [float(v) for v in position]}


def member(member_id: str, start: str, end: str, properties: dict, kind: str = "beam", **extra) -> dict:
    item = {"id": member_id, "startNodeId": start, "endNodeId": end, "kind": kind, "properties": dict(properties)}
    item.update(extra)
    return item


def support(node_id: str, restrained: Iterable[bool]) -> dict:
    return {"nodeId": node_id, "restrained": list(restrained)}


def load(node_id: str, force: Iterable[float], moment: Iterable[float] = (0.0, 0.0, 0.0)) -> dict:
    return {"nodeId": node_id, "force": [float(v) for v in force], "moment": [float(v) for v in moment]}


def model(
    nodes: list,
    members: list,
    supports: list,
    loads: list,
    fidelity: str | None = None,
    timeout_ms: float | None = None,
) -> dict:
    """Contract-shaped model. ``fidelity=None`` leaves the contract default (nonlinear)."""
    data = {"units": "SI", "nodes": nodes, "members": members, "supports": supports, "loads": loads}
    analysis = {}
    if fidelity is not None:
        analysis["fidelity"] = fidelity
    if timeout_ms is not None:
        analysis["timeoutMs"] = timeout_ms
    if analysis:
        data["analysis"] = analysis
    return data


# --- numerical tools ----------------------------------------------------------


def bisect(f: Callable[[float], float], lo: float, hi: float, tol: float = 1e-14) -> float:
    """Root of a continuous f with a sign change on [lo, hi], to relative tolerance ``tol``."""
    flo, fhi = f(lo), f(hi)
    if flo == 0:
        return lo
    if fhi == 0:
        return hi
    if (flo > 0) == (fhi > 0):
        raise ValueError("bisect: no sign change on the bracket")
    for _ in range(400):
        mid = 0.5 * (lo + hi)
        fmid = f(mid)
        if fmid == 0 or (hi - lo) <= tol * max(abs(mid), 1e-300):
            return mid
        if (fmid > 0) == (flo > 0):
            lo, flo = mid, fmid
        else:
            hi = mid
    return 0.5 * (lo + hi)


# --- 1. column buckling ---------------------------------------------------------

# Effective length factors K in P_cr = pi^2 EI / (K L)^2 (Euler, Timoshenko and
# Gere, Theory of Elastic Stability, ch. 2). The supports below realise each
# end condition with global restraints only:
#   pinned:      base translations and twist (RZ) held, top lateral (UX, UY) held.
#   fixed_free:  base fully fixed, top free.
#   fixed_fixed: base fully fixed, top held laterally and in all rotations, free to shorten.
# The section is doubly symmetric, so both lateral planes buckle at the same
# load; that double eigenvalue is still the single critical load being tested.
# The column twist is always restrained at the base, so no spin mode exists;
# torsional buckling (P_T = GJ A / (Iy + Iz), about 1.6e8 N here) is far above
# every flexural load, so the flexural mode is the only one in range.
K_FACTOR = {"pinned": 1.0, "fixed_free": 2.0, "fixed_fixed": 0.5}

SKEW_AXIS = (1.0 / 3.0, 2.0 / 3.0, 2.0 / 3.0)  # unit vector, parallel to no global axis or plane


def euler_load(end_condition: str, ei: float = COLUMN_EI, length: float = COLUMN_LENGTH) -> float:
    return math.pi**2 * ei / (K_FACTOR[end_condition] * length) ** 2


def column_buckling_model(case: str, load_ratio: float, segments: int = 1) -> tuple[dict, dict]:
    """Perfect column loaded axially to ``load_ratio`` times its Euler load.

    ``case`` is one of ``pinned``, ``fixed_free``, ``fixed_fixed`` (column along
    +Z) or ``skew_fixed_free`` (column along ``SKEW_AXIS``). A skew column can
    only be given exact end conditions by global supports when an end is fully
    fixed or fully free, hence fixed-free on the skew axis. ``segments`` splits
    the column into that many contract members in a straight line.
    """
    skew = case.startswith("skew_")
    end_condition = case.removeprefix("skew_")
    axis = np.array(SKEW_AXIS if skew else (0.0, 0.0, 1.0))
    length = COLUMN_LENGTH
    p_cr = euler_load(end_condition)
    p = load_ratio * p_cr
    ids = [f"n{i}" for i in range(segments + 1)]
    nodes = [node(nid, axis * length * i / segments) for i, nid in enumerate(ids)]
    members = [member(f"c{i}", ids[i], ids[i + 1], COLUMN_SECTION) for i in range(segments)]
    base, top = ids[0], ids[-1]
    if end_condition == "pinned":
        supports = [support(base, [True, True, True, False, False, True]), support(top, [True, True, False, False, False, False])]
    elif end_condition == "fixed_free":
        supports = [support(base, FIXED)]
    elif end_condition == "fixed_fixed":
        supports = [support(base, FIXED), support(top, [True, True, False, True, True, True])]
    else:
        raise ValueError(case)
    loads = [load(top, -p * axis)]
    info = {"P": p, "Pcr": p_cr, "axis": axis, "base": base, "top": top, "length": length, "memberIds": [m["id"] for m in members]}
    return model(nodes, members, supports, loads), info


# --- 2. imperfect (bowed) pin-ended column -------------------------------------
#
# Reference: linear second-order (small deflection) beam-column theory with an
# initial shape w0(z). Moment equilibrium of the part below z, with the load P
# acting along the line of the two supports, gives EI w'' = -P (w0 + w), w the
# additional deflection, w(0) = w(L) = 0. Expanding w0 = sum b_k sin(k pi z/L)
# gives w = sum b_k * alpha / (k^2 - alpha) * sin(k pi z/L), alpha = P / P_e.
# For a pure half sine this is the textbook amplification
#     w_mid = e0 * alpha / (1 - alpha), total offset e0 / (1 - alpha).
# The contract can only describe a polygon of straight members, so the
# reference uses the Fourier coefficients of that polygon (exact integrals per
# chord below). With 16 chords the polygon's b_1 is 0.3 % below e0; the series
# makes the reference exact for the modelled shape instead of spending a third
# of the 1 % gate on the chord approximation.
#
# Validity: the bow is e0 = L/1000, so at alpha = 0.75 the total offset is
# L/250 and the largest slope pi/250 = 0.013. The neglected large-deflection
# terms are of relative order slope^2 (about 2e-4), and the axial strain is
# below 1e-4, so the small-deflection formula holds to well under 1 %. Load
# fractions stay at or below 0.75 because the deflection's sensitivity to any
# error in P_e is 1/(1 - alpha), which grows quickly closer to the Euler load.

BOW_SEGMENTS = 16
BOW_RATIO = 1.0 / 1000.0


def bowed_column_shape(segments: int = BOW_SEGMENTS, e0: float = COLUMN_LENGTH * BOW_RATIO, length: float = COLUMN_LENGTH):
    z = np.linspace(0.0, length, segments + 1)
    x = e0 * np.sin(np.pi * z / length)
    x[0] = x[-1] = 0.0
    return z, x


def polygon_sine_coefficients(z: np.ndarray, f: np.ndarray, length: float, kmax: int) -> np.ndarray:
    """b_k = (2/L) * integral_0^L f(z) sin(k pi z / L) dz for a piecewise-linear f, k = 1..kmax, exact per chord."""
    b = np.zeros(kmax + 1)
    for k in range(1, kmax + 1):
        w = k * math.pi / length
        total = 0.0
        for j in range(len(z) - 1):
            s = (f[j + 1] - f[j]) / (z[j + 1] - z[j])

            def antiderivative(zz, j=j, s=s):
                fz = f[j] + s * (zz - z[j])
                return -fz * math.cos(w * zz) / w + s * math.sin(w * zz) / w**2

            total += antiderivative(z[j + 1]) - antiderivative(z[j])
        b[k] = 2.0 / length * total
    return b


def bowed_column_reference(alpha: float, segments: int = BOW_SEGMENTS, kmax: int = 801) -> dict:
    """Additional midspan deflection of the polygonal bowed column at P = alpha * P_e."""
    length = COLUMN_LENGTH
    z, x = bowed_column_shape(segments)
    b = polygon_sine_coefficients(z, x, length, kmax)
    k = np.arange(kmax + 1)
    with np.errstate(divide="ignore", invalid="ignore"):
        gain = np.where(k > 0, alpha / (k.astype(float) ** 2 - alpha), 0.0)
    mid = 0.5 * length
    delta_mid = float(np.sum(b * gain * np.sin(k * math.pi * mid / length)))
    e0 = float(x[segments // 2])
    return {
        "delta_mid": delta_mid,
        "e0": e0,
        "closed_form": e0 * alpha / (1.0 - alpha),
        "total_mid": e0 + delta_mid,
    }


def bowed_column_model(alpha: float, segments: int = BOW_SEGMENTS) -> tuple[dict, dict]:
    """Pin-ended column along +Z with a half-sine bow in X, loaded to alpha * P_e."""
    if segments % 2:
        raise ValueError("an even number of segments puts a node at midspan")
    length = COLUMN_LENGTH
    p_e = euler_load("pinned")
    p = alpha * p_e
    z, x = bowed_column_shape(segments)
    ids = [f"b{i}" for i in range(segments + 1)]
    nodes = [node(nid, (x[i], 0.0, z[i])) for i, nid in enumerate(ids)]
    # Explicit orientation: the chords are almost parallel to Z, where the
    # default reference vector (global Z) would be nearly degenerate.
    members = [
        member(f"s{i}", ids[i], ids[i + 1], COLUMN_SECTION, orientation=[0.0, 1.0, 0.0]) for i in range(segments)
    ]
    supports = [
        support(ids[0], [True, True, True, False, False, True]),
        support(ids[-1], [True, True, False, False, False, False]),
    ]
    loads = [load(ids[-1], (0.0, 0.0, -p))]
    info = {"P": p, "Pe": p_e, "mid": ids[segments // 2], "midMembers": (f"s{segments // 2 - 1}", f"s{segments // 2}")}
    return model(nodes, members, supports, loads), info


# --- 3. sway cantilever and leaning-column portal --------------------------------
#
# Fixed-base cantilever of length L, constant axial compression P, lateral end
# load H, both dead loads. Small-deflection beam-column theory
# (Timoshenko and Gere, sec. 1.11): with k = sqrt(P/EI) and u = kL,
#     tip sway       D = H (tan u - u) / (P k) = H L^3 / (3 EI) * 3 (tan u - u) / u^3,
#     base moment    M = H L + P D = H tan(u) / k.
# Neglected: large-deflection terms of relative order (D/L)^2 and axial
# shortening of relative order P/EA; both below 1e-4 for the values used.


def beam_column_flexibility(p: float, ei: float, length: float) -> float:
    """Tip sway per unit lateral end load of a fixed-free column under axial compression p."""
    if p == 0:
        return length**3 / (3 * ei)
    k = math.sqrt(p / ei)
    u = k * length
    return (math.tan(u) - u) / (p * k)


def beam_column_base_moment_factor(p: float, ei: float, length: float) -> float:
    """Base moment per unit lateral end load: tan(u) / k."""
    if p == 0:
        return length
    k = math.sqrt(p / ei)
    return math.tan(k * length) / k


# First-order tip sway chosen as L/1000, small enough for the neglected terms above.
SWAY_FIRST_ORDER_RATIO = 1.0 / 1000.0


def sway_cantilever_model(alpha: float, fidelity: str | None = None) -> tuple[dict, dict]:
    """Fixed-base column along +Z with P = alpha * P_cr(fixed-free) down and H along +X at the top."""
    length = COLUMN_LENGTH
    ei = COLUMN_EI
    p = alpha * euler_load("fixed_free")
    h = SWAY_FIRST_ORDER_RATIO * length * 3 * ei / length**3
    nodes = [node("base", (0, 0, 0)), node("top", (0, 0, length))]
    members = [member("col", "base", "top", COLUMN_SECTION)]
    supports = [support("base", FIXED)]
    loads = [load("top", (h, 0.0, -p))]
    info = {
        "P": p,
        "H": h,
        "sway_nonlinear": h * beam_column_flexibility(p, ei, length),
        "base_moment_nonlinear": h * beam_column_base_moment_factor(p, ei, length),
        "sway_linear": h * length**3 / (3 * ei),
        "base_moment_linear": h * length,
        "shortening_linear": p * length / COLUMN_EA,
    }
    return model(nodes, members, supports, loads, fidelity=fidelity), info


# Leaning-column portal. Column 1 is the sway cantilever above (beam, fixed
# base, nodes a1-c1), carrying P1 and H at its top. Column 2 (a2-c2) is a
# brace with a ball-supported base: an axial-only leaning column carrying P2,
# held out of plane (UY) at its top. A horizontal brace link c1-c2 of length b
# ties the tops. Derivation (small rotations):
#   leaning column rotates rigidly by D2/L; the link tension needed to hold
#   its top is T = P2 * D2 / L;
#   link stretch: D2 - D1 = T b / EA_link;
#   column 1 carries lateral end load H + T: D1 = (H + T) f, f from
#   beam_column_flexibility(P1).
# Eliminating: c = P2 b / (L EA_link), g = P2 / (L (1 - c)),
#   D1 = H f / (1 - g f), D2 = D1 / (1 - c), T = g D1,
#   column-1 base moment M1 = (H + T) tan(u1) / k1, base shears -(H + T) and +T.
# Neglected: the link's tilt from unequal top drops and the leaning column's
# shortening, both relative 1e-4 or less here.


def leaning_portal_model(alpha1: float = 0.3, gf: float = 0.4) -> tuple[dict, dict]:
    """``alpha1`` = P1 / P_cr of column 1 alone; ``gf`` sets P2 so that g * f is about this value."""
    length = COLUMN_LENGTH
    ei = COLUMN_EI
    span = 4.0
    p1 = alpha1 * euler_load("fixed_free")
    f = beam_column_flexibility(p1, ei, length)
    p2 = gf * length / f  # before the (tiny) link-extension correction
    h = SWAY_FIRST_ORDER_RATIO * length * 3 * ei / length**3
    c = p2 * span / (length * BRACE_EA)
    g = p2 / (length * (1.0 - c))
    d1 = h * f / (1.0 - g * f)
    d2 = d1 / (1.0 - c)
    t = g * d1
    nodes = [
        node("a1", (0, 0, 0)),
        node("c1", (0, 0, length)),
        node("a2", (span, 0, 0)),
        node("c2", (span, 0, length)),
    ]
    members = [
        member("col1", "a1", "c1", COLUMN_SECTION),
        member("col2", "a2", "c2", BRACE_SECTION, kind="brace"),
        member("link", "c1", "c2", BRACE_SECTION, kind="brace"),
    ]
    supports = [
        support("a1", FIXED),
        support("a2", BALL),
        support("c2", [False, True, False, False, False, False]),
    ]
    loads = [load("c1", (h, 0.0, -p1)), load("c2", (0.0, 0.0, -p2))]
    info = {
        "P1": p1,
        "P2": p2,
        "H": h,
        "D1": d1,
        "D2": d2,
        "T": t,
        "M1": (h + t) * beam_column_base_moment_factor(p1, ei, length),
        "amplification_vs_first_order": d1 / (h * length**3 / (3 * ei)),
    }
    return model(nodes, members, supports, loads), info


# --- 5. cables -------------------------------------------------------------------


def taut_cable_model() -> tuple[dict, dict]:
    """Vertical hanging cable: top fixed, bottom node held laterally, weight W at the bottom.

    Statically determinate: T = W, and the bottom moves down by W L / EA
    (engineering strain; the only nonlinearity is the tension-only law, which
    is inactive in tension).
    """
    length = 3.0
    area = 1e-4
    w = 20e3
    nodes = [node("top", (0, 0, length)), node("bot", (0, 0, 0))]
    members = [member("cab", "top", "bot", cable_section(area), kind="cable")]
    supports = [support("top", FIXED), support("bot", [True, True, False, False, False, False])]
    loads = [load("bot", (0, 0, -w))]
    return model(nodes, members, supports, loads), {"W": w, "elongation": w * length / (CABLE_E * area)}


# Cantilever beam along X (a at the origin, tip b at x = L) with a vertical
# cable from b down to a fixed anchor c. Load P_tip at b along Z.
#   downward (sign -1): the cable would shorten, so it is slack; the beam alone
#     carries P: tip deflection P L^3 / (3 EI), base moment P L, cable force 0.
#   upward (sign +1): the cable stretches and acts in parallel with the beam:
#     k_b = 3 EI / L^3, k_c = EA / h, tip = P / (k_b + k_c), T = k_c * tip.
# Tip deflections are about L/3000, so geometric nonlinearity is negligible
# (no axial force in the beam, cable stays vertical to within 1e-4 rad).
SLACK_BEAM_LENGTH = 3.0
SLACK_CABLE_HEIGHT = 2.0
SLACK_CABLE_AREA = 1e-6
SLACK_LOAD = 50.0


def beam_with_tie_model(sign: int, fidelity: str | None = None) -> tuple[dict, dict]:
    length, height, p = SLACK_BEAM_LENGTH, SLACK_CABLE_HEIGHT, SLACK_LOAD
    nodes = [node("a", (0, 0, 0)), node("b", (length, 0, 0)), node("c", (length, 0, -height))]
    members = [
        member("beam", "a", "b", COLUMN_SECTION),
        member("tie", "c", "b", cable_section(SLACK_CABLE_AREA), kind="cable"),
    ]
    supports = [support("a", FIXED), support("c", FIXED)]
    loads = [load("b", (0, 0, sign * p))]
    k_b = 3 * COLUMN_EI / length**3
    k_c = CABLE_E * SLACK_CABLE_AREA / height
    if sign < 0:
        tip, tension = -p / k_b, 0.0
    else:
        tip = p / (k_b + k_c)
        tension = k_c * tip
    return model(nodes, members, supports, loads, fidelity=fidelity), {
        "P": p,
        "tip": tip,
        "T": tension,
        "base_moment": (p - tension) * length,
    }


# Cable pair: two collinear cables a-b and b-c of length a along X, anchors a
# and c held in translation, node b loaded transversely by P along -Z. By
# symmetry b moves only along -Z, by d. With l = sqrt(a^2 + d^2):
#     T(d) = EA * (eps0 + (l - a) / a)      (see ASSUMPTIONS)
#     vertical equilibrium of b: P = 2 T d / l.
# The right-hand side increases monotonically with d (for eps0 >= 0), so the
# root is unique and is found by bisection. Anchor reactions: horizontal
# -/+ T a / l, vertical P / 2 each.
CABLE_PAIR_HALF_SPAN = 5.0
CABLE_PAIR_AREA = 1e-4


def cable_pair_reference(p: float, eps0: float, ea: float = CABLE_E * CABLE_PAIR_AREA, a: float = CABLE_PAIR_HALF_SPAN) -> dict:
    def tension(d):
        return ea * (eps0 + (math.hypot(a, d) - a) / a)

    def residual(d):
        return 2.0 * tension(d) * d / math.hypot(a, d) - p

    d = bisect(residual, 0.0, a)
    l = math.hypot(a, d)
    t = tension(d)
    return {"d": d, "T": t, "l": l, "Rx": t * a / l, "Rz": p / 2.0}


def cable_pair_model(p: float, eps0: float, timeout_ms: float | None = None) -> tuple[dict, dict]:
    a = CABLE_PAIR_HALF_SPAN
    section = cable_section(CABLE_PAIR_AREA)
    nodes = [node("a", (0, 0, 0)), node("b", (a, 0, 0)), node("c", (2 * a, 0, 0))]
    extra = {"initialStrain": eps0} if eps0 else {}
    members = [
        member("left", "a", "b", section, kind="cable", **extra),
        member("right", "b", "c", section, kind="cable", **extra),
    ]
    supports = [support("a", BALL), support("c", BALL)]
    loads = [load("b", (0, 0, -p))]
    return model(nodes, members, supports, loads, timeout_ms=timeout_ms), cable_pair_reference(p, eps0)


# --- 6. mechanisms -------------------------------------------------------------------


def pin_jointed_frame_model(loading: str, offset_x: float = 0.0) -> dict:
    """Unbraced pin-jointed portal of braces: two posts and a top chord, ball supports at the base.

    The tops are held out of plane (UY) so the only mechanism is the in-plane
    sway (a parallelogram). ``loading``: ``lateral`` (H along +X at one top),
    ``vertical`` (equal downward loads on both tops) or ``none``.
    """
    span, height = 4.0, 3.0
    p = lambda name: f"m_{name}"  # noqa: E731 - short id prefix
    nodes = [
        node(p("a"), (offset_x, 0, 0)),
        node(p("b"), (offset_x + span, 0, 0)),
        node(p("c"), (offset_x, 0, height)),
        node(p("d"), (offset_x + span, 0, height)),
    ]
    members = [
        member(p("ac"), p("a"), p("c"), BRACE_SECTION, kind="brace"),
        member(p("bd"), p("b"), p("d"), BRACE_SECTION, kind="brace"),
        member(p("cd"), p("c"), p("d"), BRACE_SECTION, kind="brace"),
    ]
    out_of_plane = [False, True, False, False, False, False]
    supports = [support(p("a"), BALL), support(p("b"), BALL), support(p("c"), out_of_plane), support(p("d"), out_of_plane)]
    if loading == "lateral":
        loads = [load(p("c"), (1000.0, 0, 0))]
    elif loading == "vertical":
        loads = [load(p("c"), (0, 0, -1000.0)), load(p("d"), (0, 0, -1000.0))]
    elif loading == "none":
        loads = []
    else:
        raise ValueError(loading)
    return model(nodes, members, supports, loads)


def independent_cantilever(offset_x: float) -> tuple[list, list, list, list, dict]:
    """Horizontal cantilever along +Y with a small downward tip load and no axial force.

    Reference: tip deflection P L^3 / (3 EI), base reactions Fz = P and moment
    P L. Tip deflection L/2000, so large-deflection terms are below 1e-5
    relative.
    """
    length = 3.0
    p = 3 * COLUMN_EI * (length / 2000.0) / length**3
    nodes = [node("k_base", (offset_x, 0, 0)), node("k_tip", (offset_x, length, 0))]
    members = [member("k_beam", "k_base", "k_tip", COLUMN_SECTION)]
    supports = [support("k_base", FIXED)]
    loads = [load("k_tip", (0, 0, -p))]
    return nodes, members, supports, loads, {"P": p, "tip": -p * length**3 / (3 * COLUMN_EI), "M": p * length}
