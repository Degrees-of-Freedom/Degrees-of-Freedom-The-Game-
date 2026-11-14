---
title: "Architecture"
last_validated: 2026-11-14
validated_against:
  - package.json
  - apps/web/src/game
  - apps/web/src/viewer/Scene.tsx
  - apps/web/src/solver/voxel.ts
  - packages/solver-contract/src/index.ts
  - services/opensees/README.md
owner: unknown
status: partial
---

# Architecture

The npm workspace contains a React and TypeScript site in `apps/web`, using React Router, Zustand, Three.js and Vite. The shared `packages/solver-contract` defines a preliminary structural model and asynchronous adapter interface; `services/opensees` reserves a location for a future service. TypeScript project references build the shared package before the app.

The workspace incorporates the Voxel Struct experiment. Its Zustand store owns voxel game state and rules, while the Three.js scene renders and interacts with that state. The experimental voxel analysis is extracted into a separate TypeScript module called by the workspace. A game boundary translates the model and level into solver-owned inputs; it does not implement the shared solver adapter. Its sections, loads and checks cannot yet be represented by the preliminary shared contract, so backend interchangeability remains future work. The original standalone prototype remains available for comparison.

## Working boundaries

- Keep structural model and solver-facing types in the shared contract rather than coupling a solver to React or Three.js. The existing contract is preliminary and needs revision as semantics are decided.
- Keep game state and turn decisions separate from rendering and backend-specific solver details. The voxel experiment has editing rules but no turn system.
- Keep backend conversion and unsupported-feature handling in adapters. No numerical adapter currently implements the shared interface.
- Treat the viewer as a consumer of structural state, not the source of engineering or game rules.

See [structural solver](structural-solver.md) for analysis limitations and candidate frameworks. Persistence beyond local browser storage, turn flow, and deployment remain open.


