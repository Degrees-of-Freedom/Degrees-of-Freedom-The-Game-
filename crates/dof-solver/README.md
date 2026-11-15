# dof-solver

The structural reference solver for Degrees of Freedom, written in Rust and delivered to the browser as a WebAssembly module. It evaluates physics only: it takes an analytical model and analysis options and returns a result document. It knows nothing about cards, players, turns or scoring.

It was written against the [solver criteria](../../docs/kb/solver-criteria.md). The [Rust solver page](../../docs/kb/rust-solver.md) in the knowledge base records how it compares with each requirement, the test evidence and the open decisions. This README is the reference for building, calling and reading the solver.

The crate has no third-party dependencies. It reads and writes JSON with its own code.

## Build and test

You need a Rust toolchain with the `wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`). From the repository root:

```bash
npm run test:solver    # cargo test: unit tests and the acceptance suite
npm run build:solver   # build the module and copy it to apps/web/src/solver/wasm/
npm run bench:solver   # time the built module in Node
```

`npm run test:solver` takes about a minute, most of it the 10,000 random states. The compiled module is committed at `apps/web/src/solver/wasm/dof_solver.wasm`, so the web app builds and its tests run without Rust. Rebuild it with `npm run build:solver` after changing this crate.

Run Cargo from this directory when you call it yourself: `.cargo/config.toml` sets the WebAssembly stack size and SIMD flag, and Cargo only reads it from here.

## Calling the solver

From TypeScript, use `createWasmSolver()` in `apps/web/src/solver/wasm/wasmSolver.ts`. The types are in `packages/solver-contract/src/analysis.ts`.

The module itself has no imports and three exports:

| Export | Purpose |
| --- | --- |
| `dof_alloc(len) -> ptr` | Allocate `len` bytes for the request. |
| `dof_analyze(ptr, len) -> ptr` | Analyse the UTF-8 JSON request. Returns a buffer holding the result length as a little-endian `u32`, then that many bytes of UTF-8 JSON. |
| `dof_free(ptr, len)` | Free a request buffer, or a result buffer with its length plus four. |

The request is `{"model": {...}, "options": {...}}`. Unknown fields are rejected, so a caller cannot believe a feature was analysed when the solver never read it. From Rust, call `dof_solver::analyze(&model, &options)` or `dof_solver::analyze_json(text)`.

**Several load cases.** A request may add `"cases": [...]`, at most 100 with unique ids. Each case may replace the model's `loads` or `memberLoads`, `loadFactor` and `gravity`, or set `"selfWeight": false`. The answer is then `{"cases": [{"id": ..., "result": {...}}]}`, in request order, and each result is exactly what a separate request with that case would return, so one case can be `invalid` while the others are analysed. The model is sent and parsed once; each case is still solved from scratch, with no stiffness factorisation shared between cases. From Rust, call `dof_solver::analyze_cases`. A request that cannot be parsed at all still returns one `invalid` result.

**In the browser** the adapter runs the module on a Web Worker (`solverWorker.ts`), so an analysis does not block the page. WebAssembly cannot be interrupted from inside, so aborting the caller's signal, or exceeding the wall-clock limit (`timeLimitMs`, default 10 s, counted from when the worker starts the analysis), terminates the worker; the next call starts a new one from the already compiled module. A timeout is returned as an `invalid` result with reason `timeLimitExceeded`. Where there is no `Worker` (Node, the tests) the module runs on the calling thread, and then it can be neither cancelled once started nor time limited.

Every outcome is a result. Bad input gives `analysis.status: "invalid"` with reason codes and messages. A panic is caught natively and reported as `internalError`; in WebAssembly it is a trap, which the TypeScript adapter turns into the same result.

## Conventions

| Topic | Convention |
| --- | --- |
| Units | SI base units: m, N, N·m, rad, Pa, kg/m³. |
| Global axes | Right-handed X, Y, Z. No built-in "up": gravity is a vector in the options. |
| Six-component vectors | Translations (or forces) X, Y, Z, then rotations (or moments) about X, Y, Z. |
| Member local axes | `x` from start node to end node. `z` is the part of the member's `orientation` vector perpendicular to `x`; the default reference is global Z, or global X for a member parallel to Z. `y = z × x`. `Iy` and `Iz` are about local `y` and `z`. |
| Connectivity | By node id only. Nodes at the same coordinates are separate unless a member names both. |
| Connection laws | Six per member end, for local translation x, y, z then rotation about x, y, z: `"rigid"`, `"free"` or `{"elastic": k}`. The axes are the member's undeformed local axes, attached to the node and turning with it. |
| Member forces | Section forces `[N, Vy, Vz, T, My, Mz]` in the member's current local axes, as resultants on the face whose normal is local +x. `N` is positive in tension. `start` and `end` use the same convention. |
| Reactions | What the foundation applies to the structure, global axes. Uplift is a reaction opposite to the supporting direction. |
| Unavailable values | `null`. Never zero. |

## What is modelled

- **Beam-columns** carry axial force, shear, biaxial bending and torsion. The element is corotational: large displacements and rotations with small strains. Optional shear areas add shear deformation. A member is split into `subdivisions` elements (default 2) so that member buckling is captured.
- **Braces** are two-way axial members. **Cables** are straight, tension-only axial members. Both are pinned and may have a rest length or an initial strain (pretension).
- **Connections** join each member end to its node through six independent laws. A rigid law is an exact constraint, not a stiff spring. A free or elastic law adds one unknown, the relative motion across the connection, which is reported.
- **Foundations** restrain any of a node's six DOFs and return six signed reaction components.
- **Loads** are nodal forces and moments, uniform member loads (`memberLoads`, N/m in global axes along the whole member), and optional member self-weight when `options.gravity` is given. Member loads are applied exactly like self-weight: consistent nodal loads per beam element, half to each end of a brace or cable, fixed global direction.
- **Deflection along members**: each beam member result has `deflection.stations`, the global displacement at every element boundary (`subdivisions + 1` points, `at` = fraction of the length), and `maxFromChord`, the largest distance of a deformed station from the line through the deformed ends, for limits such as span / 250. Nothing is interpolated between stations. Braces and cables report `null`.
- **Strength**: section and connection capacities give a utilisation and governing limit state. With `options.failure: "remove"` the most overloaded member is removed, or the most overloaded connection released, one event at a time.

Two fidelities share one element formulation. `linear` is the small-displacement solution about the undeformed, prestressed state. `nonlinear` (the default) is the geometrically nonlinear solution.

## How it works

1. **Validation** rejects models that cannot be analysed, with every problem listed.
2. **Components.** Nodes and members joined by at least one force-transmitting member end form a component. Each is analysed on its own, so an unstable one cannot spoil another.
3. **Numbering.** Unknowns are the free DOFs plus the connection variables. Rotations of a node that no member end holds are left out ("unused DOFs"). Nodes are ordered by reverse Cuthill–McKee.
4. **Linear stage.** The stiffness about the undeformed state is assembled into a skyline matrix, scaled to a unit diagonal and factorised as LDLᵀ. A pivot at or below `1e-10` is a zero-stiffness motion. Null vectors are split into motions that translate something (mechanisms) and motions that only rotate (spins). An unloaded spin is removed exactly by fixing one DOF; a mechanism, or a loaded spin, makes the component unstable. Cables use an active-set iteration.
5. **Nonlinear stage.** Modified Newton iterations on the potential energy: forces every iteration, the tangent rebuilt when convergence slows. If the tangent is not positive definite it is shifted until it is, and an energy line search accepts each step. If the full load does not converge, the load is applied in adaptive increments. A first-order mechanism does not end the analysis: the nonlinear equilibrium decides.
6. **Stability of the solution.** The tangent at the converged state is factorised. A negative pivot is a load-induced instability, and the critical load factor is found by bisection. A stable state is then re-solved at `stabilityMargin` times the load; if that is not stable, the state is `marginal`.
7. **Verification.** A result is valid only if the normalised residual, the global force balance and the global moment balance are within `residualGate` (default `1e-5`) and every number is finite.

The beam's strain energy is written once. Automatic differentiation gives the internal force and the consistent tangent from it, so the two cannot disagree. The linear stiffness is closed form, and a unit test checks it against the automatic one.

## Component status

| Status | Meaning | Results |
| --- | --- | --- |
| `stable` | Verified equilibrium with a positive definite tangent and a load reserve. | Valid |
| `marginal` | Verified equilibrium, but a near-mechanism (`nearMechanism`) or a reserve below the margin (`lowStabilityMargin`). | Valid |
| `unstable` | A mechanism, a load-induced instability, or an equilibrium that is excessively deformed. | Valid only for `excessiveDeformation` |
| `unknown` | No verified conclusion: iterations ran out, did not converge, or the equilibrium check failed. | Not valid |

`reasonCodes` say why. Strength exceedance (`strengthExceeded`) is reported separately and never changes the status.

## Tolerances and limits

| Quantity | Value | Where |
| --- | --- | --- |
| Null pivot of the unit-diagonal stiffness | `1e-10` | `skyline.rs` |
| Near-mechanism pivot | `1e-7` | `solve.rs` |
| Pure-rotation test and loaded-mode test | `1e-7`, `1e-8` relative | `solve.rs` |
| Equilibrium tolerance, validity gate | `1e-9`, `1e-5` normalised (options) | `model.rs` |
| Excessive displacement | 10 % of the bounding-box diagonal (option) | `model.rs` |
| Stability margin | 1.25 (option) | `model.rs` |
| Iterations per load step, per component, per request | 40, 400, 2,000 (options) | `model.rs` |
| Model size | 5,000 nodes, 10,000 members | `model.rs` |

Residuals are normalised by the larger of the applied load and the largest element force, with moments divided by the mean member length and taken about the centroid of the nodes. Inputs whose derived numbers would leave the range of a double are rejected as `numericRange` before analysis. The iteration limits are the solver's own work limit: they are counts, not wall-clock time, so a state always gives the same answer. The wall-clock limit is the browser adapter's, which stops the worker; a timed-out run has no answer, not a different one.

## Not modelled

Plasticity, contact, dynamics, post-buckling path tracing, staged construction, sagging cables with distributed weight, non-uniform or partial-length member loads, prescribed (forced) displacements such as support settlement, general multi-point constraints, and follower loads. Plasticity, dynamic collapse, contact and post-buckling are deferred by the criteria (section 8). Self-weight, member loads and applied moments keep their original direction. The reported buckling shape is the direction of the negative pivot, not an eigenvector. Results have not been checked against an independent nonlinear program.
