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
  - services/opensees/pyproject.toml
  - services/opensees/tests
  - prototypes/voxel-struct/README.md
  - docs/kb/solver-criteria.md
  - docs/kb/solver-criteria-gap-analysis.md
owner: unknown
status: partial
---

# Development and Testing

From the repository root, install dependencies with `npm install`, start the web app with `npm run dev`, build with `npm run build`, check TypeScript with `npm run typecheck`, and run tests with `npm test`. The dev command builds the shared contract before starting Vite; rebuild it after editing its source. The root build builds the contract before the web app.

Vitest covers voxel editing rules, undo, examples, persistence, turn replay and attachment rules, viewer picking candidates, force labels, and selected analysis cases including equilibrium, signed loads and Shared table connection behavior. These tests do not independently validate numerical accuracy or exercise the viewer in a browser. The proposed [solver acceptance suite and numerical gates](solver-criteria.md#7-acceptance-tests) now define the target coverage. Most fixtures, absolute tolerances, characteristic scales, and turn/replay tests still need implementation; see the [gap analysis](solver-criteria-gap-analysis.md). Passing the current tests does not establish compliance with those gates.

Vitest also covers the OpenSees adapter against a stubbed `fetch`, solver selection, and the translation from the game model to the shared contract. Two further tests run only when `VITE_OPENSEES_URL` points at a running service; they send a cantilever and the reference examples through it.

The OpenSees service in `services/opensees` is a Python project that needs [uv](https://docs.astral.sh/uv/); uv installs the pinned Python 3.12 and dependencies on first use. Start it with `npm run dev:opensees` (port 8000) and test it with `npm run test:opensees`. Its pytest suite compares results with closed-form cases and covers mechanisms, validation, and the HTTP layer; see [structural solver](structural-solver.md#opensees-service). `npm test` does not run the Python tests. The service Dockerfile has not been built or tested. To see the OpenSees stability check in the app, run the service and the web app in two terminals and press Run analysis; the panel and its agreement with the voxel result on the Tower I example were checked by hand in a browser.

Run the maintained workspace with `npm run dev`. The [original prototype notes](../../prototypes/voxel-struct/README.md) link to the archived standalone implementation and describe its historical checks.

## Unified runtime integration validation — 2026-11-14

The integration with current main passed TypeScript and 94 Vitest tests across 21 files. Two live OpenSees tests were skipped because no service URL was configured; this run does not verify the Python service or deployment. Browser checks compared all five environment views with prototype captures and exercised Grow Dusk and Kit simulation results, match persistence, style selection and compact layouts. Follow-up fixes addressed source glyphs, active tools, camera framing, result contrast and narrow-screen overlaps. The browser connection became unavailable before a final visual pass on the last portrait-specific overrides; those overrides received static and TypeScript checks.

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
