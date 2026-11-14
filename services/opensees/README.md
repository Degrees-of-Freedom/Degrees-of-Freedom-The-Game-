# OpenSees service

A Python HTTP service that analyses a `StructuralModel` from `@dof/solver-contract` with [OpenSeesPy](https://openseespydoc.readthedocs.io) and returns an `AnalysisResult`: stability and degree-of-freedom counts, mechanism shapes, displacements, support reactions, and member forces.

## Run

The service uses [uv](https://docs.astral.sh/uv/), which also installs a matching Python. From the repository root:

```bash
npm run dev:opensees    # http://localhost:8000, reloads on edit
npm run test:opensees   # pytest
```

Or from this directory: `uv run uvicorn dof_opensees.app:app --port 8000` and `uv run pytest`. OpenSeesPy ships binary wheels per Python version; this project pins Python 3.12.

A `Dockerfile` is provided (`docker build -t dof-opensees services/opensees`, then `docker run --rm -p 8000:8000 dof-opensees`). It has not been build-tested yet; the system libraries it installs for the OpenSeesPy Linux wheel are a best estimate.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Liveness, service version, OpenSees version. |
| `GET /capabilities` | Supported analysis, units, member properties, and request limits. |
| `POST /analyze` | Body: a `StructuralModel`. Response body: always an `AnalysisResult`. |

`POST /analyze` returns HTTP 200 for every analysis outcome: `success`, `unstable`, and `error` for a model that is well-formed but not analysable (unknown node reference, duplicate id, zero-length member, over the size limit). A body that does not match the schema, including unknown fields, returns HTTP 422 with an `error` result.

Configuration, by environment variable:

| Variable | Default | Meaning |
| --- | --- | --- |
| `DOF_OPENSEES_CORS_ORIGINS` | unset | Comma-separated browser origins allowed to call the service. When unset, any port on `localhost` or `127.0.0.1` is allowed, for local development. Set it in any deployment. |
| `DOF_OPENSEES_MAX_NODES` | `2000` | Largest accepted node count. |
| `DOF_OPENSEES_MAX_MEMBERS` | `8000` | Largest accepted member count. |
| `DOF_OPENSEES_WORKERS` | `2` | Worker processes in the Docker image. |

OpenSees holds one global model per process, so each process analyses one model at a time. Concurrency comes from worker processes.

## What is modelled

- **Analysis:** linear elastic, small-displacement, static. One load case made of the nodal forces and moments in the request. No self-weight, member loads, load combinations, buckling, or member capacity checks.
- **Units:** SI base units. Metres, newtons, newton-metres, radians.
- **Members:** every member is the same steel section, defined in `src/dof_opensees/properties.py` (E = 210 GPa, G = 81 GPa, properties representative of a 200 x 200 x 10 mm square hollow section). The section is doubly symmetric, so results do not depend on member roll and the contract needs no local-axis convention.
- **Connections:** each member end is `fixed` (transfers moment) or `pinned` (forces only), defaulting to `fixed`. A member pinned at both ends becomes a `Truss` element. A member fixed at both ends becomes an `elasticBeamColumn`. A member with one pinned end is an `elasticBeamColumn` whose pinned end sits on a duplicate node tied to the real node in translation only.
- **Pin joints:** a node where no member end is fixed has no rotational degrees of freedom in the system. Its reported rotations are zero. A moment load on such a node keeps the rotations in the system, where they appear as a loaded rotational mechanism.
- **Unused nodes:** nodes with no members and no load are left out, with a warning. A loaded node with no members is a mechanism.

## Stability and degrees of freedom

The service reads the free-DOF stiffness matrix `K` from OpenSees and inspects it with NumPy (`stability.py`). The structure is a mechanism exactly when `K` is singular, and each null vector of `K` is a motion that needs no force.

1. `K` is scaled to a unit diagonal so translations and rotations are comparable.
2. A Cholesky factorisation of the scaled matrix, shifted by `1e-10`, succeeds when there is no mechanism. This is the common case and the only cost for a stable model.
3. Otherwise an eigendecomposition gives the null space. It is split into **translational** mechanisms, which move at least one node, and **rotational** mechanisms, which only spin nodes in place.

The reported counts are `freeDofs`, `mechanisms`, `translationalMechanisms`, `rotationalMechanisms`, and `staticIndeterminacy`. Static indeterminacy is `(internal force unknowns) - freeDofs + mechanisms`, with one unknown per truss and six per beam. It is zero for a statically determinate stable structure and counts redundant load paths otherwise.

A model is `unstable` when it has any translational mechanism, or a rotational mechanism that a load does work on. The result then carries mode shapes per node for display and the list of nodes involved.

Rotational mechanisms that no load acts on do not stop the analysis. The usual case is a straight run of rigidly joined members that can spin about its own axis between pin supports. The service reports the mode, adds rotational springs one millionth as stiff as the members to hold it still, and solves. Results on such models match closed-form values to about `1e-5` relative.

## Measured speed

Wall time for one `analyze` call on one development machine, rigid-jointed cubic lattices at 2 m spacing, fixed at the base. These are single measurements, not benchmarks.

| Model | Free DOFs | Time |
| --- | --- | --- |
| 3 bars, 1 free node | 3 | under 1 ms |
| 27 nodes, 54 members | 108 | 4 ms |
| 64 nodes, 144 members | 288 | 17 ms |
| 125 nodes, 300 members | 600 | 67 ms |
| 216 nodes, 540 members | 1080 | 220 ms |
| 512 nodes, 1344 members | 2688 | 1.7 s |

Time grows with the cube of the DOF count because `K` is extracted and factorised as a dense matrix.

## Tests

`tests/test_engine.py` checks closed-form cases (axial bar, cantilever in four orientations, torsion, pinned tripod, simply supported beam, propped cantilever), determinacy counts, mechanisms (out-of-plane fold, portal sway, rigid-body motion, loaded pin-joint moment), global equilibrium of reactions, and input validation. `tests/test_stability.py` covers the matrix classification alone and `tests/test_api.py` the HTTP layer.

## Known limits and open decisions

- The default end fixity (`fixed`), the single steel section, and the absence of self-weight are implementation choices made to get a working backend. They have not been confirmed as game rules.
- Near-mechanisms are not graded. A structure is either singular to the `1e-10` scaled tolerance or it is not.
- Mode shapes of a multi-mechanism model are one valid basis, not a unique one. At most 12 are returned; counts are always complete.
- There is no authentication or rate limiting. The size limits are the only protection.
- OpenSees writes solver warnings to stderr when it meets a singular matrix during stiffness extraction. They are expected and harmless.
