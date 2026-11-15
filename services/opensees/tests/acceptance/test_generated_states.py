"""Robustness of ``analyze`` over seeded, generated game states.

Invariants checked hold whatever the physics (solver criteria A07, A08 and
section 5): no exceptions, finite JSON, a well-formed result body, status
aggregation, result presence only for valid components, force balance per valid
component, and determinism.

Environment:

* ``DOF_GENERATED_STATES``: number of states (default 300; the acceptance gate is 10000).
* ``DOF_GENERATED_SEED``: run only this one seed (valid state, then the invalid
  state with the same seed), printing the model and result on failure.
* ``DOF_GENERATED_BASE_SEED``: first seed of the range (default 0).
"""

from __future__ import annotations

import copy
import json
import math
import os
import sys
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from accept_generators import (  # noqa: E402
    DEFAULT_WEIGHT_PER_LENGTH,
    INVALID_KINDS,
    generate_invalid_state,
    generate_state,
    state_family,
    invalid_kind,
)
from dof_opensees.engine import analyze  # noqa: E402
from dof_opensees.schema import StructuralModel  # noqa: E402

N_STATES = int(os.environ.get("DOF_GENERATED_STATES", "300"))
BASE_SEED = int(os.environ.get("DOF_GENERATED_BASE_SEED", "0"))
ONE_SEED = os.environ.get("DOF_GENERATED_SEED")
DETERMINISM_EVERY = 10
DETERMINISM_TIMEOUT_MS = 60000.0

STATUSES = {"success", "unstable", "unresolved", "unsupported", "error"}
STATES = {"stable", "marginal", "unstable", "unknown"}
REASON_CODES = {
    "unsupported_component",
    "rigid_body_mechanism",
    "internal_mechanism",
    "near_mechanism",
    "load_induced_instability",
    "geometrically_stiffened",
    "excessive_deformation",
    "cable_slack",
    "not_converged",
    "timeout",
    "equilibrium_not_verified",
    "non_finite_result",
    "solver_error",
}
BODY_KEYS = ("analysis", "components", "displacements", "reactions", "memberForces", "stability", "warnings")
RESIDUAL_LIMIT = 1e-5
BALANCE_TOLERANCE = 1e-5
CABLE_TENSION_TOLERANCE = 1e-6  # N; a cable may not report compression beyond round-off


# --------------------------------------------------------------------------- checks


def _strip_runtime(result: dict) -> dict:
    stripped = json.loads(json.dumps(result, allow_nan=False))
    if isinstance(stripped.get("analysis"), dict):
        stripped["analysis"].pop("runtimeMs", None)
    return stripped


def _run(model: dict) -> tuple[dict | None, str | None]:
    """Validate shape, then analyse. Returns (result, problem)."""
    try:
        parsed = StructuralModel.model_validate(model)
    except Exception as exc:  # generators must only produce schema-valid dicts
        return None, f"generator produced a schema-invalid model: {exc}"
    try:
        return analyze(parsed), None
    except Exception as exc:
        return None, f"analyze raised {type(exc).__name__}: {exc}"


def _force_balance(model: dict, result: dict, comp: dict) -> str | None:
    node_ids = set(comp["nodeIds"])
    member_ids = set(comp["memberIds"])
    nodes = {n["id"]: n["position"] for n in model["nodes"]}
    applied = [0.0, 0.0, 0.0]
    for load in model["loads"]:
        if load["nodeId"] in node_ids:
            for axis in range(3):
                applied[axis] += load["force"][axis]
    if (model.get("analysis") or {}).get("selfWeight"):
        for member in model["members"]:
            if member["id"] not in member_ids:
                continue
            props = member.get("properties") or {}
            weight = props.get("weightPerLength")
            if weight is None:
                weight = DEFAULT_WEIGHT_PER_LENGTH if not props else 0.0
            length = math.dist(nodes[member["startNodeId"]], nodes[member["endNodeId"]])
            applied[2] -= weight * length
    reaction = [0.0, 0.0, 0.0]
    for node_id, vector in result["reactions"].items():
        if node_id in node_ids:
            for axis in range(3):
                reaction[axis] += vector[axis]
    scale = max(math.hypot(*applied), math.hypot(*reaction))
    out = math.hypot(*(applied[a] + reaction[a] for a in range(3)))
    if out > BALANCE_TOLERANCE * scale + 1e-9:
        return (
            f"component {comp['id']}: force balance off by {out:.6g} N "
            f"(applied {applied}, reactions {reaction}, scale {scale:.6g})"
        )
    return None


def check_result(model: dict, result: dict) -> list[str]:
    """All invariant violations found in ``result`` for ``model`` (empty when sound)."""
    problems: list[str] = []
    try:
        json.dumps(result, allow_nan=False)
    except (ValueError, TypeError) as exc:
        return [f"result is not finite JSON: {exc}"]

    status = result.get("status")
    if status not in STATUSES:
        return [f"unknown status {status!r}"]
    if status in ("unsupported", "error"):
        message = result.get("message")
        if not isinstance(message, str) or not message.strip():
            problems.append(f"{status} result without a message")
        return problems
    if status in ("unstable", "unresolved") and not (isinstance(result.get("message"), str) and result["message"]):
        problems.append(f"{status} result without a message")

    for key in BODY_KEYS:
        if key not in result:
            problems.append(f"missing body key {key!r}")
    if problems:
        return problems

    node_ids = {n["id"] for n in model["nodes"]}
    member_by_id = {m["id"]: m for m in model["members"]}
    components = result["components"]

    seen_nodes: dict[str, str] = {}
    seen_members: dict[str, str] = {}
    valid_nodes: set[str] = set()
    valid_members: set[str] = set()
    states = []
    for comp in components:
        cid = comp.get("id")
        state = comp.get("state")
        states.append(state)
        if state not in STATES:
            problems.append(f"component {cid}: bad state {state!r}")
        for code in comp.get("reasonCodes", []):
            if code not in REASON_CODES:
                problems.append(f"component {cid}: unknown reason code {code!r}")
        if "reasonCodes" not in comp:
            problems.append(f"component {cid}: no reasonCodes")
        valid = comp.get("resultsValid")
        if valid is not (state in ("stable", "marginal")):
            problems.append(f"component {cid}: resultsValid={valid!r} with state {state!r}")
        for nid in comp.get("nodeIds", []):
            if nid not in node_ids:
                problems.append(f"component {cid}: unknown node {nid!r}")
            if nid in seen_nodes:
                problems.append(f"node {nid!r} in components {seen_nodes[nid]!r} and {cid!r}")
            seen_nodes[nid] = cid
        for mid in comp.get("memberIds", []):
            if mid not in member_by_id:
                problems.append(f"component {cid}: unknown member {mid!r}")
            if mid in seen_members:
                problems.append(f"member {mid!r} in components {seen_members[mid]!r} and {cid!r}")
            seen_members[mid] = cid
        if valid:
            valid_nodes.update(comp.get("nodeIds", []))
            valid_members.update(comp.get("memberIds", []))
            residual = comp.get("residual")
            if residual is not None and not residual <= RESIDUAL_LIMIT:
                problems.append(f"component {cid}: residual {residual} above {RESIDUAL_LIMIT}")

    expected = "unstable" if "unstable" in states else "unresolved" if "unknown" in states else "success"
    if status != expected:
        problems.append(f"status {status!r} but component states {states} imply {expected!r}")

    for name in ("displacements", "reactions"):
        for nid in result[name]:
            if nid not in valid_nodes:
                problems.append(f"{name} entry for {nid!r}, which is not a node of a valid component")
    for mid in result["memberForces"]:
        if mid not in valid_members:
            problems.append(f"memberForces entry for {mid!r}, which is not a member of a valid component")
    for mid in valid_members:
        if mid not in result["memberForces"]:
            problems.append(f"no memberForces for member {mid!r} of a valid component")

    for mid, forces in result["memberForces"].items():
        member = member_by_id.get(mid)
        if member and member.get("kind") == "cable" and forces.get("axial", 0.0) < -CABLE_TENSION_TOLERANCE:
            problems.append(f"cable {mid!r} reports compression {forces['axial']}")

    for comp in components:
        if comp.get("resultsValid"):
            issue = _force_balance(model, result, comp)
            if issue:
                problems.append(issue)
    return problems


def check_state(seed: int) -> list[str]:
    model = generate_state(seed)
    result, problem = _run(model)
    if problem:
        return [problem]
    problems = check_result(model, result)
    analysis = model.get("analysis") or {}
    if seed % DETERMINISM_EVERY == 0 and not problems:
        # Compare two runs under a generous budget so the wall clock cannot decide the result.
        relaxed = copy.deepcopy(model)
        relaxed.setdefault("analysis", {})["timeoutMs"] = DETERMINISM_TIMEOUT_MS
        first, problem = _run(relaxed)
        second, problem2 = _run(relaxed)
        if problem or problem2:
            problems.append(f"determinism runs: {problem or problem2}")
        elif _strip_runtime(first) != _strip_runtime(second):
            problems.append("two runs of the same model (timeoutMs 60000) gave different results")
    return problems


def check_invalid_state(seed: int) -> list[str]:
    model = generate_invalid_state(seed)
    result, problem = _run(model)
    if problem:
        return [f"[{invalid_kind(seed)}] {problem}"]
    problems = check_result(model, result)
    if result.get("status") != "error":
        problems.append(f"invalid model ({invalid_kind(seed)}) returned {result.get('status')!r}, expected 'error'")
    return [f"[{invalid_kind(seed)}] {p}" for p in problems]


def _report(failures: list[tuple[str, int, list[str]]]) -> str:
    lines = [f"{len(failures)} failing state(s). Reproduce with DOF_GENERATED_SEED=<seed>:"]
    for label, seed, problems in failures[:10]:
        lines.append(f"  {label} seed {seed}:")
        lines.extend(f"    - {p}" for p in problems[:5])
    if len(failures) > 10:
        lines.append(f"  ... and {len(failures) - 10} more")
    return "\n".join(lines)


# --------------------------------------------------------------------------- tests


@pytest.mark.skipif(ONE_SEED is not None, reason="single-seed run requested")
def test_generated_states_hold_invariants() -> None:
    failures = []
    for seed in range(BASE_SEED, BASE_SEED + N_STATES):
        problems = check_state(seed)
        if problems:
            failures.append((f"state [{state_family(seed)}]", seed, problems))
    assert not failures, _report(failures)


@pytest.mark.skipif(ONE_SEED is not None, reason="single-seed run requested")
def test_invalid_models_return_error() -> None:
    count = max(len(INVALID_KINDS) * 3, N_STATES // 10)
    failures = []
    for seed in range(BASE_SEED, BASE_SEED + count):
        problems = check_invalid_state(seed)
        if problems:
            failures.append(("invalid", seed, problems))
    assert not failures, _report(failures)


@pytest.mark.skipif(ONE_SEED is None, reason="set DOF_GENERATED_SEED to run one seed")
def test_single_seed() -> None:
    seed = int(ONE_SEED or 0)
    for label, builder, check in (
        ("state", generate_state, check_state),
        ("invalid", generate_invalid_state, check_invalid_state),
    ):
        problems = check(seed)
        if problems:
            model = builder(seed)
            result, _ = _run(model)
            pytest.fail(
                f"{label} seed {seed} [{state_family(seed) if label == "state" else invalid_kind(seed)}]: {problems}\nMODEL:\n{json.dumps(model)}\nRESULT:\n{json.dumps(result, default=str)[:4000]}"
            )


# --------------------------------------------------------------------------- generator self-tests


def test_generator_is_deterministic() -> None:
    for seed in range(200):
        assert json.dumps(generate_state(seed), sort_keys=True) == json.dumps(generate_state(seed), sort_keys=True)
        assert generate_invalid_state(seed) == generate_invalid_state(seed)
    assert generate_state(1) != generate_state(2)


def test_generated_models_are_schema_valid_and_varied() -> None:
    kinds: set[str] = set()
    fidelities: set[str] = set()
    sizes = []
    saw = {"free": False, "full": False, "elastic": False, "dup": False, "initialStrain": False, "properties": False}
    for seed in range(400):
        model = generate_state(seed)
        StructuralModel.model_validate(model)
        json.dumps(model, allow_nan=False)
        sizes.append(len(model["members"]))
        fidelities.add((model.get("analysis") or {}).get("fidelity", "nonlinear"))
        for member in model["members"]:
            kinds.add(member.get("kind", "beam"))
            saw["free"] |= "free" in (member.get("startFixity"), member.get("endFixity"))
            saw["full"] |= "startConnection" in member or "endConnection" in member
            for key in ("startConnection", "endConnection"):
                saw["elastic"] |= "elastic" in member.get(key, {}).get("laws", [])
            saw["initialStrain"] |= "initialStrain" in member
            saw["properties"] |= "properties" in member
        saw["dup"] |= any(n["id"].startswith("dup") for n in model["nodes"])
        assert 1 <= len(model["supports"]) + 1  # supports may legitimately be empty; just well-formed
    assert kinds == {"beam", "brace", "cable"}
    assert fidelities == {"linear", "nonlinear"}
    assert all(saw.values()), saw
    assert min(sizes) >= 1 and max(sizes) > 25


def test_invalid_models_are_schema_valid() -> None:
    for seed in range(len(INVALID_KINDS) * 4):
        StructuralModel.model_validate(generate_invalid_state(seed))
