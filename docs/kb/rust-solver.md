---
title: "Rust Solver"
last_validated: 2026-11-15
validated_against:
  - crates/dof-solver/README.md
  - crates/dof-solver/src
  - crates/dof-solver/tests
  - crates/dof-solver/tests/reserve.rs
  - crates/dof-solver/src/linalg.rs
  - crates/dof-solver/src/sparse.rs
  - crates/dof-solver/tests/large.rs
  - scripts/physics/compare-solver-revisions.mjs
  - apps/web/src/evaluator/evidence.ts
  - apps/web/src/evaluator/engine/releaseTurn.ts
  - apps/web/src/game/releaseSave.ts
  - apps/web/src/game/releaseSave.test.ts
  - apps/web/src/evaluator/engine/rustDesign.ts
  - packages/solver-contract/src/analysis.ts
  - apps/web/src/solver/wasm
  - apps/web/src/solver/index.ts
  - apps/web/src/game/analysisModel.ts
  - apps/web/src/game/turnAnalysis.ts
  - apps/web/src/game/finalScore.ts
  - apps/web/src/game/releaseAssessment.test.ts
  - services/opensees/tests/test_release_wasm_reference.py
  - apps/web/src/solver/wasm/crossCheck.test.ts
  - services/opensees/src/dof_opensees/builder.py
  - packages/solver-contract/src/index.ts
  - apps/web/src/game/structuralSummary.ts
  - apps/web/src/game/useStabilityCheck.ts
  - apps/web/src/components/StabilityCheckPanel.tsx
  - apps/web/src/game/analysisModel.test.ts
  - apps/web/src/evaluator/sections.ts
  - apps/web/src/evaluator/engine/siSections.ts
  - scripts/build-solver-wasm.mjs
  - scripts/bench-solver.mjs
  - docs/kb/solver-criteria.md
owner: unknown
status: partial
---

# Rust Solver

`crates/dof-solver` is a structural solver written in Rust against the [solver criteria](solver-criteria.md). It compiles to a WebAssembly module that runs in the player's browser, so no analysis service is needed. The web app loads it through `apps/web/src/solver/wasm/wasmSolver.ts` and uses it by default for the stability check.

The crate [README](../../crates/dof-solver/README.md) is the reference for building, calling, conventions, the algorithm and tolerances. This page records how the solver stands against the criteria, the evidence, and the choices that still need an owner decision.

The scored Grow Dusk release uses the nonlinear Rust 0.3.0 module for End Turn, replay, card strength and signed support attraction. The workspace editor also uses the module for its detailed stability check. Since 2026-11-15 it also runs the structure evaluation behind the editor, levels, auto-design and structure library (see [Stability reserve and the structure evaluator](#stability-reserve-and-the-structure-evaluator)). Independent OpenSeesPy tests exercise matched nonlinear buckling, sway and cable models. The tests and timings below describe measured behavior. Owner acceptance is tracked in the release ledger.

## What exists

| Part | Location | State |
| --- | --- | --- |
| Solver | `crates/dof-solver` | The native regression suites cover the detailed kernel. The crate has no third-party dependencies. |
| Detailed contract types | `packages/solver-contract/src/analysis.ts` | `AnalysisModel`, `AnalysisOptions`, `DetailedAnalysisResult`, `DetailedSolver`. |
| Browser adapter | `apps/web/src/solver/wasm/wasmSolver.ts`, `runner.ts`, `solverWorker.ts` | Serves the detailed contract, several load cases per call (`analyzeCases`), and the original `StructuralModel` contract. In a browser the module runs on a Web Worker, which is terminated on abort or after a wall-clock limit. See [Cancellation and time limit](#cancellation-and-time-limit). |
| Compiled module | `apps/web/src/solver/wasm/dof_solver.wasm` | Checked-in 774,235-byte module (solver 0.3.0, rustc 1.97.0). Rebuild with `npm run build:solver`. |
| Game integration | `apps/web/src/solver/index.ts`, `apps/web/src/game/analysisModel.ts`, `apps/web/src/game/useStabilityCheck.ts` | Default solver for the workspace check, which sends the detailed model. See [Game integration](#game-integration). |

The workspace uses `game/analysisModel.ts` for Rust's detailed contract. The optional OpenSees v2 service uses `game/structuralModel.ts` for catalogue properties, end laws, support masks and linear or corotational analysis. The Shared table release worker uses its own immutable SI turn model.

## Game integration

### Grow Dusk release

`toTurnVoxelInput` expands physical cards into analytical spans. Free tips have independent node IDs even at coincident coordinates. A materialized quarter station retains its original parent and station number. HEB and HSS members continue through the station. Cable segment rest lengths divide in proportion to the undeformed length. The 12,500 and 25,000 N/m cartridge printings retain their whole-member stiffness for every allowed span. A segment occupying fraction `f` gets stiffness `k/f`. The explicit assembly graph supplies nodes, chords, posts and diagonals when the catalogue contains an assembly.

`prepareReleaseSolver` initializes the checked-in WASM. The turn adapter sends the exact SI model from undeformed geometry with applied card gravity, two elements per beam and the printed connection freedoms. It checks each component's convergence, normalized residual, force and moment imbalance at `1e-5`. A single-entry cache requires an exact match of the serialized SI model. The result carries a model fingerprint and solver version. A failed numerical recovery yields unresolved evidence unless independent kinematic evidence proves a placed mechanism. A hinged or pinned branch cut free of every restraint can rotate without straining any element. The reference diagnosis requires these exact motions to span all translational null modes. No reaction is issued for that state. Each independent verified component retains its own signed support reactions, cut forces and displacement samples.

A large displacement can coexist with stable equilibrium. The release preserves a verified reaction under the kernel's excessive-displacement flag and discloses that flag. The spring card separately withholds its component's scoreable response past 10% axial stroke. In the 10 m seed-14 fixture, transverse sag exceeds the component displacement limit while axial stroke stays inside the card limit. Both supports carry 2.5 kN. The spring exceeds its printed force capacity. A separate overstroke fixture withholds the affected response and retains an independent frame's 5 kN reaction.

Verified tangent instability can produce a comparison of negative inertia and translational nullity, with unloaded pure spins excluded. The game compares only identical component geometry, card properties, connector freedoms, supports and solver configuration. The adapter supplies a physical witness when it can localize the motion. A failed recovery alone does not establish an additional instability.

The revision integrating the v2 shared contract records accepted load increments and filters roundoff-only model-node motion from mode diagrams. The release consumes the detailed Rust result; accepted-increment counts are diagnostic. `node scripts/physics/check-saved-solver.mjs 91d551b` reads the previous WASM from Git, repeats the purposeful production plays for seeds 0–19 and checks their archived public decisions and awards. The current private-match decoder accepted 320 planning, 320 confirmed-assessment and 20 final records from the previous binary. Draws, placements, issue history, correction receipts and scores reproduced exactly. The public evidence and the previous solver are read from the same Git revision.

### Workspace editor

With the Rust solver, Run analysis in the workspace runs this structural check, a geometrically nonlinear analysis of the detailed model, in addition to the structure evaluation. `toAnalysisModel(game, level)` makes the model as follows.

- **Sections.** Each member type in use gets its own section from the card data in `apps/web/src/evaluator/sections.ts`, converted to SI by `sectionFor` in `evaluator/engine/siSections.ts`. Capacities are axial from area times strength, bending from section modulus times strength, shear from the smaller shear area times shear strength, and, for a cable, its design resistance `NRd`. Density is derived from the card's self-weight per metre, so the solver's self-weight reproduces the card weight.
- **Cables** are tension-only members with the card pretension `P0` as initial strain.
- **Beam ends** are rigid at a node with a moment connection ("joint"). Elsewhere they are released in bending (local rotations y and z free, torsion held).
- **Foundations** restrain the DOFs in their restraint mask, or all six when they have none. Gravity is 9.81 m/s² along -Z, so self-weight is included.
- **Bending includes shear deformation**, from the cards' shear areas. The voxel analysis does not include it, so short, deep members, glulam most of all, are softer here.
- **Loads.** A tower level puts the payload on its highest nodes. A bridge level spreads traffic times span over the deck nodes between the cliffs. Other levels use the point loads placed on nodes, each along its chosen axis. As in the voxel analysis, only nodes joined to a foundation through members are considered, so a loose member cannot attract the payload.
- **Unconnected things.** Every member is sent, so a part with no foundation is reported as unsupported, under its own weight only. Nodes with no member are not sent: a foundation nothing stands on, or a weight nothing is attached to, does not appear, and a note counts the placed loads left out.

What the translation leaves out: loads are unfactored, there is no wind, and there are no load combinations. The structural check does not use load cases or member deflection; the structure evaluation, shown in the results panel, uses both (see [Stability reserve and the structure evaluator](#stability-reserve-and-the-structure-evaluator)). The voxel analysis uses four ultimate and serviceability combinations with wind and notional loads, and this check does not reproduce them, so its numbers are not comparable one to one with the voxel analysis. Utilisation is section strength only: there is no buckling reduction factor (buckling shows as instability in the nonlinear analysis instead), no deflection limit, and no joint or foundation capacity, all of which the voxel analysis checks. Shear is checked as the resultant against the smaller shear area, which is conservative. The translation returns notes saying what is left out.

The workspace's Structural check panel shows the worst component status and any strength exceedance, with the reason codes, separate parts, free DOFs, mechanisms, redundancy, largest movement, governing utilisation, slack cables and signed foundation reactions. Unverified values show as unavailable. With OpenSees selected, the panel lists the verified components' support reactions and explains any unavailable components.

On the three reference examples (Tower I, Bridge I, Pickup I) the check reports one stable, verified part with highest utilisation of 3 %, 16 % and 8 %, in roughly 10 to 90 ms each in Node on the development machine. These structures have no moment connections, so every beam end is released; the solver differentiates such elements in fewer variables since this integration, which cut the Bridge I time from about 320 ms.

The check can report things the voxel analysis does not model. A test frame of two HEB 300 members with a 500 kN eccentric load is reported as buckling at about three quarters of that load: a lateral-torsional instability that follows from the card's small torsion constant, and agrees in size with a hand estimate.

Because the analysis is 3D and connections are pinned unless a moment connection is placed, a structure that the linear original-contract check called stable can now be reported as a mechanism or as overstressed. That is the solver reporting the model as translated, not a validated engineering verdict.

The editor's detailed-result panel was checked manually on Tower I. The scored game has its own component projection and viewer path. Its load-path display uses the signed vertical resultant at the physical member cut, including shear carried by beams. Its member deformation samples follow the analytical mesh, including relative motion at released and elastic beam endpoints. See [development and testing](development-and-testing.md).

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
| M04 six-law connections | Met for beam ends | Six rigid, free or elastic laws can use the undeformed member basis or the explicitly selected global basis. Both follow the physical node as it rotates. Axial elements are pinned. |
| M05 exact rigid constraints | Covered for Shared table | Each printed lock imposes zero relative motion in its specified connector component. Fixed foundations impose zero ground motion. The kernel shares or eliminates those DOFs exactly and rejects duplicate foundations on a node. Nonzero prescribed support displacement, support settlement and arbitrary multi-point constraints are outside the input model. |
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
| Section 4 turn resolution | Integrated in Grow Dusk release | The transaction computes immutable before/after responses from undeformed geometry with the full current load set. The game records responsibilities and signed reactions, then regenerates and compares its scored receipt on replay. |
| Section 5 result contract | Implemented | Explicit component availability, signed foundation reactions, node motion, member forces and connection results. Beam members also report deflection stations and the largest sag from the chord. The release requests section-force and displacement fields and computes player attraction from verified positive vertical reactions. |
| Section 6 speed and surrogate | Partly | Timings below. No surrogate exists. The benchmark is one synthetic frame family at five sizes on one machine, not a representative suite of game states. Since 0.3 large structures factorise sparsely; see [Solver 0.3](#solver-03-sparse-factorisation-for-large-structures). |
| Section 7 acceptance tests | Met | See the next table. |

## Acceptance evidence

Run with `npm run test:solver`. On 15 November 2026 the 0.3.0 suite, merged with `main` at `c41571d`, passed 108 native tests, including seven numerical range and work-budget cases, the connection-spin reporting regression, main's stability-reserve tests and the sparse-path tests of 0.3. The 10,000 generated states form one test; 4,000 more run with every system forced onto the sparse factorisation. One timing harness is opt-in.

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
| Preview, replay, random legal and invalid states | `robustness.rs`, `wasmSolver.test.ts`, `releaseAssessment.test.ts` | 10,000 seeded inputs yielded 2,938 stable, 123 marginal, 8,138 unstable and 1,427 unknown components, with 531 rejected input models. The test guards against panics, nonfinite output and valid results without verified equilibrium. Replay tests check immutable inputs and repeatable receipts. |

Large-rotation references also pass at the 1 % gate: a cantilever rolled through 90° by an end moment, and the elastica tip-load case.

`apps/web/src/solver/wasm/turnCatalogue.test.ts` checks 24 cases through match topology expansion and the shipped WASM adapter. All three material quarters of the zero-pretension release cable match the independent extensible-string force solution. Each quarter of HEB, IPE, SHS, CHS and glulam matches cantilever bending with shear flexibility. For the 19-piece planar and 41-piece spatial assemblies, deflection and spatial twist agree within 1% with independently assembled OpenSeesPy models. Regenerate the assembly references with `docs/evidence/planar/reference.py --shear` and `docs/evidence/trichord/reference.py --shear`. The expanded family fixtures use their authored catalogue geometries. The curated release deck deals HEB, cable and spring.

Two things support the linear results beyond the closed-form cases. A unit test checks the closed-form beam stiffness against the automatically differentiated one, and the automatic gradient and Hessian against finite differences of the energy. And `crossCheck.test.ts` compares this solver with the OpenSees service through the shared contract: on a mixed-connection space frame, a mechanism, the Tower I, Bridge I and Pickup I examples and the twenty library structures at both fidelities. Tower I and Bridge I carry no placed point loads, so for them it checks stability and redundancy only. That test needs the service running and is skipped otherwise. Its measured results are in [Cross-check with OpenSees](#cross-check-with-opensees--2026-11-15).

The independent nonlinear suite runs the shipped binary and OpenSeesPy on the same geometries, material constants, boundary conditions and loading paths. The sway fixture gives 0.0054120214 m and 0.0054067377 m respectively (0.098% difference). The perfect-column critical multiplier is 1.00004883 times the analytical Euler load in WASM. OpenSees brackets loss of positive tangent stiffness at 1.00078125 to 1.00156250 on the same straight column. The symmetric sagging cable gives 379632.4530 N and 379632.4526 N in tension. Run `uv run --project services/opensees pytest -qs services/opensees/tests/test_release_wasm_reference.py`.

The independent service's v2 driver identifies the above-critical column as unstable, locates the mode at the tip, reports the limiting load factor and withholds reactions. The matched release test asserts all four properties as well as the 2% critical-load gate. On 15 November 2026 the full integrated `npm run test:opensees` gate passed 719 of 726 collected tests. Six optional-service skew-axis cases were skipped because the specified releases cannot be represented on those members. One skipped case was the opt-in single-seed diagnosis. The run includes the service's separate 10,000-state historical matrix and 300 newer generated states. The 20-fixture `compare:solvers` script records editor verdict disagreements and compute/wall time. Its results describe the voxel and optional linear/nonlinear HTTP paths. Shared table's authoritative numerical checks use the release WASM.

## Stability reserve and the structure evaluator

`options.reserveSearch` (a limit in (1, 1e4]) adds `reserve: {lower, upper, cause}` to each verified stable or marginal nonlinear component. It is the load multiplier, relative to the applied load, at which the equilibrium stops being stable. The field is absent unless requested, so existing responses, including the release's, are unchanged. There are two methods (`options.reserveMethod`):

- **`path`** (default) continues the verified equilibrium under increasing load: doubling, then six geometric bisections. It finds bifurcations (`cause: "instability"`) and limit points (`"noEquilibrium"`). Each continuation increment may move no node more than 1 % of the component size, so an energy-descent step cannot jump across a snap-through to a remote branch. Probes are limited to 12 Newton iterations and 1/32 of the probed interval.
- **`linearized`** extrapolates the verified tangent along the path, `Kt + (t − 1) dK/dt`, with a 1 % forward difference along `du = Kt⁻¹ λf`. Each probe costs one factorisation and no Newton iterations; it finds bifurcations only.

`tests/reserve.rs` covers both methods:

- an Euler column (path and linearised within the 2 % mesh gate);
- agreement with direct analyses at both bounds;
- a tie, stable to the limit;
- a shallow two-bar arch, whose limit point is within 10 % of the shallow-arch formula;
- a fixed-base sway portal, where the two methods agree;
- budget exhaustion, which reports `reserveSearchIncomplete` and keeps the verified result;
- absence of the field unless requested, and rejection of invalid options.

The structure evaluator (`apps/web/src/evaluator/engine/rustDesign.ts`) sends its four design combinations through `analyzeCases`, with nonlinear fidelity, member fields and two elements per beam. The ultimate combinations add `reserveSearch: 128, reserveMethod: "linearized", stabilityMargin: 1`. On the game's bridge reference this took about 70 ms against 4.9 s for the path method. Measured against the path method on the structure library, the linearised reserve agrees within about 1 % on four specimens and is lower on five (up to 10× on the flexible roof grid). It is higher on the guyed mast (110 against 75). See [voxel retirement](voxel-retirement.md) for the evaluator's comparison with the voxel results.

The rebuilt module keeps the release's results: `node scripts/physics/check-saved-solver.mjs 39508f0` reproduced all 20 archived browser matches and 660 confirmed records. The checked-in binary was rebuilt with rustc 1.97.0; a WASM build varies by toolchain, and production builds compile from source.

The option `maxRequestIterations`, which the Rust parser already accepted, is now declared in the TypeScript contract.

## Solver 0.3: sparse factorisation for large structures

**Why.** In 0.2 every stiffness was factorised as a skyline (profile) LDLᵀ in reverse Cuthill–McKee order. For a three-dimensional frame that costs about n^(7/3): measured natively, one factorisation took 53 ms at 4,124 equations, 5.2 s at 29,188 and 26 s at 57,512. A nonlinear analysis needs about five, so a 3,510-member frame took 27.7 s natively and 25 s in WebAssembly, past the browser worker's 10 s limit, while the input limit allows 10,000 members.

**What changed** (`crates/dof-solver/src/linalg.rs`, `sparse.rs`):

- **Choice by size.** A system whose skyline factorisation would cost at most `SMALL_WORK` = 4e6 multiply-adds (about a millisecond) keeps the 0.2 skyline code. Every structure of game size is below it. Larger systems use the sparse factor.
- **Sparse factor.** Equations are reordered by approximate minimum degree on the quotient graph, with equations of identical structure merged into weighted supervariables. The elimination tree is postordered, small supernodes are merged into their parents within CHOLMOD's relaxation limits, and each supernode is factorised as a dense front, a panel and an update matrix, with a four-column update kernel. If minimum degree would do more work than the equation order (a chain), the equation order is kept. The semantics are the skyline's: unit-diagonal scaling, `1e-10` null pivots as exact restraints, inertia, solves and null vectors. The crate still has no dependencies.
- **One factorisation per exact tangent.** A factor handed to the next Newton solve is marked when it is exactly the unshifted matrix that solve would build at its start: the linear-stage stiffness for the first iteration (no gauged spin, cable states as at the reference), each converged load increment, the converged state for the stability-margin probe, and the undeformed tangent shared by all 13 critical-load bisection probes. Over 13,003 differential states the result documents were byte-identical with and without the reuse.
- **Main's stability reserve.** Its linearised method blends two tangents; the sparse matrix supports the same blend, so the search works at any size.

**Why small systems keep the skyline.** A different elimination order changes which DOF carries a null or negative pivot, the smallest pivot, and rounding. In near-singular states that can cross the `1e-10` null or `1e-7` near-mechanism threshold, or break an exact tie in the choice of spin gauge. Before the size rule, minimum degree on every system changed the status or reasons of about 330 of 13,003 random states. The changes went both ways: one state with a 2.3e-12 eigenvalue was correctly reclassified as a mechanism where 0.2 had called it marginal, and one gauge tie made a verified state `unknown`. Keeping the skyline below the threshold confines such differences to structures 0.2 could not analyse in useful time.

**Evidence.**

| Check | Result |
| --- | --- |
| Native differential against `main` (`c41571d`): 10,000 robustness states, 3,000 larger nonlinear states, 1,500 states with both reserve methods, 3 stress frames | 14,500 documents identical apart from `solverVersion`. The three stress frames (sparse path) agree in every status, count and flag; displacements within 3.4e-13 relative. |
| `node scripts/physics/compare-solver-revisions.mjs origin/main` and `... 39508f0` | Release seeds 0–19: all 320 turn states, final scores and all 276 raw result documents identical to both earlier binaries. Against `91d551b` the raw documents differ, which shows the check detects a changed binary. |
| `node scripts/physics/check-saved-solver.mjs 91d551b` | 20 archived browser matches compared, 660 confirmed records replayed. |
| `tests/large.rs` | Stress frame (linear and nonlinear, 1 and 2 elements per beam), a buckling column grid (13 negative pivots, identical critical load factor 0.52014), both reserve methods: identical classifications on both factorisations, results within 1e-9 (linear) and 1e-7 (nonlinear). On a 5,190-equation sway mechanism the sparse factor finds all 31 null vectors (residual below 1e-12, smallest positive pivot 2e-4). The skyline keeps one as a 2.6e-10 rounding pivot and reports one spin fewer. |
| Factor unit tests (`sparse.rs`) | In both orders: agreement with the skyline on regular and indefinite matrices; exact null vectors, with no false nulls. On 30 deliberately rank-deficient random matrices (up to 40 % nullity) the sparse factor missed 21 null directions and reported 10 rounding-sized negative pivots in total, against the skyline's 46 and 27. |
| `npm test`, `npm run typecheck`, `npm run test:opensees`, live `crossCheck.test.ts` | 816 passed (12 skipped), clean, 719 passed (7 skipped), 6 passed. |

**Release identity.** New release and Rust-playtest evidence names `dof-rust-0.3.0-nonlinear-1` (`evaluator/evidence.ts`). The accepted ids are 0.2.0 and 0.3.0, on the evidence above. A save header or final receipt written by 0.2.0 still loads, and a replayed award keeps the id of the award it reproduces. Stored instability comparisons use a fixed numerics identity (`RELEASE_COMPARISON`), so witnesses recorded under 0.2.0 still compare with turns played under 0.3.0. `releaseSave.test.ts` loads a finished match saved by 0.2.0 with the same awards and rejects an unknown solver.

**Run time** (WebAssembly in Node 22.23.4, 4-core Intel Xeon 2.1 GHz container, median; v2 is the module before this change):

| Case | DOFs | v2 | v3 |
| --- | --- | --- | --- |
| Game-sized frame, linear | 376 | 2.2 ms | 2.2 ms |
| Stress frame, linear, 2 elements per beam | 4,124 | 63.3 ms | 34.2 ms |
| Stress frame, nonlinear, 2 elements per beam | 4,124 | 384 ms | 165 ms |
| 8×8×8 frame, nonlinear | 15,456 | 5.6 s | 0.95 s |
| 10×10×10 frame, linear | 29,188 | 4.4 s | 0.46 s |
| 10×10×10 frame, nonlinear | 29,188 | 25.0 s | 2.2 s |

Game-sized nonlinear runs measured 12–20 ms for both, within this container's noise. Natively the 12×12×14 frame with two elements per beam (57,512 equations) fell from 133 s to 5.9 s nonlinear and from 26.7 s to 1.07 s linear. Large nonlinear runs are now dominated by about four factorisations, roughly half of whose work is the final dense separator block (about 3e9 multiply-adds per second natively).

**Relation to the structure-evaluator work (`nico/eager-maxwell-gsphds`, PR #21).** That branch, merged into `main` at `c41571d` before 0.3, added the opt-in stability reserve search (`path` and `linearized`, `tests/reserve.rs`). It moved the editor, levels, auto-design and structure library onto the Rust solver (`evaluator/engine/rustDesign.ts`) and new Shared table playtest matches onto the release turn solver (`engine: "rust-1"`). It also recorded the 2026-11-15 owner decisions, including the linearised α_cr method ([voxel retirement](voxel-retirement.md#owner-decisions-2026-11-15)). Solver 0.3 builds on it unchanged:

- Its reserve search runs on both factorisations: the linearised method's tangent blend has a sparse counterpart, and `tests/large.rs` checks both methods on a large column grid.
- The 1,500 reserve-search states of the native differential match its solver exactly.
- Its evaluator and playtest tests, its structure-library baseline (refreshed, see [development and testing](development-and-testing.md#solver-03-sparse-factorisation--2026-11-15)) and its saved-solver replay check all pass on 0.3.
- Its Rust playtest matches use the same release identity, so they accept 0.2.0 and 0.3.0 receipts like the release does.

Because the evaluator now sends whole level and library structures with four load combinations to Rust, the larger of them are the first in-game users of the sparse path. In the library that is `12-midrise`.

**Still open.** WebAssembly threads would need cross-origin isolation and a nightly toolchain, so all of this runs on one core. Load cases still each factorise their own stiffness. Element tangents are still formed by second-order forward differentiation; assembly becomes the larger share for mid-sized structures.

## Cross-check with OpenSees — 2026-11-15

Run on `main` at `39508f0` plus the extended `crossCheck.test.ts`, in a Linux container (4-core Xeon, Node 22.23, OpenSees 3.8.0 / dof-opensees 0.1.0 started with `npm run dev:opensees`), using the committed WASM module. Each of the 20 library structures and 3 reference examples was translated with `toStructuralModel` and sent to both solvers at linear and nonlinear fidelity (46 runs). Differences are the largest absolute difference divided by the OpenSees maximum of that quantity: translations, signed reactions (forces and moments scaled separately), member axial force and end moments.

| Group | Runs with results | Largest displacement difference | Reaction | Axial force | End moment |
| --- | --- | --- | --- | --- | --- |
| Linear, no prestressed cables | 18 | 3.9e-13 | 1.2e-13 | 1.3e-13 | 1.3e-11 |
| Linear, prestressed cables (15 cable bridge, 18 guyed mast) | 2 | 5.8e-3 (cable bridge) | 3.0e-3 | 3.9e-3 | 4.9e-3 |
| Nonlinear | 18 | 4.7e-4 (cable bridge) | 2.0e-4 (roof grid) | 5.3e-4 (timber portal) | 3.7e-4 (pyramid) |

All linear runs without prestress agree to rounding. All nonlinear runs are within the criteria's 1 % reference gate. Verdicts, translational mechanism counts and static indeterminacy agree on 44 of 46 runs, including the released portal, floating component and missing foundation (unstable) and the slender column (nonlinear buckling). For buckling the two solvers list different moving nodes, because a mode shape's node list depends on each solver's cut-off, so the test compares only the verdict there.

**Prestressed linear cables: a contract reading, not a defect.** With `initialStrain` removed, both cable fixtures agree to 1e-14 (pinned by a test). The difference grows in proportion to the prestrain and comes from two choices for a prestressed axial member in a *linear* analysis:

- Rust linearises about the prestressed state, including the geometric stiffness `N₀/L` transverse to the member (`BarGeom::linear` in `crates/dof-solver/src/element.rs`). OpenSees' linear `Truss` with `InitStrainMaterial` has no geometric stiffness.
- Rust takes `initialStrain` as defining a rest length `L₀ = L/(1+ε₀)` with axial stiffness `EA/L₀`. OpenSees uses `N = EA(Δ/L + ε₀)`, stiffness `EA/L`. At the game's ε₀ = 4.3e-4 this alone is a 4e-4 relative difference, which is what the guyed mast shows (2.6e-5 after scaling).

Both readings fit the contract text in `packages/solver-contract/src/index.ts`. Nonlinear analysis sends cables as a `law` with an explicit rest length, so no ambiguity arises there (the guyed mast agrees to 1e-12). The contract should state which linear convention is intended. Until it does, the test accepts 1 % for this case.

**Rust leaves two nonlinear cases unresolved where OpenSees classifies them.**

| Fixture | Rust nonlinear | OpenSees nonlinear | Rust linear |
| --- | --- | --- | --- |
| 03 cantilever (L-shaped column and arm) | `unresolved`, `not_converged`, load factor 0.486 | `unstable`, `load_induced_instability` (out-of-plane mode at the tip) | `stable` |
| 05 released portal | `unresolved`, `not_converged` | `unstable`, `internal_mechanism` (9 translational) | `unstable`, `internal_mechanism` (9 translational) |

Rust's answer is conservative: it reports no result rather than a wrong one. But it is less informative than OpenSees. In the released portal it drops a mechanism that its own linear stage found, because the nonlinear stage decides the verdict and then fails to converge. Under the confirmed turn rules unresolved results do not trigger a deduction. This run did not check whether the Shared table turn model can produce an equivalent structure. The test pins exactly these two cases, so an improvement or regression in either solver shows up as a failure.

## Timings

`npm run bench:solver` times the checked-in WebAssembly including JSON encoding and decoding. It now also times three large frames, which use the sparse factorisation; 0.3 timings are in [Solver 0.3](#solver-03-sparse-factorisation-for-large-structures). The following 0.2 run used Node 24.15.0 on an Intel Core Ultra 9 185H with 22 logical cores. Each row uses 20 samples.

| Case | Members | Unknowns | Median | p95 | Proposed target |
| --- | --- | --- | --- | --- | --- |
| Game-sized frame, linear | 46 | 376 | 3.8 ms | 6.5 ms | preview p95 ≤ 50 ms |
| Game-sized frame, nonlinear | 46 | 376 | 15.3 ms | 18.2 ms | turn ≤ 250 ms |
| Stress frame, linear, 1 element per beam | 504 | 1,280 | 23.6 ms | 27.2 ms | |
| Stress frame, linear, 2 elements per beam | 504 | 4,124 | 65.4 ms | 78.2 ms | |
| Stress frame, nonlinear, 1 element per beam | 504 | 1,280 | 112.2 ms | 124.0 ms | difficult ≤ 2 s |
| Stress frame, nonlinear, 2 elements per beam | 504 | 4,124 | 331.7 ms | 390.0 ms | difficult ≤ 2 s |

A re-run on 15 November 2026 at `39508f0`, in a 4-core Intel Xeon (2.1 GHz) Linux container with Node 22.23.4, gave p95 values of 5.0 ms and 23.7 ms for the game-sized linear and nonlinear rows, 34.8 ms and 94.2 ms for the linear stress rows, and 170.5 ms and 482.8 ms for the nonlinear stress rows. All proposed targets were met again.

The ordinary preview, ordinary turn and difficult nonlinear cases met their targets in this run. The 4,124-DOF linear stress run took 78.2 ms at p95. An earlier run during development with other suites active took 2,286.5 ms for the largest nonlinear stress case. These measurements cover the kernel on this host. Production browser rendering, worker scheduling, private saves and device variation require separate measurements.

Before 0.3, the 4,124-DOF case was profiled separately with 40 linear calls. Of the sampled CPU time, 65.4% went to the skyline LDLᵀ factorization, 4.4% to element assembly, 2.4% to forward/back substitution and 1.7% to system construction. The optimized WASM factor uses packed two-lane double-precision multiply and add. The native phase harness measured 44.3 ms for one factorization, 3.7 ms for system construction and 1.4 ms for one substitution. That profile led to the sparse factorisation of 0.3, which this system size now uses.

To capture a comparable V8 profile, run `node --cpu-prof scripts/bench-solver.mjs 40 "stress, linear preview, 2 elements/beam"`. Node writes a CPU profile to the current directory, or to the directory named by `--cpu-prof-dir`. `DOF_BENCH_WASM` can point at a separately built module with release optimization, symbols and the crate's normal WASM flags to expose function names. Run the native phase harness with `cargo test --release --manifest-path crates/dof-solver/Cargo.toml --test profile -- --ignored --nocapture`.

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
- **Linear analysis of prestressed bars** is linearised about the prestressed state, with geometric stiffness `N₀/L` and axial stiffness `EA/L₀`. The OpenSees service reads `initialStrain` differently. See [Cross-check with OpenSees](#cross-check-with-opensees--2026-11-15).
- **Linear axial–bending interaction** for member utilisation.
- **Two beam elements per member** by default, which gives the Euler load to 0.8 %.
- **Self-weight needs a gravity vector** in the options; there is no default direction.
- **The compiled module is committed**, so the web app does not need a Rust toolchain to build.
- **Skyline below 4e6 multiply-adds, sparse above** (`linalg::SMALL_WORK`), so that game-sized results stay bit-for-bit those of 0.2. See [Solver 0.3](#solver-03-sparse-factorisation-for-large-structures).

## Limits

- Plasticity, contact, dynamics, post-buckling path tracing and staged construction are outside the model.
- Loads keep their direction; applied moments are not follower moments.
- A perfectly straight column past its buckling load is reported unstable; the post-buckled shape is not traced.
- Straight, extensible, tension-only cable legs can sag under concentrated loads at their shared clamps. The release uses original material lengths and point gravity loads. For the editor's distributed cable weight the solver assigns half to each end of each leg. A continuously curved self-weight catenary is outside this formulation.
- Cancellation and the wall-clock limit exist only on the browser worker. Inline (Node, tests) an analysis runs to its iteration limits once started.
- Deflection is reported only at element boundaries, with no interpolation between them; a finer spacing needs more subdivisions, which cost run time.
- No prescribed displacements, and no partial-length or varying member loads. Plasticity and dynamic collapse are deferred by the criteria (section 8).
- Load cases share one request, not one factorisation: each case costs a full analysis.
- Everything runs on one core: WebAssembly threads need cross-origin isolation and a nightly Rust toolchain.
- The workspace check uses gravity loads only, with no wind and no load combinations, so it is not the voxel analysis's load cases.
- The OpenSees v2 service has its own representability and work limits, documented in its [README](../../services/opensees/README.md). Its optional editor results use the catalogue model supplied to the HTTP endpoint.
