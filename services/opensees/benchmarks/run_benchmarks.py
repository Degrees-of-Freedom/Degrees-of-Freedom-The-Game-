"""Timing harness for ``dof_opensees.engine.analyze``. Measures; asserts nothing.

    uv run python benchmarks/run_benchmarks.py [--output results.json]
        [--states 60] [--warmup 5] [--stress-runs 5] [--seed 1000]
        [--stress-nx 4 --stress-ny 4 --stress-nz 14]

Groups:

* ordinary_linear / ordinary_nonlinear: generated game states (seeded, small,
  schema-valid, timeouts removed) forced to one fidelity each.
* stress: a regular multi-storey frame near the criteria target (about 500 members,
  about 2000 active DOFs), nonlinear and linear.

Targets are those of docs/kb/solver-criteria.md section 6 and are printed beside
the measurements for comparison only.
"""

from __future__ import annotations

import argparse
import copy
import json
import platform
import statistics
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tests" / "acceptance"))

from accept_generators import CELL, FIXED_SUPPORT, generate_state  # noqa: E402
from dof_opensees.engine import analyze  # noqa: E402
from dof_opensees.schema import StructuralModel  # noqa: E402

ANALYSED_STATUSES = ("success", "unstable", "unresolved")

TARGETS_MS = {
    "ordinary_linear": ("preview p95 <= 50 ms", 50.0, "p95"),
    "ordinary_nonlinear": ("ordinary nonlinear turn <= 250 ms", 250.0, "p95"),
    "stress_nonlinear": ("difficult <= 2000 ms or explicit unresolved", 2000.0, "max"),
    "stress_linear": ("difficult <= 2000 ms or explicit unresolved", 2000.0, "max"),
}


def lattice(nx: int, ny: int, nz: int, fidelity: str) -> dict[str, Any]:
    """Regular multi-storey moment frame: columns plus alternating x and y girders.

    Nodes sit on an (nx+1)x(ny+1)x(nz+1) grid; the ground layer is fully fixed.
    Free nodes carry 6 DOFs each, so DOFs = 6 * (nx+1)(ny+1) * nz.
    """
    def nid(i: int, j: int, k: int) -> str:
        return f"n{i}_{j}_{k}"

    nodes = [
        {"id": nid(i, j, k), "position": [i * CELL, j * CELL, k * CELL]}
        for k in range(nz + 1)
        for j in range(ny + 1)
        for i in range(nx + 1)
    ]
    members: list[dict[str, Any]] = []

    def add(a: tuple[int, int, int], b: tuple[int, int, int], kind: str, fixity: str) -> None:
        members.append(
            {
                "id": f"m{len(members)}",
                "startNodeId": nid(*a),
                "endNodeId": nid(*b),
                "kind": kind,
                "startFixity": fixity,
                "endFixity": fixity,
            }
        )

    for k in range(nz + 1):
        for j in range(ny + 1):
            for i in range(nx + 1):
                if k < nz:
                    add((i, j, k), (i, j, k + 1), "beam", "fixed")  # columns
                if k > 0 and k % 4 == 2 and i < nx:
                    add((i, j, k), (i + 1, j, k), "beam", "fixed")  # x girders
                if k > 0 and k % 4 == 0 and j < ny:
                    add((i, j, k), (i, j + 1, k), "beam", "fixed")  # y girders
    supports = [
        {"nodeId": nid(i, j, 0), "restrained": list(FIXED_SUPPORT)} for j in range(ny + 1) for i in range(nx + 1)
    ]
    loads = [
        {"nodeId": nid(i, j, nz), "force": [0.0, 0.0, -5e3], "moment": [0.0, 0.0, 0.0]}
        for j in range(ny + 1)
        for i in range(nx + 1)
    ]
    return {
        "units": "SI",
        "nodes": nodes,
        "members": members,
        "supports": supports,
        "loads": loads,
        "analysis": {"fidelity": fidelity, "selfWeight": True},
    }


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = fraction * (len(ordered) - 1)
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def time_models(models: list[dict], warmup: int, repeats: int = 1) -> dict[str, Any]:
    parsed = [StructuralModel.model_validate(m) for m in models]
    for model in parsed[:warmup] if len(parsed) > warmup else parsed[:1]:
        analyze(model)  # warmup, excluded
    timings: list[float] = []
    analysed_timings: list[float] = []
    statuses: dict[str, int] = {}
    raised = 0
    for _ in range(repeats):
        for model in parsed:
            start = time.perf_counter()
            try:
                result = analyze(model)
                status = result.get("status", "?")
            except Exception:
                raised += 1
                status = "raised"
            elapsed = (time.perf_counter() - start) * 1000.0
            timings.append(elapsed)
            if status in ANALYSED_STATUSES:
                analysed_timings.append(elapsed)
            statuses[status] = statuses.get(status, 0) + 1
    analysed: dict[str, Any] = {"count": len(analysed_timings)}
    if analysed_timings:
        analysed.update(
            p50_ms=percentile(analysed_timings, 0.5),
            p95_ms=percentile(analysed_timings, 0.95),
            max_ms=max(analysed_timings),
            mean_ms=statistics.fmean(analysed_timings),
        )
    return {
        "analysed": analysed,
        "count": len(timings),
        "p50_ms": percentile(timings, 0.5),
        "p95_ms": percentile(timings, 0.95),
        "max_ms": max(timings),
        "mean_ms": statistics.fmean(timings),
        "statuses": statuses,
        "raised": raised,
    }


def ordinary_models(count: int, seed: int, fidelity: str) -> list[dict]:
    """Ordinary states: skip very large generated ones, drop timeouts, force the fidelity."""
    models: list[dict] = []
    current = seed
    while len(models) < count:
        model = generate_state(current)
        current += 1
        if len(model["members"]) > 40:
            continue
        model = copy.deepcopy(model)
        analysis = model.setdefault("analysis", {})
        analysis.pop("timeoutMs", None)
        analysis["fidelity"] = fidelity
        models.append(model)
    return models


def machine_description() -> dict[str, Any]:
    try:
        import openseespy.opensees as ops

        opensees_version = str(ops.version())
    except Exception as exc:  # pragma: no cover
        opensees_version = f"unavailable ({exc})"
    return {
        "platform": platform.platform(),
        "processor": platform.processor() or platform.machine(),
        "python": platform.python_version(),
        "openseespy": opensees_version,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", help="write JSON results to this path")
    parser.add_argument("--states", type=int, default=60, help="generated states per ordinary group")
    parser.add_argument("--warmup", type=int, default=5, help="warmup runs excluded from timing")
    parser.add_argument("--stress-runs", type=int, default=5, help="timed repeats of the stress lattice")
    parser.add_argument("--seed", type=int, default=1000, help="first generator seed")
    parser.add_argument("--stress-nx", type=int, default=4)
    parser.add_argument("--stress-ny", type=int, default=4)
    parser.add_argument("--stress-nz", type=int, default=14)
    args = parser.parse_args()

    groups: dict[str, dict[str, Any]] = {}
    for fidelity in ("linear", "nonlinear"):
        models = ordinary_models(args.states, args.seed, fidelity)
        groups[f"ordinary_{fidelity}"] = time_models(models, args.warmup)

    for fidelity in ("nonlinear", "linear"):
        model = lattice(args.stress_nx, args.stress_ny, args.stress_nz, fidelity)
        members = len(model["members"])
        free_dofs = 6 * (args.stress_nx + 1) * (args.stress_ny + 1) * args.stress_nz
        entry = time_models([model], warmup=1, repeats=args.stress_runs)
        entry["members"] = members
        entry["activeDofs"] = free_dofs
        groups[f"stress_{fidelity}"] = entry

    machine = machine_description()
    print("Machine:", json.dumps(machine))
    header = f"{'group':<22}{'count':>6}{'p50 ms':>10}{'p95 ms':>10}{'max ms':>10}  {'target':<48}{'status counts'}"
    print(header)
    print("-" * len(header))
    for name, entry in groups.items():
        target = TARGETS_MS[name]
        extra = f" [{entry['members']} members, {entry['activeDofs']} DOFs]" if "members" in entry else ""
        print(
            f"{name:<22}{entry['count']:>6}{entry['p50_ms']:>10.1f}{entry['p95_ms']:>10.1f}{entry['max_ms']:>10.1f}  "
            f"{target[0]:<48}{entry['statuses']}{extra}"
        )
        entry["target"] = {"description": target[0], "limit_ms": target[1], "statistic": target[2]}
    print()
    print("Analysed states only (status success, unstable or unresolved; refusals excluded):")
    print(f"{'group':<22}{'count':>6}{'p50 ms':>10}{'p95 ms':>10}{'max ms':>10}")
    for name, entry in groups.items():
        if not name.startswith("ordinary"):
            continue
        a = entry["analysed"]
        if a["count"]:
            print(f"{name:<22}{a['count']:>6}{a['p50_ms']:>10.1f}{a['p95_ms']:>10.1f}{a['max_ms']:>10.1f}")
        else:
            print(f"{name:<22}{0:>6}{'-':>10}{'-':>10}{'-':>10}")
    if args.output:
        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps({"machine": machine, "groups": groups}, indent=2), encoding="utf-8")
        print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
