---
title: "Development and Testing"
last_validated: 2026-11-14
validated_against:
  - docs/kb/game-completion-criteria.md
  - docs/kb/element-representation-criteria.md
  - docs/kb/joint-dof-criteria.md
  - docs/kb/avatar-criteria.md
  - prototypes/timburr-companion/README.md
  - package.json
  - apps/web/package.json
  - packages/solver-contract/package.json
  - apps/web/src/game/store.test.ts
  - apps/web/src/solver/voxel.test.ts
  - apps/web/src/solver/loadPath.test.ts
  - apps/web/src/solver/opensees.test.ts
  - apps/web/src/game/structuralModel.test.ts
  - apps/web/src/game/analysisModel.test.ts
  - apps/web/src/game/analysisModel.ts
  - apps/web/src/game/structuralSummary.ts
  - services/opensees/pyproject.toml
  - services/opensees/tests
  - prototypes/voxel-struct/README.md
  - docs/kb/solver-criteria.md
  - docs/kb/solver-criteria-gap-analysis.md
  - docs/kb/rust-solver.md
  - crates/dof-solver
  - scripts/build-solver-wasm.mjs
  - scripts/bench-solver.mjs
  - apps/web/src/solver/wasm
owner: unknown
status: partial
---

# Development and Testing

From the repository root, install dependencies with `npm install`, start the web app with `npm run dev`, build with `npm run build`, check TypeScript with `npm run typecheck`, and run tests with `npm test`. The dev command builds the shared contract before starting Vite; rebuild it after editing its source. The root build builds the contract before the web app.

Vitest covers voxel editing rules, undo, examples, persistence, turn replay and attachment rules, viewer picking candidates, force labels, and selected analysis cases including equilibrium, signed loads and Shared table connection behavior. These tests do not independently validate numerical accuracy or exercise the viewer in a browser. The proposed [solver acceptance suite and numerical gates](solver-criteria.md#7-acceptance-tests) now define the target coverage. Most fixtures, absolute tolerances, characteristic scales, and turn/replay tests still need implementation; see the [gap analysis](solver-criteria-gap-analysis.md). Passing the current tests does not establish compliance with those gates.

Vitest also covers the OpenSees adapter against a stubbed `fetch`, solver selection, and the translation from the game model to the shared contract. Further tests run only when `VITE_OPENSEES_URL` points at a running service: two send a cantilever and the reference examples through it, and three compare its answers with the Rust solver's.

`analysisModel.test.ts` covers the translation of the game to the detailed contract (SI sections and capacities, pinned and rigid ends, cables, foundations, level loads) and runs the three reference examples and small frames through the real WebAssembly module, including the reduction of the result for the panel. Vitest runs the Rust solver as the real WebAssembly module, loaded from `apps/web/src/solver/wasm/dof_solver.wasm`. That file is a committed build artefact, so `npm install`, `npm test` and `npm run build` need no Rust toolchain. They test whatever module is committed: after changing `crates/dof-solver`, run `npm run build:solver` or the web tests will exercise the old build.

## Rust solver

Working on `crates/dof-solver` needs [Rust](https://rustup.rs) with the WebAssembly target (`rustup target add wasm32-unknown-unknown`). It was built here with Rust 1.100.0; on Windows the `stable-x86_64-pc-windows-gnu` toolchain works without Visual Studio.

| Command | Does |
| --- | --- |
| `npm run test:solver` | `cargo test`: 11 unit tests and 42 acceptance tests, about a minute. |
| `npm run build:solver` | Builds the release module and copies it into the web app. |
| `npm run bench:solver` | Times the committed module in Node on a game-sized and a stress frame. |
| `cargo test --release --test profile -- --ignored --nocapture` (in the crate) | Prints the time spent in assembly, factorisation and each analysis. |

The crate deliberately has no third-party dependencies and carries its own JSON reader and writer. One reason is a small, self-contained module. The other is practical: on the machine it was developed on, endpoint security removed the build script of the `serde` JSON library as soon as it was compiled, so a dependency on it could not be built there.

Run Cargo from the crate directory when calling it directly, because its `.cargo/config.toml` sets the WebAssembly stack size and SIMD flag. The npm scripts do this for you, except `test:solver`, which runs natively and does not need those settings.

The OpenSees service in `services/opensees` is a Python project that needs [uv](https://docs.astral.sh/uv/); uv installs the pinned Python 3.12 and dependencies on first use. Start it with `npm run dev:opensees` (port 8000) and test it with `npm run test:opensees`. Its pytest suite compares results with closed-form cases and covers mechanisms, validation, and the HTTP layer; see [structural solver](structural-solver.md#opensees-service). `npm test` does not run the Python tests. The service Dockerfile has not been built or tested. To see the OpenSees stability check in the app, run the service in one terminal and the web app with `VITE_SOLVER=opensees` in another, and press Run analysis; the panel and its agreement with the voxel result on the Tower I example were checked by hand in a browser. Without that setting the panel shows the Rust solver's check.

Run the maintained workspace with `npm run dev`. The [original prototype notes](../../prototypes/voxel-struct/README.md) link to the archived standalone implementation and describe its historical checks.

## Unified runtime integration validation — 2026-11-14

The Grow Dusk prototype-parity change (layout, dock, load pad, joint card, bloom and gizmo; see [unified runtime](unified-runtime.md#grow-dusk-and-its-prototype)) was made on a machine without Node: typecheck, tests, build and browser checks were **not** run for it and it adds no tests. Verify it in CI and in a browser before relying on it.

Before that change, the integration with current main passed TypeScript and 94 Vitest tests across 21 files. Two live OpenSees tests were skipped because no service URL was configured; this run does not verify the Python service or deployment. Browser checks compared all five environment views with prototype captures and exercised Grow Dusk and Kit simulation results, match persistence, style selection and compact layouts. Follow-up fixes addressed source glyphs, active tools, camera framing, result contrast and narrow-screen overlaps. The browser connection became unavailable before a final visual pass on the last portrait-specific overrides; those overrides received static and TypeScript checks.

The web CI workflow runs dependency installation, TypeScript, Vitest and production build, then uploads `apps/web/dist`. Static hosting must route unknown application paths such as `/play` to `index.html`. CI produces an artifact; it is not an automatic hosting deployment.

## Solver criteria documentation validation — 2026-11-14

Validated the criteria documentation against main baseline `b01a30e` and the owner-supplied text:

| Check | Result |
| --- | --- |
| `npm test` | Pass: 5 test files, 28 tests. Existing regression coverage only; not the complete criteria acceptance suite. |
| `npm run build` | Pass. Vite reports a minified chunk over 500 kB; bundle optimization remains outside this documentation change. |
| `npm run typecheck` | Pass. |
| Criteria source comparison | Pass: supplied document body preserved, with normalized line endings and KB metadata added. |
| Local documentation links and anchors | Pass: 27 links/anchors across the root README and KB pages resolve. |

The [gap analysis](solver-criteria-gap-analysis.md) records the unimplemented and unverified requirements. No new numerical capability, benchmark result or accuracy claim is introduced by this update.

## Deferred avatar prototype evidence — 2026-11-14

The [Timburr avatar criteria](avatar-criteria.md) are design requirements, not current test coverage. The [prototype handoff](../../prototypes/timburr-companion/README.md#evidence-recorded-before-work-stopped) records the experiment’s build/test evidence, browser WebGL failure and unfinished fallback. The code/assets are preserved in an unapplied patch and removed from the active app. Its reported 94 passing tests predate the final fallback edits; neither live character rendering nor complete avatar compliance has been established. Future work must validate the patch against current main and complete the criteria’s acceptance scenarios.

## Joint DOF criteria validation scope

The [joint DOF criteria](joint-dof-criteria.md) are documentation only. They revise shared-joint connection freedoms and foundation defaults and define permission and instability overlays. No new UI, solver behavior, migration or validation tests are implemented here. Future acceptance must cover physical-axis compatibility, mixed-profile legacy data, relative-versus-ground meaning, global coupling, mode provenance, toggles, accessibility and non-mutation.

## Element geometry criteria validation scope

[Element representation criteria](element-representation-criteria.md) are a documentation specification. Required future checks include section dimensions/openings, helix parameters, planar/trichord panel topology, local roll, true-scale versus readable display, assembly identity, valid deformation, LOD, picking and measured resource/performance budgets. No geometry generator, solver or runtime test was added by the criteria change; documentation links and consistency were checked.

## Whole-game completion criteria scope

[Core completion criteria](game-completion-criteria.md) cover all eight requested design areas. [Release acceptance](release-acceptance-criteria.md) defines the end-to-end setup/draw/build/quarter-attach/analyze/assess/commit/handoff/final-score/save-reload matrix, supported-scope declaration and failure-injection/privacy/accessibility evidence. These are future gates, not added runtime tests or demonstrated numerical support. This documentation change validates links, source consistency and separation of confirmed decisions from proposed parameters.

## Correction follow-up decisions validation scope

The follow-up criteria record retained historical penalties, unequal elastic stiffnesses with matching freedoms/axes, verified-component final awards and game-owned automatic correction for both instability and overload. Future evidence must cover physical repair definitions, original-versus-corrected attribution, component validity, idempotent persistence, explanatory UI and bounded failure behavior. No implementation or solver-capability validation is introduced by these documentation updates.


## Permanent local neutral repair validation scope

The owner confirmed neutral system scaffolding/ground anchors, no player attraction award, permanent in-match lifetime and local direct intervention. Criteria checks must distinguish local edits from indirect global redistribution and independently measure verified neutral share versus unverified/unawarded scope. Future tests must verify whole-structure equilibrium/capacities, persistent repair IDs after reinforcement/reload, unchanged player cards and one historical penalty event. Only documentation was changed; no automatic repair, physical locality guarantee or numerical validation is implemented here.

## Core-game criteria merge review — 2026-11-14

Reviewed the completion criteria against latest main baseline `d18e5e2`, preserving the separately contributed visualization specification and concurrent menu/placement implementation updates. Confirmed all eight completion pages are reachable from the KB index and decision hub, and the register has 17 unique confirmed decisions. Corrected older text that still treated assembly-card economy/scoring as undecided, described the local turn system as absent, or omitted the neutral-system exception to player setup-only foundations.

Validated 226 relative documentation links/anchors across the root README and all 27 KB pages, plus whitespace checks. Cross-checked final-only adjusted scoring, unequal elastic stiffnesses, original-quarter attachments, assembly plays, retained historical penalties, permanent neutral local repairs, and separate verified-neutral versus unavailable reaction scope. Existing visualization art/overlay decisions were preserved and linked to the confirmed scoring/repair policy. Remaining numerical, balance, physical-catalogue and device parameters stay explicitly proposed/open.

The merge changes documentation only; application, shared-contract, service and archived-prototype bytes are unchanged from the latest main baseline. Runtime/numerical/browser tests were not rerun for this documentation-only review, and no implementation, solver correctness or performance acceptance is claimed. Future release evidence must follow [whole-game acceptance](release-acceptance-criteria.md).

## Rust solver validation — 2026-11-14

Run on Windows 11 with Rust 1.100.0 and Node 24.16.0, on the branch that adds `crates/dof-solver`.

| Check | Result |
| --- | --- |
| `npm run test:solver` | Pass: 53 tests, 1 ignored timing harness. Includes 10,000 seeded random states with no unhandled failure. |
| `npm test` | Pass after merging main at `5621119`: 27 test files and 162 tests; 1 file and 5 tests are skipped without an OpenSees service. The adapter and game-translation tests run the committed WebAssembly module. |
| `VITE_OPENSEES_URL=http://127.0.0.1:8000 npm test` with the service running | Pass: 9 test files, 55 tests, before the game-translation tests were added and before main was merged; not re-run since. The Rust solver and OpenSees agree on a space frame, a mechanism and the three reference examples. |
| `npm run typecheck` | Pass. |
| `npm run build` | Pass. The bundle includes `dof_solver.wasm` (704 kB, 231 kB gzipped). The existing chunk-size warning remains. |
| Module served by the Vite dev server | Pass: served as `application/wasm` and gives the closed-form cantilever deflection when loaded from the dev server and from the production bundle. |
| Structural check panel in a browser | Not checked. The browser pane was not visible during this work, so the page could not be driven. The panel is covered by type checking, and what it shows by the `summarizeAnalysis` tests. |
| `npm run bench:solver` | Timings recorded on the [Rust solver page](rust-solver.md#timings). |

Measured errors, the outcome counts of the random states and the limits of this evidence are on the [Rust solver page](rust-solver.md). The evidence shows that the solver's tests pass. It does not show owner acceptance of any criteria milestone, and it includes no comparison with an independent nonlinear program.
