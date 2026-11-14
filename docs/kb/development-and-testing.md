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
  - prototypes/voxel-struct/README.md
  - docs/kb/solver-criteria.md
  - docs/kb/solver-criteria-gap-analysis.md
owner: unknown
status: partial
---

# Development and Testing

From the repository root, install dependencies with `npm install`, start the web app with `npm run dev`, build with `npm run build`, check TypeScript with `npm run typecheck`, and run tests with `npm test`. The dev command builds the shared contract before starting Vite; rebuild it after editing its source. The root build builds the contract before the web app.

Vitest covers voxel editing rules, undo, examples, persistence behavior and selected analysis cases, equilibrium, reference examples and load-path behavior. These tests do not independently validate numerical accuracy or exercise the viewer in a browser. The proposed [solver acceptance suite and numerical gates](solver-criteria.md#7-acceptance-tests) now define the target coverage. Most fixtures, absolute tolerances, characteristic scales, and turn/replay tests still need implementation; see the [gap analysis](solver-criteria-gap-analysis.md). Passing the current tests does not establish compliance with those gates.

The standalone prototype in `prototypes/voxel-struct` has no build step or automated tests. Serve the folder over HTTP (for example `python -m http.server 8765 --directory prototypes/voxel-struct`) and open it in a browser; it loads Three.js from a CDN. Its README lists the manual reference checks performed.


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
