---
title: "Development and Testing"
last_validated: 2026-11-14
validated_against:
  - package.json
  - apps/web/package.json
  - packages/solver-contract/package.json
  - apps/web/src/game/store.test.ts
  - apps/web/src/solver/voxel.test.ts
  - apps/web/src/solver/loadPath.test.ts
  - apps/web/src/solver/opensees.test.ts
  - apps/web/src/game/structuralModel.test.ts
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

Vitest covers voxel editing rules, undo, examples, persistence behavior and selected analysis cases, equilibrium, reference examples and load-path behavior. These tests do not independently validate numerical accuracy or exercise the viewer in a browser. The proposed [solver acceptance suite and numerical gates](solver-criteria.md#7-acceptance-tests) now define the target coverage. Most fixtures, absolute tolerances, characteristic scales, and turn/replay tests still need implementation; see the [gap analysis](solver-criteria-gap-analysis.md). Passing the current tests does not establish compliance with those gates.

Vitest also covers the OpenSees adapter against a stubbed `fetch`, solver selection, and the translation from the game model to the shared contract. Further tests run only when `VITE_OPENSEES_URL` points at a running service: two send a cantilever and the reference examples through it, and three compare its answers with the Rust solver's.

Vitest runs the Rust solver as the real WebAssembly module, loaded from `apps/web/src/solver/wasm/dof_solver.wasm`. That file is a committed build artefact, so `npm install`, `npm test` and `npm run build` need no Rust toolchain. They test whatever module is committed: after changing `crates/dof-solver`, run `npm run build:solver` or the web tests will exercise the old build.

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

## Rust solver validation — 2026-11-14

Run on Windows 11 with Rust 1.100.0 and Node 24.16.0, on the branch that adds `crates/dof-solver`.

| Check | Result |
| --- | --- |
| `npm run test:solver` | Pass: 53 tests, 1 ignored timing harness. Includes 10,000 seeded random states with no unhandled failure. |
| `npm test` | Pass: 8 test files and 50 tests; 1 file and 5 tests are skipped without an OpenSees service. The adapter tests run the committed WebAssembly module. |
| `VITE_OPENSEES_URL=http://127.0.0.1:8000 npm test` with the service running | Pass: 9 test files, 55 tests. The Rust solver and OpenSees agree on a space frame, a mechanism and the three reference examples. |
| `npm run typecheck` | Pass. |
| `npm run build` | Pass. The bundle includes `dof_solver.wasm` (526 kB, 191 kB gzipped). The existing chunk-size warning remains. |
| Module served by the Vite dev server | Pass: served as `application/wasm` and gives the closed-form cantilever deflection when loaded from the dev server and from the production bundle. |
| Stability panel in a browser | Not checked. The browser pane was not visible during this work, so the page could not be driven; the panel's use of the solver name is covered by type checking only. |
| `npm run bench:solver` | Timings recorded on the [Rust solver page](rust-solver.md#timings). |

Measured errors, the outcome counts of the random states and the limits of this evidence are on the [Rust solver page](rust-solver.md). The evidence shows that the solver's tests pass. It does not show owner acceptance of any criteria milestone, and it includes no comparison with an independent nonlinear program.
