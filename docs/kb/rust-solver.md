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
  - apps/web/src/game/analysisModel.ts
  - apps/web/src/game/structuralSummary.ts
  - apps/web/src/game/useStabilityCheck.ts
  - apps/web/src/components/StabilityCheckPanel.tsx
  - apps/web/src/game/analysisModel.test.ts
  - apps/web/src/solver/voxelSections.ts
  - scripts/build-solver-wasm.mjs
  - scripts/bench-solver.mjs
  - docs/kb/solver-criteria.md
owner: unknown
status: partial
---

# Rust Solver

`crates/dof-solver` is a structural solver written in Rust against the [solver criteria](solver-criteria.md). It compiles to a WebAssembly module that runs in the player's browser, so no analysis service is needed. The web app loads it through `apps/web/src/solver/wasm/wasmSolver.ts` and uses it by default for the stability check.

The crate [README](../../crates/dof-solver/README.md) is the reference for building, calling, conventions, the algorithm and tolerances. This page records how the solver stands against the criteria, the evidence, and the choices that still need an owner decision.

Status in one paragraph: the solver implements the model, connection, stability, nonlinear and result requirements of criteria sections 2, 3 and 5 and has a passing test for every row of the section 7 acceptance table. It has not been accepted by the project owner, it has not been checked against an independent nonlinear program, and the game's use of it is limited: the workspace sends the detailed model with gravity loads only, no wind and no load combinations, the result panel has been checked by hand in a browser on one example only, and the 3D viewer does not use the result. Turn handling and the surrogate (sections 4 and 6) are outside it. No criteria milestone is accepted as complete.

## What exists

| Part | Location | State |
| --- | --- | --- |
| Solver | `crates/dof-solver` | Implemented, 69 tests passing. No third-party dependencies. |
| Detailed contract types | `packages/solver-contract/src/analysis.ts` | `AnalysisModel`, `AnalysisOptions`, `DetailedAnalysisResult`, `DetailedSolver`. |
| Browser adapter | `apps/web/src/solver/wasm/wasmSolver.ts`, `runner.ts`, `solverWorker.ts` | Serves the detailed contract, several load cases per call (`analyzeCases`), and the original `StructuralModel` contract. In a browser the module runs on a Web Worker, which is terminated on abort or after a wall-clock limit. See [Cancellation and time limit](#cancellation-and-time-limit). |
| Compiled module | `apps/web/src/solver/wasm/dof_solver.wasm` | Committed build artefact, 708 kB (237 kB gzipped in the production bundle). Rebuild with `npm run build:solver`. |
| Game integration | `apps/web/src/solver/index.ts`, `apps/web/src/game/analysisModel.ts`, `apps/web/src/game/useStabilityCheck.ts` | Default solver for the workspace check, which sends the detailed model. See [Game integration](#game-integration). |

The workspace now sends the detailed model: `game/analysisModel.ts` translates the game to it, and `game/useStabilityCheck.ts` uses the detailed contract whenever the selected solver implements it. The original-contract translation in `game/structuralModel.ts` remains for the OpenSees service.

## Game integration

With the Rust solver, Run analysis in the workspace runs a geometrically nonlinear analysis of the detailed model, in addition to the voxel analysis. `toAnalysisModel(game, level)` makes the model as follows.

- **Sections.** Each member type in use gets its own section from the card data in `apps/web/src/solver/voxelSections.ts`, converted to SI. Capacities are axial from area times strength, bending from section modulus times strength, shear from the smaller shear area times shear strength, and, for a cable, its design resistance `NRd`. Density is derived from the card's self-weight per metre, so the solver's self-weight reproduces the card weight.
- **Cables** are tension-only members with the card pretension `P0` as initial strain.
- **Beam ends** are rigid at a node with a moment connection ("joint"). Elsewhere they are released in bending (local rotations y and z free, torsion held).
- **Foundations** restrain the DOFs in their restraint mask, or all six when they have none. Gravity is 9.81 m/s² along -Z, so self-weight is included.
- **Bending includes shear deformation**, from the cards' shear areas. The voxel analysis does not include it, so short, deep members, glulam most of all, are softer here.
- **Loads.** A tower level puts the payload on its highest nodes. A bridge level spreads traffic times span over the deck nodes between the cliffs. Other levels use the point loads placed on nodes, each along its chosen axis. As in the voxel analysis, only nodes joined to a foundation through members are considered, so a loose member cannot attract the payload.
- **Unconnected things.** Every member is sent, so a part with no foundation is reported as unsupported, under its own weight only. Nodes with no member are not sent: a foundation nothing stands on, or a weight nothing is attached to, does not appear, and a note counts the placed loads left out.

What the translation leaves out: loads are unfactored, there is no wind, and there are no load combinations. The solver can now analyse several load cases in one call and reports deflection along members, but the workspace uses neither yet. The voxel analysis uses four ultimate and serviceability combinations with wind and notional loads, and this check does not reproduce them, so its numbers are not comparable one to one with the voxel analysis. Utilisation is section strength only: there is no buckling reduction factor (buckling shows as instability in the nonlinear analysis instead), no deflection limit, and no joint or foundation capacity, all of which the voxel analysis checks. Shear is checked as the resultant against the smaller shear area, which is conservative. The translation returns notes saying what is left out.

The panel ("Structural check", `components/StabilityCheckPanel.tsx`, with the reduction in `game/structuralSummary.ts`) shows the overall verdict, which is the worst component status (stable, marginal, unstable or unresolved) and is not shown as a pass when a member or connection is overstressed, reasons in plain language from the solver's reason codes, the number of separate parts, free DOFs, mechanisms, redundancy, the largest movement, the highest utilisation with its member id and limit state, the number of slack cables, and the vertical reaction at each foundation in kN, marked "up" or "uplift". Values the solver did not verify show as "unavailable", never as zero. With the OpenSees service selected (`VITE_OPENSEES_URL` or `VITE_SOLVER=opensees`), the original contract and the "Degrees of freedom" panel are used unchanged.

On the three reference examples (Tower I, Bridge I, Pickup I) the check reports one stable, verified part with highest utilisation of 3 %, 16 % and 8 %, in roughly 10 to 90 ms each in Node on the development machine. These structures have no moment connections, so every beam end is released; the solver differentiates such elements in fewer variables since this integration, which cut the Bridge I time from about 320 ms.

The check can report things the voxel analysis does not model. A test frame of two HEB 300 members with a 500 kN eccentric load is reported as buckling at about three quarters of that load: a lateral-torsional instability that follows from the card's small torsion constant, and agrees in size with a hand estimate.

Because the analysis is 3D and connections are pinned unless a moment connection is placed, a structure that the linear original-contract check called stable can now be reported as a mechanism or as overstressed. That is the solver reporting the model as translated, not a validated engineering verdict.

Not done: the 3D viewer does not use the detailed result (no highlighting of unstable nodes, mode shapes, slack cables or utilisation colours from this solver); there is no turn system; scoring and load shares are not computed; the panel was checked by hand in a browser once, on the Tower I example only (see [development and testing](development-and-testing.md)); and the results have no independent nonlinear cross-check.

## The shared contract adapter

`apps/web/src/solver/wasm/legacyContract.ts` lets the Rust solver answer the shared `StructuralModel` contract in `packages/solver-contract/src/index.ts`, the one the OpenSees service implements and the end-of-turn solve uses. It follows the contract as merged in #15, where Tal's requirements win on conflicts:

- **Nonlinear is opt-in.** With no `analysis`, or neither `fidelity` nor `type`, the analysis is linear. `type: 'corotational'` is the same as `fidelity: 'nonlinear'`.
- **`segmentsPerFrame`** (1 to 32) fixes the elements per beam. Without it a beam gets one element in a linear analysis (exact under nodal and uniform loads) and two in a nonlinear one.
- **Member laws.** A `law` of kind `frame` supplies the beam's section. A `law` of kind `cable` makes the member a cable whose force is EA·max(0, l/restLength − 1), which is exactly the Rust cable with that rest length.
- **Everything else the contract carries.** Kind, resolved properties (including weight per length), orientation, initial strain, six-axis connections and springs, self-weight and the displacement limit.
- **Local axes.** The contract's local Y follows `orientation`; the Rust solver's local z does. Second moments and connection laws are swapped between those axes. Tests with an unsymmetric section check it.
- **Results.** Component results use contract reason codes, cable `state` and the smallest node id as component id, and leave out what was not verified. `inactiveNodeIds` lists model nodes outside every component. For a nonlinear analysis whose every part was verified, `nonlinear` reports the beam segments, the accepted load steps, the largest normalised force, moment and nodal residuals, and each cable's `taut` or `slack` state.
- **Reported as `unsupported`, not approximated:** initial strain on a beam; a brace or cable whose end translations are not all locked; a cable law combined with an initial strain.
- **Limits.** A per-request `timeoutMs` is not passed through. The solver's deterministic request budget (`maxRequestIterations`) and the browser worker's wall-clock limit apply instead.

Mode shapes that move no model node, such as a member spinning about its own axis on ball joints, are reported with no nodes. Their node entries are rounding noise, which an earlier version scaled up into apparent movement.

## Cancellation and time limit

WebAssembly cannot be interrupted from inside, so the adapter (`runner.ts`) runs the module on a Web Worker (`solverWorker.ts`) and stops an analysis by terminating the worker. Requests go to the worker one at a time, in call order. The main thread compiles the module once and sends the compiled module with each request, so a replacement worker starts without downloading it again.

- **Abort.** Aborting the signal passed to `analyzeDetailed` or `analyzeCases` terminates the worker at once and rejects with the signal's reason. The workspace check already aborts the previous run when a new one starts, so a superseded analysis now actually stops.
- **Time limit.** `createWasmSolver({ timeLimitMs })`, default 10 s. It counts from when the worker starts the analysis, so time in the queue or downloading the module does not count. A timeout returns an `invalid` result with reason `timeLimitExceeded` and a message naming the limit; for `analyzeCases` every case gets it. The 10 s default is an implementation choice, not an owner decision.
- **Without a worker** (Node, the tests) the module runs on the calling thread, which it blocks, and neither applies.

Checked once by hand in the desktop app's built-in Chromium browser through the Vite dev server: a 1,344-member nonlinear frame took 4.7 s while the page's 10 ms timer kept firing (466 ticks); a 100 ms limit stopped the same frame after about 170 ms and the next call succeeded on a fresh worker; an abort after 150 ms rejected after 154 ms. The unit tests use a stand-in worker that runs the real module in-process.

## Numeric range and work budget

Added to match the guards in Tal's OpenSees work (`services/opensees/tests/test_numeric_range.py` on main), so both solvers treat extreme input the same way. Tests are in `crates/dof-solver/tests/numeric_range.rs`.

- **Rejected before analysis, as `invalid` with reason `numericRange`:**
  - point loads on a node whose total overflows a double;
  - a member whose span, squared, overflows;
  - a beam whose element stations would coincide at the precision of its coordinates, for example 2 m in 8 pieces at x = 1e16;
  - a section whose stiffness coefficients overflow or underflow (EA, EA/L, GJ, EI, 12EI/L³), or a cable whose force at its built length does;
  - self-weight that overflows.
- **Exact load sums.** Point loads on a node are added exactly (the algorithm of Python's `math.fsum`), so 1e308 + 3 − 1e308 leaves exactly 3.
- **Moment balance about the structure.** The equilibrium check takes moments about the centroid of the nodes, not the origin, so a structure far from the origin (tested up to 1e9 m) still verifies.
- **Request-wide work budget.** `maxRequestIterations` (default 2,000 Newton iterations) is shared by every component and failure event of a request, in a fixed order, on top of the per-component limit (`maxTotalIterations`, default 400). Parts left without budget report `unknown` with `iterationLimit`; the analysis lists `requestIterationLimit`. Parts already analysed keep their verified results, and the same request gives the same answer on any machine.

Tal's always-on 10,000-state run and 2-to-4-support load-sharing tests already had Rust equivalents (`robustness.rs`, `stability.rs`); load sharing is now also checked in the nonlinear analysis.

## Coverage of the criteria

"Met" means implemented with a passing test that exercises it. It is a claim about this code and its tests, not owner acceptance.

| Criteria | State | Notes |
| --- | --- | --- |
| M01 six DOFs, relevant ones active | Met | Rotations of a node that no member end holds are left out and counted as `unusedDofs`. Genuine mechanisms are kept and reported. |
| M02 connectivity separate from coincidence | Met | Connectivity is by node id. Each member end has its own connection. A fully released end is not a connection. |
| M03 beam-column, brace, cable | Met | Beam-columns have optional shear deformation. Cables are straight and tension-only. |
| M04 six-law connections | Met | `rigid`, `free` or `elastic` per local DOF. Pinned, moment, partial-release and semi-rigid are combinations. Axes are the member's undeformed local axes, attached to the node. |
| M05 exact rigid constraints | Partly | Rigid laws and restraints are exact (shared or eliminated DOFs). Two foundations on one node are rejected as redundant. The model has no general constraints or prescribed (forced) displacements, so incompatible constraints cannot be expressed or detected, and support settlement cannot be modelled. |
| M06 foundations and reactions | Met | Any of six DOFs restrained per foundation id; six signed reaction components. |
| M07 loads and self-weight | Met | Nodal forces and moments with ids, and uniform member loads (`memberLoads`, N/m, global) along a whole member. Self-weight and member loads are applied once as consistent nodal loads. Loads keep their original direction. Several load cases can share one call. |
| M08 card properties, one unit system | Met | Sections carry E, G, A, Iy, Iz, J, shear areas, density and capacities; braces and cables carry rest length or initial strain. SI throughout. |
| M09 stable ids, subdivision | Partly | Members, foundations and loads have ids; a connection is identified by member id and end. Subdivision for accuracy is internal and invisible. The solver does not split a member at an interior attachment: the game must send separate members and may tag them with `parentId`, which is echoed. |
| A01 linear baseline | Met | Closed-form cases to `1e-9`. |
| A02 geometric nonlinearity | Met | Corotational beam with the member P-δ term, exact large-displacement axial members, cable slackening. See limits below. |
| A03 classifications | Met | Unused DOFs, separate components, rigid-body motions, internal mechanisms, near-mechanisms, load-induced instability, excessive deformation and strength exceedance are distinct codes, flags or counts. An unloaded mechanism is `unstable`. With more than 96 null vectors the split between mechanisms and spins is by pivot DOF only. |
| A04 tangent stability | Met | Uses the constrained, unit-diagonal tangent at the solution, with the cable states and stress stiffening it has there. Modes list the nodes that move. A first-order mechanism is not final: the nonlinear equilibrium decides. The buckling shape reported is the negative-pivot direction, not an eigenvector. |
| A05 bounded recovery | Met | Shifted tangent, energy line search, adaptive load increments, iteration limits. No verified conclusion gives `unknown`. |
| A06 component isolation | Met | Each component is a separate system. |
| A07 verification | Met | Residual, global force balance and global moment balance are gated at run time. Cable states follow from the deformed length. Nothing is stabilised artificially, so no artificial reaction exists. |
| A08 robustness | Met in the browser | Invalid input, singular systems, extreme stiffness ratios and non-finite numbers give explicit results. Finite inputs whose products leave the range of a double are rejected as `numericRange` before analysis (see [Numeric range and work budget](#numeric-range-and-work-budget)). The solver bounds itself by iteration counts, per component and for the whole request; the browser adapter adds a wall-clock limit (`timeLimitExceeded`) and cancellation by terminating its worker. In Node the module runs inline and has only the iteration limits. |
| Section 4 turn resolution | Outside the solver | The solver gives what a turn engine needs: an immutable input, an echoed model version, repeatable results, capacity checks and an optional bounded failure sequence. Each analysis starts from the undeformed geometry, which matches the proposed reapply-loads policy. Transactions, previews and penalties are game work and do not exist. |
| Section 5 result contract | Met | Analysis, component, node, member, connection and foundation results with explicit `null` for unavailable values. Beam members also report displacement stations along their length and the largest sag from the chord. Run time is added by the browser adapter. Load shares are not computed: signed reactions and the applied force per component are returned for the game to apply its scoring policy. |
| Section 6 speed and surrogate | Partly | Timings below. No surrogate exists. The benchmark is one synthetic frame at two sizes on one machine, not a representative suite of game states. |
| Section 7 acceptance tests | Met | See the next table. |

## Acceptance evidence

Run with `npm run test:solver`. Rust 1.100.0, 15 November 2026. Result: 77 passed, 0 failed, 1 ignored (the timing harness). The 16 added since the first acceptance run cover deflection, member loads and load cases.

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

The targets are met on this frame and machine. They are not validated in a browser, on slower hardware, or on states that need many load increments. In the browser the analysis now runs on a worker, so it does not block the page; the benchmark measures the inline call in Node.

## Deflection, member loads and load cases

These were added after the acceptance table and have their own tests (`deflection.rs`, `member_loads.rs`, `cases.rs` and `wasmSolver.test.ts`).

- **Deflection along members.** Every beam member result has `deflection.stations`: the global displacement at each element boundary, `subdivisions + 1` points. `maxFromChord` is the largest distance of a deformed station from the line through the deformed ends, which excludes the member's rigid-body motion and its supports' movement, and `atMax` says where. On a simply supported beam under a uniform load every station matches the closed-form curve to `1e-9`, and the mid-span sag is 5wL⁴/384EI. With the default two subdivisions the only interior station is mid-span. Braces, cables and unverified results report `null`.
- **Uniform member loads.** `memberLoads` apply a force per metre, in global axes, along a whole member, handled exactly like self-weight. A member load equal to the self-weight gives the self-weight result.
- **Load cases.** A request with `cases` returns one complete result per case; each is tested to equal a separate call character for character. The saving is one model transfer and parse instead of several.

## Decisions made in the implementation

These are implementation choices, not owner decisions. Each is a default that the owner may want to change.

- **Unloaded spin is tolerated.** A motion that only rotates things in place, such as a member on ball joints turning about its own axis, is reported (`spinModes`) but does not make a component unstable unless a load acts on it. The OpenSees service does the same. Criterion A03 could be read more strictly.
- **Excessive deformation is `unstable` with valid results.** An equilibrium displaced by more than 10 % of the component's bounding-box diagonal is `unstable` with reason `excessiveDeformation`, and its results are still returned.
- **`marginal` means a reserve below 25 %.** A stable state that is not stable at 1.25 times its loads is `marginal`. This costs an extra solve.
- **Failure removes or releases.** A failed member is removed; a failed beam connection is fully released. One object fails per event, the most overloaded first, ties broken by id.
- **A removed member takes its own load with it.** When the failure sequence removes a member, its self-weight and member loads leave the model rather than being moved to its end nodes.
- **Linear axial–bending interaction** for member utilisation.
- **Two beam elements per member** by default, which gives the Euler load to 0.8 %.
- **Self-weight needs a gravity vector** in the options; there is no default direction.
- **The compiled module is committed**, so the web app does not need a Rust toolchain to build.

## Limits

- No plasticity, contact, dynamics, post-buckling path tracing, staged construction or sagging cables.
- Loads keep their direction; applied moments are not follower moments.
- A perfectly straight column past its buckling load is reported unstable; the post-buckled shape is not traced.
- Self-weight on a slack cable is still carried to its end nodes.
- Cancellation and the wall-clock limit exist only on the browser worker. Inline (Node, tests) an analysis runs to its iteration limits once started.
- Deflection is reported only at element boundaries, with no interpolation between them; a finer spacing needs more subdivisions, which cost run time.
- No prescribed displacements, and no partial-length or varying member loads. Plasticity and dynamic collapse are deferred by the criteria (section 8).
- Load cases share one request, not one factorisation: each case costs a full analysis.
- The workspace check uses gravity loads only, with no wind and no load combinations, so it is not the voxel analysis's load cases.
- The original-contract path, used only when the OpenSees service is selected, is linear and uses one steel section.
