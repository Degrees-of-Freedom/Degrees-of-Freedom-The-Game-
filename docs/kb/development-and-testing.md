---
title: "Development and Testing"
last_validated: 2026-11-14
validated_against:
  - package.json
  - apps/web/package.json
  - packages/solver-contract/package.json
  - apps/web/src/game/store.test.ts
  - apps/web/src/solver/voxel.test.ts
  - prototypes/voxel-struct/README.md
owner: unknown
status: partial
---

# Development and Testing

From the repository root, install dependencies with `npm install`, start the web app with `npm run dev`, build with `npm run build`, check TypeScript with `npm run typecheck`, and run tests with `npm test`. The dev command builds the shared contract before starting Vite; rebuild it after editing its source. The root build builds the contract before the web app.

Vitest covers voxel editing rules, undo, examples, persistence behavior and selected analysis cases. These tests do not independently validate numerical accuracy or exercise the viewer in a browser. Solver reference problems, numerical tolerances, and gameplay tests remain to be defined; see the proposed [solver testing options](structural-solver.md#testing-options-to-work-through).

The standalone prototype in `prototypes/voxel-struct` has no build step or automated tests. Serve the folder over HTTP (for example `python -m http.server 8765 --directory prototypes/voxel-struct`) and open it in a browser; it loads Three.js from a CDN. Its README lists the manual reference checks performed.

