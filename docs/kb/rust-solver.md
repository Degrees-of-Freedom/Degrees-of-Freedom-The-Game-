---
title: "Rust Solver"
last_validated: 2026-11-14
validated_against:
  - crates/dof-solver/README.md
  - crates/dof-solver/src
  - crates/dof-solver/tests
  - packages/solver-contract/src/analysis.ts
  - apps/web/src/solver/wasm
  - apps/web/src/solver/index.ts
  - scripts/build-solver-wasm.mjs
  - scripts/bench-solver.mjs
  - docs/kb/solver-criteria.md
owner: unknown
status: partial
---

# Rust Solver

`crates/dof-solver` is a structural solver written in Rust against the [solver criteria](solver-criteria.md). It compiles to a WebAssembly module that runs in the player's browser, so no analysis service is needed. The web app loads it through `apps/web/src/solver/wasm/wasmSolver.ts` and uses it by default for the stability check.

The crate [README](../../crates/dof-solver/README.md) is the reference for building, calling, conventions, the algorithm and tolerances. This page records how the solver stands against the criteria, the evidence, and the choices that still need an owner decision.

Status in one paragraph: the solver implements the model, connection, stability, nonlinear and result requirements of criteria sections 2, 3 and 5 and has a passing test for every row of the section 7 acceptance table. It has not been accepted by the project owner, it has not been checked against an independent nonlinear program, and the game does not yet send it the detailed model. Turn handling and the surrogate (sections 4 and 6) are outside it. No criteria milestone is accepted as complete.

## What exists

| Part | Location | State |
| --- | --- | --- |
| Solver | `crates/dof-solver` | Implemented, 53 tests passing. No third-party dependencies. |
| Detailed contract types | `packages/solver-contract/src/analysis.ts` | `AnalysisModel`, `AnalysisOptions`, `DetailedAnalysisResult`, `DetailedSolver`. |
| Browser adapter | `apps/web/src/solver/wasm/wasmSolver.ts` | Serves the detailed contract and the original `StructuralModel` contract. |
| Compiled module | `apps/web/src/solver/wasm/dof_solver.wasm` | Committed build artefact, 526 kB (191 kB gzipped in the production bundle). Rebuild with `npm run build:solver`. |
| Game integration | `apps/web/src/solver/index.ts` | Default solver for the stability check, through the original contract only. |

The game translation in `game/structuralModel.ts` still produces the original contract, which has no sections, no cables and no self-weight. So the app does not yet use cables as tension-only members, card properties, capacities, nonlinear analysis or component results, although the solver supports them. Sending the detailed model from the game is the next integration step and needs decisions on card properties.

## Coverage of the criteria

"Met" means implemented with a passing test that exercises it. It is a claim about this code and its tests, not owner acceptance.

| Criteria | State | Notes |
| --- | --- | --- |
| M01 six DOFs, relevant ones active | Met | Rotations of a node that no member end holds are left out and counted as `unusedDofs`. Genuine mechanisms are kept and reported. |
| M02 connectivity separate from coincidence | Met | Connectivity is by node id. Each member end has its own connection. A fully released end is not a connection. |
| M03 beam-column, brace, cable | Met | Beam-columns have optional shear deformation. Cables are straight and tension-only. |
| M04 six-law connections | Met | `rigid`, `free` or `elastic` per local DOF. Pinned, moment, partial-release and semi-rigid are combinations. Axes are the member's undeformed local axes, attached to the node. |
| M05 exact rigid constraints | Partly | Rigid laws and restraints are exact (shared or eliminated DOFs). Two foundations on one node are rejected as redundant. The model has no general constraints or prescribed displacements, so incompatible constraints cannot be expressed or detected. |
| M06 foundations and reactions | Met | Any of six DOFs restrained per foundation id; six signed reaction components. |
| M07 loads and self-weight | Met | Nodal forces and moments with ids. Self-weight is a uniform member load, applied once as consistent nodal loads. Loads keep their original direction. |
| M08 card properties, one unit system | Met | Sections carry E, G, A, Iy, Iz, J, shear areas, density and capacities; braces and cables carry rest length or initial strain. SI throughout. |
| M09 stable ids, subdivision | Partly | Members, foundations and loads have ids; a connection is identified by member id and end. Subdivision for accuracy is internal and invisible. The solver does not split a member at an interior attachment: the game must send separate members and may tag them with `parentId`, which is echoed. |
| A01 linear baseline | Met | Closed-form cases to `1e-9`. |
| A02 geometric nonlinearity | Met | Corotational beam with the member P-δ term, exact large-displacement axial members, cable slackening. See limits below. |
| A03 classifications | Met | Unused DOFs, separate components, rigid-body motions, internal mechanisms, near-mechanisms, load-induced instability, excessive deformation and strength exceedance are distinct codes, flags or counts. An unloaded mechanism is `unstable`. With more than 96 null vectors the split between mechanisms and spins is by pivot DOF only. |
| A04 tangent stability | Met | Uses the constrained, unit-diagonal tangent at the solution, with the cable states and stress stiffening it has there. Modes list the nodes that move. A first-order mechanism is not final: the nonlinear equilibrium decides. The buckling shape reported is the negative-pivot direction, not an eigenvector. |
| A05 bounded recovery | Met | Shifted tangent, energy line search, adaptive load increments, iteration limits. No verified conclusion gives `unknown`. |
| A06 component isolation | Met | Each component is a separate system. |
| A07 verification | Met | Residual, global force balance and global moment balance are gated at run time. Cable states follow from the deformed length. Nothing is stabilised artificially, so no artificial reaction exists. |
| A08 robustness | Partly | Invalid input, singular systems, extreme stiffness ratios and non-finite numbers give explicit results. The time limit is an iteration count, not wall-clock time, and an analysis cannot be cancelled while it runs. |
| Section 4 turn resolution | Outside the solver | The solver gives what a turn engine needs: an immutable input, an echoed model version, repeatable results, capacity checks and an optional bounded failure sequence. Each analysis starts from the undeformed geometry, which matches the proposed reapply-loads policy. Transactions, previews and penalties are game work and do not exist. |
| Section 5 result contract | Met | Analysis, component, node, member, connection and foundation results with explicit `null` for unavailable values. Run time is added by the browser adapter. Load shares are not computed: signed reactions and the applied force per component are returned for the game to apply its scoring policy. |
| Section 6 speed and surrogate | Partly | Timings below. No surrogate exists. The benchmark is one synthetic frame at two sizes on one machine, not a representative suite of game states. |
| Section 7 acceptance tests | Met | See the next table. |

## Acceptance evidence

Run with `npm run test:solver`. Rust 1.100.0, 14 November 2026. Result: 53 passed, 0 failed, 1 ignored (the timing harness).

| Acceptance row | Tests (`crates/dof-solver/tests`) | Measured |
| --- | --- | --- |
| Axial bar, cantilever, simply supported beam, torsion | `linear.rs` | Relative error at most `1e-9`, against a 0.1 % gate. Also propped cantilever, self-weight and shear deflection. |
| Parallel springs; shared frame with 2 to 4 supports | `stability.rs` | Reactions match stiffness ratios and an independent hand solution to `1e-9`. |
| Moment, pin, partial release, semi-rigid joint | `stability.rs` | Transmitted and released components exact; same result for members along X, Y, Z and a skew axis. |
| Coincident unconnected members; disconnected components | `stability.rs` | No accidental connection; the stable frame's results are bit-identical with and without unstable neighbours. |
| 3D truss; unbraced mechanism | `stability.rs` | No false singularity (12 unused rotations); in-plane and out-of-plane mechanisms found with their nodes. |
| Compressed imperfect column; sway frame | `nonlinear.rs` | Euler load error 21.6 %, 0.80 %, 0.10 %, 0.03 % for 1, 2, 4, 8 elements, against a 2 % gate. Sway error 0.24 %, 0.08 %, 0.06 % for 1, 2, 4 elements, against a 1 % gate. |
| Slack and taut cable; pretension; large deflection | `nonlinear.rs` | No cable compression; slack take-up, pretensioned span and large-deflection span match the exact node equilibrium to `1e-6`. |
| Overloaded connection or member; redundant member removal | `strength.rs` | Governing limit state and utilisation exact; removal order and redistribution repeatable. |
| Symmetry, reordering, rigid rotation | `robustness.rs` | Reordering gives the identical result text; rotation and renaming agree to `1e-6` and `1e-9`. |
| Preview, replay, random legal and invalid states | `robustness.rs`, `wasmSolver.test.ts` | 10,000 seeded states: no panic, no non-finite value, no valid result without verified equilibrium. Outcomes: 2,938 stable, 123 marginal, 9,223 unstable, 342 unknown components, 531 rejected inputs. Input is not mutated; repeated runs are equal. |

Large-rotation references also pass at the 1 % gate: a cantilever rolled through 90° by an end moment, and the elastica tip-load case.

Two things support the linear results beyond the closed-form cases. A unit test checks the closed-form beam stiffness against the automatically differentiated one, and the automatic gradient and Hessian against finite differences of the energy. And `crossCheck.test.ts` compares this solver with the OpenSees service through the original contract: on a mixed-connection space frame, a mechanism, and the Tower I, Bridge I and Pickup I examples, they agree on status, mechanisms, moving nodes and static indeterminacy, and on displacements, reactions and member forces within `2e-5`. That test needs the service running and is skipped otherwise.

Nothing comparable exists for the nonlinear results. They are checked against analytical and published references only.

## Timings

`npm run bench:solver`, WebAssembly in Node 24.16 on an Intel Core Ultra 5 236V (8 logical cores), 20 runs each, including JSON encoding and decoding. These are one machine's numbers, and the runs were noisy.

| Case | Members | Unknowns | Median | p95 | Proposed target |
| --- | --- | --- | --- | --- | --- |
| Game-sized frame, linear | 46 | 376 | 4 ms | 22 ms | preview p95 ≤ 50 ms |
| Game-sized frame, nonlinear | 46 | 376 | 32 ms | 50 ms | turn ≤ 250 ms |
| Stress frame, linear, 1 element per beam | 504 | 1,280 | 36 ms | 51 ms | |
| Stress frame, linear, 2 elements per beam | 504 | 4,124 | 143 ms | 264 ms | |
| Stress frame, nonlinear, 1 element per beam | 504 | 1,280 | 304 ms | 431 ms | difficult ≤ 2 s |
| Stress frame, nonlinear, 2 elements per beam | 504 | 4,124 | 818 ms | 1,720 ms | difficult ≤ 2 s |

The targets are met on this frame and machine. They are not validated in a browser, on slower hardware, or on states that need many load increments. The analysis runs on the calling thread and blocks it while it runs.

## Decisions made in the implementation

These are implementation choices, not owner decisions. Each is a default that the owner may want to change.

- **Unloaded spin is tolerated.** A motion that only rotates things in place, such as a member on ball joints turning about its own axis, is reported (`spinModes`) but does not make a component unstable unless a load acts on it. The OpenSees service does the same. Criterion A03 could be read more strictly.
- **Excessive deformation is `unstable` with valid results.** An equilibrium displaced by more than 10 % of the component's bounding-box diagonal is `unstable` with reason `excessiveDeformation`, and its results are still returned.
- **`marginal` means a reserve below 25 %.** A stable state that is not stable at 1.25 times its loads is `marginal`. This costs an extra solve.
- **Failure removes or releases.** A failed member is removed; a failed beam connection is fully released. One object fails per event, the most overloaded first, ties broken by id.
- **Linear axial–bending interaction** for member utilisation.
- **Two beam elements per member** by default, which gives the Euler load to 0.8 %.
- **Self-weight needs a gravity vector** in the options; there is no default direction.
- **The compiled module is committed**, so the web app does not need a Rust toolchain to build.

## Limits

- No plasticity, contact, dynamics, post-buckling path tracing, staged construction or sagging cables.
- Loads keep their direction; applied moments are not follower moments.
- A perfectly straight column past its buckling load is reported unstable; the post-buckled shape is not traced.
- Self-weight on a slack cable is still carried to its end nodes.
- The solver cannot be cancelled mid-analysis, and its time limit is an iteration count.
- The original-contract path in the web app is linear and uses one steel section, like the OpenSees service.
