---
title: "Architecture"
last_validated: 2026-11-14
validated_against:
  - package.json
  - apps/web/src/game
  - apps/web/src/viewer
  - apps/web/src/components
  - apps/web/src/styles
  - apps/web/src/pages/Workspace.tsx
  - apps/web/src/solver/voxel.ts
  - packages/solver-contract/src/index.ts
  - services/opensees/README.md
owner: unknown
status: partial
---

# Architecture

The npm workspace contains a React and TypeScript site in `apps/web`, using React Router, Zustand, Three.js and Vite. The shared `packages/solver-contract` defines a preliminary structural model and asynchronous adapter interface; `services/opensees` reserves a location for a future service. TypeScript project references build the shared package before the app.

The workspace incorporates the Voxel Struct experiment. Its Zustand store owns voxel game state and rules, while the Three.js scene renders and interacts with that state. The workspace calls the experimental TypeScript analysis through the game boundary. A game boundary translates the model and level into solver-owned inputs; it does not implement the shared solver adapter. Its sections, loads and checks cannot yet be represented by the preliminary shared contract, so backend interchangeability remains future work. The original standalone prototype is [archived in Git history](../../prototypes/voxel-struct/README.md).

## Where changes belong

- `game/` owns the model, level setup, terrain, inventory, placement rules, persistence, and undo. The store coordinates these operations; `game/analysis.ts` translates game state into solver inputs.
- `solver/voxel.ts` coordinates an analysis. Frame assembly and solving, stability, load generation, design checks, level objectives, and auto-sizing each have their own modules.
- `viewer/Scene.tsx` manages Three.js setup and teardown. Picking translates pointer coordinates into hits; interaction turns hits into store actions. Meshes, overlays, and load-path particles live alongside the scene.
- `pages/Workspace.tsx` connects the scene and game actions to the controls and panels in `components/`. Styles are grouped by base rules, panels, workspace layout, and responsive overrides.

## Working boundaries

- Keep structural model and solver-facing types in the shared contract rather than coupling a solver to React or Three.js. The existing contract is preliminary and needs revision as semantics are decided.
- Keep game state and turn decisions separate from rendering and backend-specific solver details. The voxel experiment has editing rules but no turn system.
- Keep backend conversion and unsupported-feature handling in adapters. No numerical adapter currently implements the shared interface.
- Treat the viewer as a consumer of structural state, not the source of engineering or game rules.

See [structural solver](structural-solver.md) for analysis limitations and candidate frameworks. Persistence beyond local browser storage, turn flow, and deployment remain open.

The voxel game uses versioned browser saves and an experimental analysis snapshot; see [structural state](structural-state.md) for validation, replay limits, and the proposed solver-neutral model.
