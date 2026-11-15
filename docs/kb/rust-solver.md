---
title: "Rust Solver"
last_validated: 2026-11-15
validated_against:
  - crates/dof-solver/README.md
  - crates/dof-solver/src
  - crates/dof-solver/tests
  - packages/solver-contract/src/analysis.ts
  - apps/web/src/solver/wasm
  - apps/web/src/solver/index.ts
  - apps/web/src/game/analysisModel.ts
  - apps/web/src/game/turnAnalysis.ts
  - apps/web/src/game/finalScore.ts
  - apps/web/src/game/releaseAssessment.test.ts
  - services/opensees/tests/test_release_wasm_reference.py
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

The scored Grow Dusk release uses the nonlinear Rust 0.2.0 module for End Turn, replay, card strength and signed support attraction. The workspace editor also uses the module for its detailed stability check. Independent OpenSeesPy tests exercise matched nonlinear buckling, sway and cable models. The tests and timings below describe measured behavior. Owner acceptance is tracked in the release ledger.

## What exists

| Part | Location | State |
| --- | --- | --- |
| Solver | `crates/dof-solver` | 72 native tests passed. The crate has no third-party dependencies. |
| Detailed contract types | `packages/solver-contract/src/analysis.ts` | `AnalysisModel`, `AnalysisOptions`, `DetailedAnalysisResult`, `DetailedSolver`. |
| Browser adapter | `apps/web/src/solver/wasm/wasmSolver.ts`, `runner.ts`, `solverWorker.ts` | Serves the detailed contract, several load cases per call (`analyzeCases`), and the original `StructuralModel` contract. In a browser the module runs on a Web Worker, which is terminated on abort or after a wall-clock limit. See [Cancellation and time limit](#cancellation-and-time-limit). |
| Compiled module | `apps/web/src/solver/wasm/dof_solver.wasm` | Checked-in 706 kB module. Rebuild with `npm run build:solver`. |
| Game integration | `apps/web/src/solver/index.ts`, `apps/web/src/game/analysisModel.ts`, `apps/web/src/game/useStabilityCheck.ts` | Default solver for the workspace check, which sends the detailed model. See [Game integration](#game-integration). |

The workspace now sends the detailed model: `game/analysisModel.ts` translates the game to it, and `game/useStabilityCheck.ts` uses the detailed contract whenever the selected solver implements it. The original-contract translation in `game/structuralModel.ts` remains for the OpenSees service.

## Game integration

### Grow Dusk release

`toTurnVoxelInput` expands physical cards into analytical spans. Free tips have independent node IDs even at coincident coordinates. A materialized quarter station retains its original parent and station number. HEB and HSS members continue through the station. Cable segment rest lengths divide in proportion to the undeformed length. The 12,500 and 25,000 N/m cartridge printings retain their whole-member stiffness for every allowed span. A segment occupying fraction `f` gets stiffness `k/f`. The explicit assembly graph supplies nodes, chords, posts and diagonals when the catalogue contains an assembly.

`prepareReleaseSolver` initializes the checked-in WASM. The turn adapter sends the exact SI model from undeformed geometry with applied card gravity, two elements per beam and the printed connection freedoms. It checks each component's convergence, normalized residual, force and moment imbalance at `1e-5`. A single-entry cache requires an exact match of the serialized SI model. The result carries a model fingerprint and solver version. A failed numerical recovery yields unresolved evidence. Each independent verified component retains its own signed support reactions, cut forces and displacement samples.

A large displacement can coexist with stable equilibrium. The release preserves a verified reaction under the kernel's excessive-displacement flag and discloses that flag. The spring card separately withholds its component's scoreable response past 10% axial stroke. In the 10 m seed-14 fixture, transverse sag exceeds the component displacement limit while axial stroke stays inside the card limit. Both supports carry 2.5 kN. The spring exceeds its printed force capacity. A separate overstroke fixture withholds the affected response and retains an independent frame's 5 kN reaction.

Verified tangent instability can produce a comparison of negative inertia and translational nullity, with unloaded pure spins excluded. The game compares only identical component geometry, card properties, connector freedoms, supports and solver configuration. The adapter supplies a physical witness when it can localize the motion. A failed recovery alone does not establish an additional instability.

### Workspace editor

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

The editor's detailed-result panel was checked manually on Tower I. The scored game has its own component projection and viewer path. Its load-path display uses the signed vertical resultant at the physical member cut, including shear carried by beams. Its member deformation samples follow the analytical mesh, including relative motion at released and elastic beam endpoints. See [development and testing](development-and-testing.md).

## Cancellation and time limit

WebAssembly cannot be interrupted from inside, so the adapter (`runner.ts`) runs the module on a Web Worker (`solverWorker.ts`) and stops an analysis by terminating the worker. Requests go to the worker one at a time, in call order. The main thread compiles the module once and sends the compiled module with each request, so a replacement worker starts without downloading it again.

- **Abort.** Aborting the signal passed to `analyzeDetailed` or `analyzeCases` terminates the worker at once and rejects with the signal's reason. The workspace check already aborts the previous run when a new one starts, so a superseded analysis now actually stops.
- **Time limit.** `createWasmSolver({ timeLimitMs })`, default 10 s. It counts from when the worker starts the analysis, so time in the queue or downloading the module does not count. A timeout returns an `invalid` result with reason `timeLimitExceeded` and a message naming the limit; for `analyzeCases` every case gets it. The 10 s default is an implementation choice, not an owner decision.
- **Without a worker** (Node, the tests) the module runs on the calling thread, which it blocks, and neither applies.

Checked once by hand in the desktop app's built-in Chromium browser through the Vite dev server: a 1,344-member nonlinear frame took 4.7 s while the page's 10 ms timer kept firing (466 ticks); a 100 ms limit stopped the same frame after about 170 ms and the next call succeeded on a fresh worker; an abort after 150 ms rejected after 154 ms. The unit tests use a stand-in worker that runs the real module in-process.

## Coverage of the criteria

"Met" means implemented with a passing test that exercises it. It is a claim about this code and its tests, not owner acceptance.

| Criteria | State | Notes |
| --- | --- | --- |
| M01 six DOFs, relevant ones active | Met | Rotations of a node that no member end holds are left out and counted as `unusedDofs`. Genuine mechanisms are kept and reported. |
| M02 connectivity separate from coincidence | Met | Connectivity is by node id. Each member end has its own connection. A fully released end is not a connection. |
| M03 beam-column, brace, cable | Met | Beam-columns have optional shear deformation. Cables are straight and tension-only. |
| M04 six-law connections | Met for beam ends | Six rigid, free or elastic laws can use the undeformed member basis or the explicitly selected global basis. Both follow the physical node as it rotates. Axial elements are pinned. |
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
| A08 robustness | Met in the browser | Invalid input, singular systems, extreme stiffness ratios and non-finite numbers give explicit results. The solver bounds itself by iteration counts; the browser adapter adds a wall-clock limit (`timeLimitExceeded`) and cancellation by terminating its worker. In Node the module runs inline and has only the iteration limits. |
| Section 4 turn resolution | Integrated in Grow Dusk release | The transaction computes immutable before/after responses from undeformed geometry with the full current load set. The game records responsibilities and signed reactions, then regenerates and compares its scored receipt on replay. |
| Section 5 result contract | Implemented | Explicit component availability, signed foundation reactions, node motion, member forces and connection results. Beam members also report deflection stations and the largest sag from the chord. The release requests section-force and displacement fields and computes player attraction from verified positive vertical reactions. |
| Section 6 speed and surrogate | Partly | Timings below. No surrogate exists. The benchmark is one synthetic frame at two sizes on one machine, not a representative suite of game states. |
| Section 7 acceptance tests | Met | See the next table. |

## Acceptance evidence

Run with `npm run test:solver`. The 15 November 2026 run passed 72 native tests with one timing harness ignored. The 10,000 generated states form one of those tests.

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
| Preview, replay, random legal and invalid states | `robustness.rs`, `wasmSolver.test.ts`, `releaseAssessment.test.ts` | 10,000 seeded inputs yielded 2,938 stable, 123 marginal, 8,033 unstable and 1,532 unknown components, with 531 rejected input models. The test guards against panics, nonfinite output and valid results without verified equilibrium. Replay tests check immutable inputs and repeatable receipts. |

Large-rotation references also pass at the 1 % gate: a cantilever rolled through 90° by an end moment, and the elastica tip-load case.

Two things support the linear results beyond the closed-form cases. A unit test checks the closed-form beam stiffness against the automatically differentiated one, and the automatic gradient and Hessian against finite differences of the energy. And `crossCheck.test.ts` compares this solver with the OpenSees service through the original contract: on a mixed-connection space frame, a mechanism, and the Tower I, Bridge I and Pickup I examples, they agree on status, mechanisms, moving nodes and static indeterminacy, and on displacements, reactions and member forces within `2e-5`. That test needs the service running and is skipped otherwise.

The independent nonlinear suite runs the shipped binary and OpenSeesPy on the same geometries, material constants, boundary conditions and loading paths. The sway fixture gives 0.0054120214 m and 0.0054067377 m respectively (0.098% difference). The perfect-column critical multiplier is 1.00004883 times the analytical Euler load in WASM. OpenSees brackets loss of positive tangent stiffness at 1.00078125 to 1.00156250 on the same straight column. The symmetric sagging cable gives 379632.4530 N and 379632.4526 N in tension. Run `uv run --project services/opensees pytest -qs services/opensees/tests/test_release_wasm_reference.py`.

## Timings

`npm run bench:solver` times the checked-in WebAssembly including JSON encoding and decoding. The following run used Node 24.15.0 on an Intel Core Ultra 9 185H with 22 logical cores. Each row uses 20 samples.

| Case | Members | Unknowns | Median | p95 | Proposed target |
| --- | --- | --- | --- | --- | --- |
| Game-sized frame, linear | 46 | 376 | 3.6 ms | 5.8 ms | preview p95 ≤ 50 ms |
| Game-sized frame, nonlinear | 46 | 376 | 17.7 ms | 30.1 ms | turn ≤ 250 ms |
| Stress frame, linear, 1 element per beam | 504 | 1,280 | 26.6 ms | 29.2 ms | |
| Stress frame, linear, 2 elements per beam | 504 | 4,124 | 74.6 ms | 80.5 ms | |
| Stress frame, nonlinear, 1 element per beam | 504 | 1,280 | 280.9 ms | 332.5 ms | difficult ≤ 2 s |
| Stress frame, nonlinear, 2 elements per beam | 504 | 4,124 | 878.3 ms | 1,239.1 ms | difficult ≤ 2 s |

The ordinary preview, ordinary turn and difficult nonlinear cases met their targets in this run. The 4,124-DOF linear stress run took 80.5 ms at p95. An earlier run during development with other suites active took 2,286.5 ms for the largest nonlinear stress case. These measurements cover the kernel on this host. Production browser rendering, worker scheduling, private saves and device variation require separate measurements.

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
