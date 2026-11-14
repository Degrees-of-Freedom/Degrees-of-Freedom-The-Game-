"""Small builders so tests read like the structure they describe."""

from __future__ import annotations

from dof_opensees.engine import analyze
from dof_opensees.properties import STEEL_MEMBER
from dof_opensees.schema import StructuralModel

P = STEEL_MEMBER
EA = P.elastic_modulus * P.area
EI = P.elastic_modulus * P.second_moment
GJ = P.shear_modulus * P.torsion_constant

FIXED = [True] * 6
PINNED = [True, True, True, False, False, False]


def model(nodes: dict, members: list, supports: dict | None = None, loads: dict | None = None) -> dict:
    """Build a contract-shaped model.

    nodes: ``{id: (x, y, z)}``. members: ``(start, end)`` or
    ``(start, end, startFixity, endFixity)``; ids are ``"start-end"``.
    supports: ``{node: [six flags]}``. loads: ``{node: (Fx, Fy, Fz[, Mx, My, Mz])}``.
    """
    member_dicts = []
    for member in members:
        start, end, *fixity = member
        item = {"id": f"{start}-{end}", "startNodeId": start, "endNodeId": end}
        if fixity:
            item["startFixity"], item["endFixity"] = fixity
        member_dicts.append(item)
    return {
        "units": "SI",
        "nodes": [{"id": key, "position": list(position)} for key, position in nodes.items()],
        "members": member_dicts,
        "supports": [{"nodeId": key, "restrained": flags} for key, flags in (supports or {}).items()],
        "loads": [
            {"nodeId": key, "force": list(load[:3]), "moment": list(load[3:]) or [0, 0, 0]}
            for key, load in (loads or {}).items()
        ],
    }


def run(*args, **kwargs) -> dict:
    return analyze(StructuralModel.model_validate(model(*args, **kwargs)))
