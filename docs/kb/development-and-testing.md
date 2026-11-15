---
title: "Development and Testing"
last_validated: 2026-11-15
validated_against:
  - docs/kb/grow-dusk-runtime.md
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
  - apps/web/src/viewer/viewModes.test.ts
  - apps/web/src/components/viewModes/viewModes.test.tsx
  - apps/web/src/solver/wasm/crossCheck.test.ts
owner: unknown
status: partial
---

# Development and Testing

The [criteria acceptance ledger](criteria-ledger.md) records the current implementation run. The OpenSees suite includes a reproducible 10,000-state test in `services/opensees/tests/test_seeded_states.py`. It compares 6,000 oblique, subdivided cantilevers with analytical displacement and six-axis reaction balance, and checks 4,000 invalid or unstable configurations for classification and absence of fabricated response. The initial Windows x64 run recorded maximum relative displacement error 6.67e-13, normalized force residual 1.24e-12 and moment residual 7.72e-13. The generator-plus-solve p95 was 1.45 ms for these one-to-four-member cases. Nonlinear and game-scale performance need separate evidence.

From the repository root, use `npm ci`, `npm run dev`, `npm run typecheck` and `npm test`. The root production build also recompiles the Rust solver and checks the shipped binary against Cargo's output. See the [release build, hosting and browser test instructions](grow-dusk-runtime.md#running-and-hosting).

Vitest covers editing rules, draw conservation, turn replay, attachment laws, viewer picking and units. The release also runs the Rust analytical suite, independent OpenSees comparisons and complete production browser matches. The [numerical evidence](rust-solver.md) records tolerances, classification limits and stress timings.

Vitest also covers the OpenSees adapter and its health check against a stubbed `fetch`, solver selection, the stored solver setting, and the translation from the game model to the shared contract. Further tests run only when `VITE_OPENSEES_URL` points at a running service: two send a cantilever and the reference examples through it, and six in `crossCheck.test.ts` compare its answers with the Rust solver's, at both fidelities, on hand-built frames, the reference examples and the twenty library structures.

`analysisModel.test.ts` checks SI units, translation to the detailed contract and reference games against the actual WebAssembly module. Vitest loads the checked-in `apps/web/src/solver/wasm/dof_solver.wasm`. Run `npm run build:solver` after editing Rust. The root production build always rebuilds the binary from source.

Grow Dusk view modes have Vitest coverage in `viewModes.test.ts` (reducer, exclusivity, drawer mapping, on-demand response, scale) and `viewLegends.test.ts` (content, colours, unavailable states). `contourRamp.test.ts`, `viewFormat.test.ts`, `displacementShadow.test.ts` (against the analytical cantilever) and `components/viewModes/viewModes.test.tsx` (static panel and legend markup) cover the rest. On 2026-11-15 the panel was also checked in headless Chromium with SwiftShader through the Vite dev server: a six-turn seed 0 match at 1366 × 900, plus 683 × 384 and 412 × 915 touch layouts. The checks covered each mode, the label switch, Escape handling, drawer synchronisation and no horizontal overflow. After a production build, `release-presentation.mjs` passed all nine scenarios, `release-resources.mjs` passed, and `release-browser.mjs` passed seed 0 and its all-pass match, with `DOF_SOFTWARE_GL=1` on Linux Chromium. That build compiled the solver with Rust 1.97.0, and the rebuilt WASM was not committed. The presentation script first found a legend accessible name colliding with the drawer's **Shear diagram** label; the legend cards no longer carry one.

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

The structure generator in `tools/structure-gan` is a separate Python project (uv, Python 3.12, PyTorch, the OpenSees engine): run `uv run pytest` there (42 tests) and see [structure GAN](structure-gan.md). `apps/web/src/game/evolvedStructures.test.ts` checks its database against the game's loader and voxel solver as part of `npm test`.

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

## Companion scenario motion — 2026-11-15

`npm test` includes `apps/web/src/companion/{motion,animator,turnCues}.test.ts`. These tests check that clips start and end at rest, stay within amplitude bounds and sample smoothly. They also cover the interruption priorities, idle scheduling and the mapping from each scenario to its clip. The animator tests use a fake clock to check that frames and timers are released in still mode and on dispose. The report-policy tests check that unknown results are never cheered and old results are never reenacted.

For a browser check, run `node docs/evidence/companion-motion/check.mjs "$PWD" "$PWD/node_modules/playwright" /opt/pw-browsers/chromium`. It needs WebGL; SwiftShader is enabled. The script writes `motion-sheet.png` and asserts the clip sequence for a scripted Grow Dusk match. The older `docs/evidence/companion-repair/check.mjs` already failed on the base commit `6b33f9a` before this change: its `Turn details` locator matches two buttons.

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
| `npm run test:solver` | Pass: 69 tests, 1 ignored timing harness. Includes 10,000 seeded random states with no unhandled failure. Re-run on the branch adding deflection, member loads, load cases and the worker. |
| `npm test` | Pass on the branch adding the solver worker: 31 test files and 189 tests; 1 file and 6 tests are skipped, 5 of them for want of an OpenSees service. The adapter and game-translation tests run the committed WebAssembly module. |
| `VITE_OPENSEES_URL=http://127.0.0.1:8000 npm test` with the service running | Pass: 9 test files, 55 tests, before the game-translation tests were added and before main was merged; not re-run since. The Rust solver and OpenSees agree on a space frame, a mechanism and the three reference examples. |
| `npm run typecheck` | Pass. |
| `npm run build` | Pass. The bundle includes `dof_solver.wasm` (704 kB, 231 kB gzipped). The existing chunk-size warning remains. |
| Module served by the Vite dev server | Pass: served as `application/wasm` and gives the closed-form cantilever deflection when loaded from the dev server and from the production bundle. |
| Structural check panel in a browser | Checked once by hand on the tree merged with main at `3c6aa90`: Engineering challenges, Tower I, Load example, Run simulation. The Results drawer showed "Structural check: Stable", one part, no mechanisms, four foundation reactions totalling 77.0 kN, and "Computed by Rust solver (WebAssembly) in 67 ms", with no console errors. The reactions equal the 40 kN payload plus the 3.78 t mass the voxel panel reports. Other levels, unstable structures and the verdict colours were not looked at. |
| `npm run bench:solver` | Timings recorded on the [Rust solver page](rust-solver.md#timings). |

Measured errors, the outcome counts of the random states and the limits of this evidence are on the [Rust solver page](rust-solver.md). The evidence shows that the solver's tests pass. It does not show owner acceptance of any criteria milestone, and it includes no comparison with an independent nonlinear program.

## Integrated OpenSees nonlinear control

On the criteria integration branch, selecting OpenSees exposes **Run nonlinear check** in the editor structural analysis panel. It sends the editor model through the corotational service contract, with catalogue section laws and explicit point loads; self-weight and challenge load combinations are excluded. The selected Rust solver continues to use its detailed analysis path. Shared table scoring uses its separate verified linear frame analysis. Springs are not represented by this editor service translation and return an unavailable message.

Focused verification on the integration worktree: 19 nonlinear and component service tests passed, and 24 web tests passed with a local OpenSees service, including a corotational editor request and support-reaction check. The panel was rendered in a component test; an interactive browser walkthrough remains outstanding.

## Main after the solver restore — 2026-11-15

On 15 November `main` was force-pushed while the criteria integration (#10) was merged, which dropped #8 (OpenSees v2 and the end-of-turn solve) and #9 (Rust worker, load cases, deflection, member loads) from its history, although GitHub still lists both as merged. Both were restored by merge, without rewriting history: #9 as #12, and #8 together with the alternative OpenSees engine that #10 had added as #15. The Rust adapter was then brought to the merged shared contract in #16, which replaces the closed #11. Avoid force-pushing `main`; restore lost work with a merge instead.

Checked on `main` at `af45c30` (#16), Windows 11, Node 24.16.0, Rust 1.100.0:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass. |
| `npm test` | Pass: 73 test files, 518 tests; 2 files and 9 tests are skipped without an OpenSees service. |
| `VITE_OPENSEES_URL=http://127.0.0.1:8000 npm test` with `npm run dev:opensees` running | Pass: 75 test files, 527 tests. The Rust and OpenSees solvers agree on linear results within 2e-5, on a nonlinear space frame within 1 %, on the mechanism verdict, and on the three reference examples. |
| `npm run build` | Pass. The existing chunk-size warning remains. |
| `npm run test:solver` | Pass: 78 tests, 1 ignored timing harness. |
| `npm run test:opensees` | Pass: 716 tests, 7 skipped. |
| Documentation links | 464 relative links and anchors checked, none broken. |

Not checked in this pass: the workspace panels in a browser, and the 10,000-state generated run of the OpenSees service, which runs only when `DOF_GENERATED_STATES` is set.

## Solver re-check and Rust–OpenSees cross-check — 2026-11-15

Checked on `main` at `39508f0` (#14) in a Linux container: 4-core Intel Xeon at 2.1 GHz, Node 22.23.4, Rust 1.97.0, uv-managed Python 3.12, OpenSees 3.8.0. All solver branches on the remote are contained in `main`. The three commits that `nico/rust-v2-contract` appears to carry are on `main` with different hashes.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass. |
| `npm test` | Pass: 78 test files, 564 tests; 2 files and 9 tests skipped without an OpenSees service. |
| `VITE_OPENSEES_URL=http://127.0.0.1:8000 npm test` with `npm run dev:opensees` running | Pass: 80 test files, 573 tests, before the cross-check was extended. The extended `crossCheck.test.ts` passes 6 of 6. |
| `npm run test:solver` | Pass: 82 tests, 1 ignored timing harness. |
| `npm run test:opensees` | Pass: 719 tests, 7 skipped (6 unrepresentable skew-axis releases, 1 opt-in single seed). |
| `npm run build:solver` | Pass. The rebuilt module (686 kB) is not byte-identical to the committed one, which was built with another toolchain. All 125 solver Vitest tests pass with it. The committed module was kept. |
| `npm run bench:solver` | All proposed targets met; numbers on the [Rust solver page](rust-solver.md#timings). |
| `SOLVER_TIMING_REPS=1 npm run compare:solvers` | Runs the voxel and OpenSees linear/nonlinear paths only; it does not include the Rust solver. OpenSees nonlinear calls the slender column and the cantilever unstable where the voxel and linear paths call them stable. |

The cross-check results, the prestressed-cable convention difference and the two nonlinear verdicts that Rust leaves `unresolved` are in [Cross-check with OpenSees](rust-solver.md#cross-check-with-opensees--2026-11-15). Not checked in this pass: the browser, the production build and the 10,000-state generated OpenSees run.
