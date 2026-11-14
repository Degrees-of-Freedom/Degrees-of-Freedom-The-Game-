"""Model builders, transforms and checkers for the independent acceptance tests.

Everything here is engine-independent: it builds plain contract-shaped dicts
and compares numbers. Expected values live in the test files, each with its
closed-form derivation next to it. The one thing this module restates from
the contract is the local-axis rule (``local_axes``), which the tests use to
decide which principal axis a load excites.

Units are SI (N, m, rad). Z is up.

Reference section (explicit on every member so the tests do not depend on the
service's default section):

    E = 2.0e11 Pa, G = 8.0e10 Pa, A = 1.0e-2 m^2, Iy = Iz = 1.0e-4 m^4,
    J = 2.0e-4 m^4  ->  EA = 2.0e9 N, EI = 2.0e7 N m^2, GJ = 1.6e7 N m^2.

Beams are Euler-Bernoulli: the contract has no shear area, so shear
deformation is not part of the model and the closed forms below omit it.
"""

from __future__ import annotations

import copy
import math
from typing import Any, Iterable, Sequence

import numpy as np

from dof_opensees.engine import analyze
from dof_opensees.schema import StructuralModel

# --- reference section -------------------------------------------------------

E = 2.0e11
G = 8.0e10
A = 1.0e-2
I = 1.0e-4  # noqa: E741 - second moment of area, as in the textbooks
J = 2.0e-4
EA = E * A
EI = E * I
GJ = G * J

# Relative gate for nonzero linear analytical quantities. The solver criteria
# allow 0.1% (1e-3); the tests use ten times tighter so a pass has margin.
REL = 1.0e-4
# Gate when a case is run at nonlinear fidelity with small displacements: the
# geometric correction is O(delta/L)^2 ~ 1e-5, well inside 0.1%.
REL_NL = 1.0e-3


def flags(pattern: str) -> tuple[bool, ...]:
    """``flags("TTTFFF")`` -> six restraint booleans."""
    assert len(pattern) == 6 and set(pattern) <= {"T", "F"}, pattern
    return tuple(c == "T" for c in pattern)


FIXED = flags("TTTTTT")
PIN = flags("TTTFFF")

X_AXIS = np.array([1.0, 0.0, 0.0])
Y_AXIS = np.array([0.0, 1.0, 0.0])
Z_AXIS = np.array([0.0, 0.0, 1.0])


def unit(v: Iterable[float]) -> np.ndarray:
    a = np.asarray(list(v), dtype=float)
    return a / np.linalg.norm(a)


# --- model building ---------------------------------------------------------


def section(**override: float) -> dict:
    """Resolved member properties; override any field by contract name."""
    s = dict(
        elasticModulus=E,
        shearModulus=G,
        area=A,
        inertiaY=I,
        inertiaZ=I,
        torsionConstant=J,
    )
    s.update(override)
    return s


def conn(laws: str, stiffness: Sequence[float] | None = None) -> dict:
    """``conn("LLLFFF")`` -> a six-axis connection. L locked, F free, E elastic."""
    mapping = {"L": "locked", "F": "free", "E": "elastic"}
    assert len(laws) == 6 and set(laws) <= set(mapping), laws
    out: dict[str, Any] = {"laws": [mapping[c] for c in laws]}
    if stiffness is not None:
        out["stiffness"] = [float(k) for k in stiffness]
    return out


def member(
    mid: str,
    start: str,
    end: str,
    *,
    kind: str = "beam",
    props: dict | None = None,
    orientation: Sequence[float] | None = None,
    start_fixity: str | None = None,
    end_fixity: str | None = None,
    start_connection: dict | None = None,
    end_connection: dict | None = None,
    initial_strain: float | None = None,
) -> dict:
    m: dict[str, Any] = {
        "id": mid,
        "startNodeId": start,
        "endNodeId": end,
        "kind": kind,
        "properties": copy.deepcopy(props) if props is not None else section(),
    }
    if orientation is not None:
        m["orientation"] = [float(c) for c in orientation]
    if start_fixity is not None:
        m["startFixity"] = start_fixity
    if end_fixity is not None:
        m["endFixity"] = end_fixity
    if start_connection is not None:
        m["startConnection"] = start_connection
    if end_connection is not None:
        m["endConnection"] = end_connection
    if initial_strain is not None:
        m["initialStrain"] = initial_strain
    return m


def build(
    nodes: dict[str, Sequence[float]],
    members: list[dict],
    supports: dict[str, Sequence[bool]] | None = None,
    loads: dict[str, Sequence[float]] | None = None,
    *,
    fidelity: str = "linear",
    self_weight: bool = False,
    **analysis: Any,
) -> dict:
    """Contract-shaped model dict. Loads are ``(Fx, Fy, Fz[, Mx, My, Mz])``."""
    load_list = []
    for nid, vec in (loads or {}).items():
        vec = list(vec)
        force, moment = vec[:3], (vec[3:6] if len(vec) > 3 else [0.0, 0.0, 0.0])
        load_list.append({"nodeId": nid, "force": [float(c) for c in force], "moment": [float(c) for c in moment]})
    opts = {"fidelity": fidelity, "selfWeight": self_weight}
    opts.update(analysis)
    return {
        "units": "SI",
        "nodes": [{"id": nid, "position": [float(c) for c in pos]} for nid, pos in nodes.items()],
        "members": members,
        "supports": [{"nodeId": nid, "restrained": list(f)} for nid, f in (supports or {}).items()],
        "loads": load_list,
        "analysis": opts,
    }


def combine(*models: dict) -> dict:
    """Union of independent models (ids must not clash). Analysis options of the first win."""
    out = copy.deepcopy(models[0])
    for extra in models[1:]:
        extra = copy.deepcopy(extra)
        for key in ("nodes", "members", "supports", "loads"):
            out[key].extend(extra[key])
    return out


def solve(model: dict) -> dict:
    return analyze(StructuralModel.model_validate(model))


# --- result access ----------------------------------------------------------


def disp(result: dict, nid: str) -> np.ndarray:
    return np.asarray(result["displacements"][nid], dtype=float)


def reac(result: dict, nid: str) -> np.ndarray:
    return np.asarray(result["reactions"][nid], dtype=float)


def forces(result: dict, mid: str) -> dict:
    return result["memberForces"][mid]


def comp(result: dict, cid: str) -> dict:
    found = [c for c in result["components"] if c["id"] == cid]
    assert len(found) == 1, f"component {cid!r} not found among {[c['id'] for c in result['components']]}"
    return found[0]


def comp_with_node(result: dict, nid: str) -> dict:
    found = [c for c in result["components"] if nid in c["nodeIds"]]
    assert len(found) == 1, f"node {nid!r} is in {len(found)} components"
    return found[0]


def require_success(result: dict, what: str = "model") -> dict:
    assert result["status"] == "success", (
        f"{what}: expected status 'success', got {result['status']!r}: {result.get('message')!r}; "
        f"components={[(c['id'], c['state'], c['reasonCodes']) for c in result.get('components', [])]}"
    )
    return result


# --- numeric checks ---------------------------------------------------------


def check(label: str, actual: float, expected: float, rel: float = REL, abs_tol: float = 0.0) -> None:
    """Pass if |actual - expected| <= max(rel * |expected|, abs_tol)."""
    actual, expected = float(actual), float(expected)
    err = abs(actual - expected)
    allowed = max(rel * abs(expected), abs_tol)
    rel_err = err / abs(expected) if expected != 0.0 else math.inf
    assert err <= allowed, (
        f"{label}: got {actual:.9g}, expected {expected:.9g}; error {err:.3g} "
        f"(relative {rel_err:.3g}) exceeds the gate max(rel {rel:g} x |expected|, abs {abs_tol:g}) = {allowed:.3g}"
    )


def check_vec(label: str, actual: Iterable[float], expected: Iterable[float], rel: float = REL, abs_tol: float = 0.0) -> None:
    a, e = np.asarray(list(actual), dtype=float), np.asarray(list(expected), dtype=float)
    assert a.shape == e.shape, f"{label}: shape {a.shape} != {e.shape}"
    for i, (x, y) in enumerate(zip(a, e)):
        check(f"{label}[{i}]", x, y, rel, abs_tol)


def check_zero(label: str, actual: float, scale: float, frac: float = 1.0e-6, scale_name: str = "characteristic scale") -> None:
    """An expected zero must stay below ``frac`` times a stated characteristic scale."""
    bound = frac * abs(scale)
    assert abs(float(actual)) <= bound, (
        f"{label}: expected 0, got {float(actual):.6g}, which exceeds {frac:g} x {scale_name} ({abs(scale):.6g}) = {bound:.3g}"
    )


# --- contract local axes ----------------------------------------------------


def local_axes(start: Sequence[float], end: Sequence[float], orientation: Sequence[float] | None = None):
    """Contract rule: x start->end; y = part of ``orientation`` perpendicular to x
    (default global Z, or global X for a member parallel to Z); z = x cross y."""
    x = unit(np.asarray(end, float) - np.asarray(start, float))
    if orientation is None:
        ref = X_AXIS if abs(float(x @ Z_AXIS)) > 1.0 - 1e-12 else Z_AXIS
    else:
        ref = np.asarray(orientation, float)
    y = ref - (ref @ x) * x
    y = y / np.linalg.norm(y)
    z = np.cross(x, y)
    return x, y, z


# --- transforms: rotation, reflection, translation --------------------------


def rotation_matrix(axis: Sequence[float], angle: float) -> np.ndarray:
    """Rodrigues rotation about an arbitrary axis (right-handed)."""
    k = unit(axis)
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + math.sin(angle) * K + (1 - math.cos(angle)) * (K @ K)


def with_explicit_orientation(model: dict) -> dict:
    """Write the contract's default orientation onto every member that lacks one,
    so that rotating the model also rotates the local axes."""
    out = copy.deepcopy(model)
    pos = {n["id"]: n["position"] for n in out["nodes"]}
    for m in out["members"]:
        if "orientation" not in m:
            _, y, _ = local_axes(pos[m["startNodeId"]], pos[m["endNodeId"]])
            m["orientation"] = [float(c) for c in y]
    return out


def _signed_diagonal(Q: np.ndarray) -> bool:
    return bool(np.allclose(Q, np.diag(np.diag(Q))) and np.allclose(np.abs(np.diag(Q)), 1.0))


def transform_model(model: dict, Q: np.ndarray, shift: Sequence[float] = (0.0, 0.0, 0.0)) -> dict:
    """Apply the orthogonal map ``p' = Q p + shift`` to the whole model.

    Forces map as Q f; moments (axial vectors) map as det(Q) Q m. Member
    orientation vectors map as Q o. Per-axis restraint flags do not rotate, so
    unless Q is a signed diagonal map (axis flips) every support must restrain
    all six DOFs or exactly the three translations.
    """
    out = copy.deepcopy(model)
    d = float(np.linalg.det(Q))
    shift = np.asarray(shift, float)
    for n in out["nodes"]:
        n["position"] = [float(c) for c in Q @ np.asarray(n["position"]) + shift]
    for ld in out["loads"]:
        ld["force"] = [float(c) for c in Q @ np.asarray(ld["force"])]
        ld["moment"] = [float(c) for c in d * (Q @ np.asarray(ld["moment"]))]
    for m in out["members"]:
        if "orientation" in m:
            m["orientation"] = [float(c) for c in Q @ np.asarray(m["orientation"])]
    if not _signed_diagonal(Q):
        for s in out["supports"]:
            r = s["restrained"]
            uniform = len(set(r[:3])) == 1 and len(set(r[3:])) == 1
            assert uniform, f"support at {s['nodeId']} has per-axis flags {r}, which do not rotate"
    return out


def transform_vec6(v: Sequence[float], Q: np.ndarray) -> np.ndarray:
    """Transform a (translation, rotation) or (force, moment) six-vector under Q."""
    v = np.asarray(v, float)
    d = float(np.linalg.det(Q))
    return np.concatenate([Q @ v[:3], d * (Q @ v[3:])])


def rename_model(model: dict, node_map: dict[str, str], member_map: dict[str, str]) -> dict:
    out = copy.deepcopy(model)
    for n in out["nodes"]:
        n["id"] = node_map[n["id"]]
    for m in out["members"]:
        m["id"] = member_map[m["id"]]
        m["startNodeId"] = node_map[m["startNodeId"]]
        m["endNodeId"] = node_map[m["endNodeId"]]
    for s in out["supports"]:
        s["nodeId"] = node_map[s["nodeId"]]
    for ld in out["loads"]:
        ld["nodeId"] = node_map[ld["nodeId"]]
    return out


# --- shared reference solutions ---------------------------------------------


def cantilever_reference(t: Sequence[float], n: Sequence[float], length: float, load: float, ei: float = EI) -> dict:
    """Tip load ``load`` along unit ``n`` (perpendicular to axis ``t``) on a cantilever.

    Euler-Bernoulli: tip deflection w = P L^3 / (3 EI) along n; tip slope
    w' = P L^2 / (2 EI). Rotation vector of the tip: theta = w' (t x n), because
    the tangent t moves to t + w' n and d t = theta x t gives theta = t x (w' n).
    Root reaction: force -P n; moment -(L t) x (P n) = -P L (t x n).
    """
    t, n = unit(t), unit(n)
    assert abs(float(t @ n)) < 1e-12, "load direction must be perpendicular to the member axis"
    return {
        "tip_u": load * length**3 / (3 * ei) * n,
        "tip_theta": load * length**2 / (2 * ei) * np.cross(t, n),
        "reaction_force": -load * n,
        "reaction_moment": -load * length * np.cross(t, n),
        "shear": load,
        "root_moment": load * length,
    }


def cantilever_model(
    t: Sequence[float],
    length: float,
    force: Sequence[float] = (0.0, 0.0, 0.0),
    moment: Sequence[float] = (0.0, 0.0, 0.0),
    *,
    fidelity: str = "linear",
    prefix: str = "",
    origin: Sequence[float] = (0.0, 0.0, 0.0),
    **member_kwargs: Any,
) -> dict:
    """Fixed root ``{prefix}a`` at ``origin``, tip ``{prefix}b`` loaded, one member ``{prefix}ab``."""
    t = unit(t)
    o = np.asarray(origin, float)
    a, b = f"{prefix}a", f"{prefix}b"
    return build(
        {a: o, b: o + length * t},
        [member(f"{prefix}ab", a, b, **member_kwargs)],
        {a: FIXED},
        {b: (*force, *moment)},
        fidelity=fidelity,
    )
