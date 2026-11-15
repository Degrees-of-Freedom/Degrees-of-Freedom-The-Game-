"""Small builders so tests read like the structure they describe."""

from __future__ import annotations

from dof_opensees.engine import analyze
from dof_opensees.properties import STEEL_MEMBER
from dof_opensees.schema import StructuralModel

P = STEEL_MEMBER
EA = P.elastic_modulus * P.area
EI = P.elastic_modulus * P.inertia_y
GJ = P.shear_modulus * P.torsion_constant

FIXED = [True] * 6
PINNED = [True, True, True, False, False, False]
LINEAR = {"fidelity": "linear"}


def member(start: str, end: str, **fields) -> dict:
    """A member dict with id ``start-end``; keyword fields are contract fields."""
    return {"id": f"{start}-{end}", "startNodeId": start, "endNodeId": end, **fields}


def model(
    nodes: dict,
    members: list,
    supports: dict | None = None,
    loads: dict | None = None,
    analysis: dict | None = None,
) -> dict:
    """Build a contract-shaped model.

    nodes: ``{id: (x, y, z)}``. members: dicts (see :func:`member`), or
    ``(start, end)`` / ``(start, end, startFixity, endFixity)`` tuples with id
    ``"start-end"``. supports: ``{node: [six flags]}``. loads:
    ``{node: (Fx, Fy, Fz[, Mx, My, Mz])}``.
    """
    member_dicts = []
    for item in members:
        if isinstance(item, dict):
            member_dicts.append(item)
            continue
        start, end, *fixity = item
        fields = {"startFixity": fixity[0], "endFixity": fixity[1]} if fixity else {}
        member_dicts.append(member(start, end, **fields))
    body = {
        "units": "SI",
        "nodes": [{"id": key, "position": list(position)} for key, position in nodes.items()],
        "members": member_dicts,
        "supports": [{"nodeId": key, "restrained": flags} for key, flags in (supports or {}).items()],
        "loads": [
            {"nodeId": key, "force": list(load[:3]), "moment": list(load[3:]) or [0, 0, 0]}
            for key, load in (loads or {}).items()
        ],
    }
    if analysis is not None:
        body["analysis"] = analysis
    return body


def run(*args, analysis: dict | None = LINEAR, **kwargs) -> dict:
    """Analyse a model built by :func:`model`; linear fidelity unless told otherwise."""
    return analyze(StructuralModel.model_validate(model(*args, analysis=analysis, **kwargs)))


def component(result: dict, node_id: str) -> dict:
    """The component of a result that contains a node."""
    return next(item for item in result["components"] if node_id in item["nodeIds"])
