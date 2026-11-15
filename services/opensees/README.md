# OpenSees service

A Python HTTP service that analyses a `StructuralModel` from `@dof/solver-contract` with [OpenSeesPy](https://openseespydoc.readthedocs.io) and returns an `AnalysisResult`. The analysis is geometrically nonlinear by default. Each structurally independent part of the model gets its own verdict, with stability and degree-of-freedom counts, mechanism and buckling shapes, displacements, support reactions and member forces where the result is verified.

[DESIGN.md](DESIGN.md) is the reference for every modelling decision and the reasons behind it. This page is the summary.

## Run

The service uses [uv](https://docs.astral.sh/uv/), which also installs a matching Python. From the repository root:

```bash
npm run dev:opensees    # http://localhost:8000, reloads on edit
npm run test:opensees   # pytest
```

In the game, choose **OpenSees (service)** under Settings, structural solver. The setting has an address field and a connection test.

Or from this directory: `uv run uvicorn dof_opensees.app:app --port 8000` and `uv run pytest`. OpenSeesPy ships binary wheels per Python version; this project pins Python 3.12.

A `Dockerfile` is provided (`docker build -t dof-opensees services/opensees`, then `docker run --rm -p 8000:8000 dof-opensees`). It has not been build-tested; the system libraries it installs for the OpenSeesPy Linux wheel are a best estimate.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Liveness, service version, OpenSees version. |
| `GET /capabilities` | Member kinds, connection patterns, fidelities, default properties and request limits. |
| `POST /analyze` | Body: a `StructuralModel`. Response body: always an `AnalysisResult`. |

`POST /analyze` returns HTTP 200 for every analysis outcome: `success`, `unstable`, `unresolved`, `unsupported` for a model the service cannot represent, and `error` for one that is well-formed but invalid. A body that does not match the schema, including unknown fields, returns HTTP 422 with an `error` result.

Configuration, by environment variable:

| Variable | Default | Meaning |
| --- | --- | --- |
| `DOF_OPENSEES_CORS_ORIGINS` | unset | Comma-separated browser origins allowed to call the service. When unset, any port on `localhost` or `127.0.0.1` is allowed, for local development. Set it in any deployment. |
| `DOF_OPENSEES_MAX_NODES` | `2000` | Largest accepted node count. |
| `DOF_OPENSEES_MAX_MEMBERS` | `8000` | Largest accepted member count. |
| `DOF_OPENSEES_WORKERS` | `2` | Worker processes in the Docker image. |

OpenSees holds one global model per process, so each process analyses one model at a time. Concurrency comes from worker processes.

## What is modelled

- **Analysis:** `analysis.fidelity` is `nonlinear` by default: corotational geometry, large displacements and rotations, P-Delta, member buckling, and tension-only cables that slacken. `linear` is a small-displacement solve for previews; cables are still tension-only. One load case: the nodal loads in the request, plus member self-weight along -Z when `analysis.selfWeight` is set. No load combinations or capacity checks.
- **Members:** `beam` (beam-column), `brace` (axial, two-way) and `cable` (axial, tension-only). Each member may carry its own section and material; without one it gets a standard steel section. `initialStrain` sets cable or brace pretension.
- **Connections:** each member end has six local laws, `locked`, `free` or `elastic`, with `fixed`, `pinned` and `free` as shorthands. Locks are exact constraints, never stiff springs. The patterns OpenSees can represent exactly are listed in DESIGN.md; anything else is answered `unsupported`.
- **Components:** each independent part is analysed separately. A stable part keeps its results beside an unstable one. Results are present only for verified parts; an absent entry means unavailable, never zero.
- **Units:** SI base units. Metres, newtons, newton-metres, radians.

## Stability

The service classifies the stiffness of each part at its reference state, and the tangent stiffness along the load path:

- A null direction is a mechanism. It is named as an unsupported part, a rigid-body motion or an internal mechanism, and it is unstable whether or not a load acts on it. Slack cables count as one-sided restraints.
- A direction of negative stiffness below full load is a load-induced instability, reported with the critical load factor and the buckling shape.
- A structure that is singular at its reference geometry but stiffens as it deflects, such as an unpretensioned cable carrying a transverse load, is recovered through a bounded nonlinear solve and reported as `geometrically_stiffened`.
- Anything without a verified conclusion is `unresolved`, with a reason code, never a guess. No artificial stiffness reaches a reported result.

## Speed

End-of-turn solves on the game's library fixtures, nonlinear fidelity, one machine with other work running:

| Fixture | Members | Linear | Nonlinear |
| --- | --- | --- | --- |
| Braced portal | 8 | 2 ms | 14 ms |
| Braced tower | 60 | 19 ms | 55 ms |
| Midrise | 208 | 79 ms | 214 ms |

Ordinary structures take a one-step fast path: the full load in one Newton solve, accepted only if it converges, stays stable and agrees with the linear preview. Structures near buckling, or grossly overloaded, take careful stepping and can run to seconds; the default budget is 2000 ms, after which the part is `unresolved` with `timeout`. `npm run compare:solvers` times all the library fixtures against a running service.

## Tests

- `tests/test_*.py`: unit tests of the engine, nonlinear driver, stability classification, tangent extraction and HTTP layer.
- `tests/acceptance/`: independent tests derived from mechanics without reference to the engine. They cover closed-form linear cases at both fidelities, every connection law, component isolation, invariance under rotation and renaming, buckling, imperfect columns, second-order sway, elastica and tip-moment arcs, cables, and a seeded generated-state robustness test.
- `benchmarks/run_benchmarks.py`: timing harness.

[The compliance audit](../../docs/kb/solver-compliance-audit.md) records what is met against the solver criteria and what is not; it predates the latest fixes.
