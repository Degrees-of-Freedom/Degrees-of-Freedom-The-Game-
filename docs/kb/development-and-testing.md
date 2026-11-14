---
title: "Development and Testing"
last_validated: 2026-11-14
validated_against:
  - package.json
  - apps/web/package.json
  - packages/solver-contract/package.json
  - apps/web/src/game/store.test.ts
owner: unknown
status: partial
---

# Development and Testing

From the repository root, install dependencies with `npm install`, start the web app with `npm run dev`, build with `npm run build`, check TypeScript with `npm run typecheck`, and run tests with `npm test`. The dev command builds the shared contract before starting Vite; rebuild it after editing its source. The root build builds the contract before the web app.

Vitest currently checks that reset produces an empty node list and that the placeholder solver reports analysis as unsupported. These tests do not validate numerical analysis, complete reset behavior, gameplay, or the viewer. Solver reference problems, numerical tolerances, and gameplay tests remain to be defined; see the proposed [solver testing options](structural-solver.md#testing-options-to-work-through).
