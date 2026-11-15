"""Compose independent OpenSees results while preserving the whole-model contract."""


def compose(scopes: list[dict], unused: list, max_modes: int) -> dict:
    results = [scope["result"] for scope in scopes]
    solved = [r for r in results if r["status"] == "success"]
    common = {"components": scopes}
    if unused:
        common["inactiveNodeIds"] = [n.id for n in unused]
    warnings = list(dict.fromkeys(w for r in results for w in r.get("warnings", [])))
    if unused:
        warnings.append(f"{len(unused)} node(s) with no members and no load were left out of the analysis.")

    # Counts on disjoint equation systems add. Keep the original global
    # shape budget even when many components each have a mechanism.
    reports = [r["stability"] for r in results if "stability" in r]
    if len(reports) == len(scopes):
        stability = {k: sum(r[k] for r in reports) for k in (
            "freeDofs", "mechanisms", "translationalMechanisms", "rotationalMechanisms", "staticIndeterminacy")}
        stability["stable"] = all(r["stable"] for r in reports)
        stability["unstableNodeIds"] = [key for r in reports for key in r["unstableNodeIds"]]
        stability["modes"] = [mode for r in reports for mode in r["modes"]][:max_modes]
        common["stability"] = stability

    if len(solved) != len(scopes):
        message = f"{len(solved)} of {len(scopes)} active components returned a response."
        if len(reports) == len(scopes) and any(r["status"] == "unstable" for r in results):
            return {**common, "status": "unstable", "message": message, "warnings": warnings}
        return {**common, "status": "unresolved", "message": message}

    quantities = {key: {k: v for r in solved for k, v in r[key].items()}
                  for key in ("displacements", "reactions", "memberForces")}
    # Retain legacy skipped-node placeholders on a wholly successful model.
    # The component scopes contain only nodes which participated in a solve.
    for node in unused:
        quantities["displacements"][node.id] = [0.] * 6
        if any(node.restrained):
            quantities["reactions"][node.id] = [0.] * 6
    if "nonlinear" in solved[0]:
        checks = [r["nonlinear"] for r in solved]
        common["nonlinear"] = {
            "segmentsPerFrame": checks[0]["segmentsPerFrame"],
            "steps": sum(c["steps"] for c in checks),
            **{k: max(c[k] for c in checks) for k in ("forceResidual", "momentResidual", "nodalResidual")},
            "cableState": {k: v for c in checks for k, v in c["cableState"].items()},
        }
    return {**common, **quantities, "status": "success", "warnings": warnings}
