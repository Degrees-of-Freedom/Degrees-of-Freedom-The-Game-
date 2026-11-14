# Benchmarks

In-process timing of `dof_opensees.engine.analyze`. It measures and prints; it asserts nothing.

```
cd services/opensees
uv run python benchmarks/run_benchmarks.py --output benchmarks/results.json
```

Options: `--states` (generated states per ordinary group, default 60), `--warmup` (default 5, excluded), `--stress-runs` (timed repeats of the stress model, default 5), `--seed` (first generator seed, default 1000), `--stress-nx/ny/nz` (default 4/4/14).

## Groups

| Group | Content | Target (docs/kb/solver-criteria.md section 6) |
| --- | --- | --- |
| `ordinary_linear` | seeded generated game states (at most 40 members, timeouts removed), forced to linear fidelity | preview p95 <= 50 ms |
| `ordinary_nonlinear` | the same states, nonlinear fidelity | ordinary nonlinear turn <= 250 ms |
| `stress_nonlinear` | regular multi-storey frame (columns plus alternating x and y girders, fully fixed ground nodes, self-weight, roof loads): 490 members, 2100 free DOFs by default | difficult <= 2 s or an explicit `unresolved` |
| `stress_linear` | same frame, linear fidelity | same |

## Reading the output

One row per group: `count` (timed calls, warmup excluded), `p50`, `p95` and `max` wall time in milliseconds, the target text, and a count of result statuses. A stress run that returns `unresolved` within the budget is acceptable under the criteria; one that raises (`raised` in the JSON, status `raised`) is a defect. Ordinary states include unstable and unsupported ones, which is realistic; check the status counts before comparing timings across engine versions.

The first line gives platform, processor, Python and OpenSeesPy versions. Quote it with any number. Results from different machines are not comparable.

JSON (`--output`): `{machine, groups: {name: {count, p50_ms, p95_ms, max_ms, mean_ms, statuses, raised, target}}}`; stress groups add `members` and `activeDofs`.

Stress p95 is meaningless at 5 runs; compare `max` there, or raise `--stress-runs`.
