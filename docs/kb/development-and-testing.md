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
owner: unknown
status: partial
---

# Development and Testing

From the repository root, install dependencies with `npm install`, start the web app with `npm run dev`, build with `npm run build`, check TypeScript with `npm run typecheck`, and run tests with `npm test`. The dev command builds the shared contract before starting Vite; rebuild it after editing its source. The root build builds the contract before the web app.

Vitest covers voxel editing rules, undo, examples, persistence, turn replay and attachment rules, viewer picking candidates, force labels, and selected analysis cases including equilibrium, signed loads and Shared table connection behavior. These tests do not independently validate numerical accuracy or exercise the viewer in a browser. The proposed [solver acceptance suite and numerical gates](solver-criteria.md#7-acceptance-tests) now define the target coverage. Most fixtures, absolute tolerances, characteristic scales, and turn/replay tests still need implementation; see the [gap analysis](solver-criteria-gap-analysis.md). Passing the current tests does not establish compliance with those gates.

Vitest also covers the OpenSees adapter against a stubbed `fetch`, solver selection, and the translation from the game model to the shared contract. Two further tests run only when `VITE_OPENSEES_URL` points at a running service; they send a cantilever and the reference examples through it.

The OpenSees service in `services/opensees` is a Python project that needs [uv](https://docs.astral.sh/uv/); uv installs the pinned Python 3.12 and dependencies on first use. Start it with `npm run dev:opensees` (port 8000) and test it with `npm run test:opensees`. Its pytest suite compares results with closed-form cases and covers mechanisms, validation, and the HTTP layer; see [structural solver](structural-solver.md#opensees-service). `npm test` does not run the Python tests. The service Dockerfile has not been built or tested. To see the OpenSees stability check in the app, run the service and the web app in two terminals and press Run analysis; the panel and its agreement with the voxel result on the Tower I example were checked by hand in a browser.

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
