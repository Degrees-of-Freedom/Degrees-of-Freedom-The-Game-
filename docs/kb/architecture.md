---
title: "Architecture"
last_validated: 2026-11-14
validated_against:
  - docs/kb/turn-criteria.md
  - package.json
  - apps/web/src/game
  - apps/web/src/viewer
  - apps/web/src/components
  - apps/web/src/styles
  - apps/web/src/pages/Workspace.tsx
  - apps/web/src/solver/voxel.ts
  - packages/solver-contract/src/index.ts
  - services/opensees/README.md
  - services/opensees/src/dof_opensees
  - apps/web/src/solver/opensees.ts
  - apps/web/src/solver/index.ts
  - apps/web/src/game/structuralModel.ts
  - apps/web/src/game/useStabilityCheck.ts
owner: unknown
status: partial
---

# Architecture

The npm workspace contains a React and TypeScript site in `apps/web`, using React Router, Zustand, Three.js and Vite. The shared `packages/solver-contract` defines a structural model, result types, and an asynchronous adapter interface. `services/opensees` is a separate Python project, managed with uv and outside the npm workspace, that implements that contract over HTTP with FastAPI and OpenSeesPy. TypeScript project references build the shared package before the app.

The workspace incorporates the Voxel Struct experiment. Its Zustand store owns voxel game state and rules, while the Three.js scene renders and interacts with that state. The workspace calls the experimental TypeScript analysis through the game boundary. A game boundary translates the model and level into solver-owned inputs; it does not implement the shared solver adapter. Its sections, loads and checks cannot yet be represented by the shared contract, so backend interchangeability remains future work.

A second, narrower path does use the shared contract. `game/structuralModel.ts` translates the game model into a contract model that carries geometry, connectivity, connection type, foundations and point loads. The `useStabilityCheck` hook sends it to the adapter chosen by `solver/index.ts`, for display alongside the voxel results. The two analysis paths report independently, so an unreachable service does not block voxel analysis. The OpenSees service is stateless: each request carries a whole model and gets a whole result. Inside the service, request schema, OpenSees translation, and stiffness-matrix stability assessment are separate modules, and only the translation module imports OpenSees. The original standalone prototype is [archived in Git history](../../prototypes/voxel-struct/README.md).

The [unified runtime](unified-runtime.md) maps five prototype environments onto this architecture. The launcher and full-screen workspace follow the prototype branch for visual design.

## Where changes belong

- `game/` owns the model, level setup, terrain, inventory, placement rules, persistence, undo, and the Shared table card lifecycle. The store coordinates these operations. `analysis.ts` and `turnAnalysis.ts` translate editor and Shared table states into voxel solver inputs. `structuralModel.ts` translates editor state into the shared solver contract.
- `solver/opensees.ts` is the HTTP adapter for the OpenSees service. `solver/index.ts` selects the adapter from build-time configuration. `services/opensees` owns the code that calls OpenSees.
- `solver/voxel.ts` coordinates an analysis. Frame assembly and solving, stability, load generation, design checks, level objectives, and auto-sizing each have their own modules.
- `viewer/Scene.tsx` manages Three.js setup and teardown. Picking translates pointer coordinates into hits; interaction turns hits into store actions. Meshes, overlays, and load-path particles live alongside the scene.
- `pages/Workspace.tsx` connects the scene and game actions to the controls and panels in `components/`. Each environment scopes its prototype layout and palette through style-specific CSS.

## Working boundaries

- Keep structural model and solver-facing types in the shared contract rather than coupling a solver to React or Three.js. The existing contract is preliminary and needs revision as semantics are decided.
- Keep game state and turn decisions separate from rendering and backend-specific solver details. Shared table stores explicit member-end connections in the turn model and derives the voxel shape for rendering.
- Keep backend conversion and unsupported-feature handling in adapters. The OpenSees service rejects unknown request fields, and the game translation returns notes for features the contract cannot express.
- The viewer consumes structural state. Game rules and solver inputs live outside the rendering layer.

See [structural solver](structural-solver.md) for the backend capabilities and analysis limitations. The [turn criteria](turn-criteria.md) define the confirmed core rules and proposed transaction flow. The [unified runtime](unified-runtime.md#shared-table-playtest) records the local implementation. Verified issue comparison and penalties remain pending. The OpenSees service runs locally for development and includes an untested Dockerfile. Game sessions use local browser storage.

The voxel game uses versioned browser saves and an experimental analysis snapshot; see [structural state](structural-state.md) for validation, replay limits, and the proposed solver-neutral model.

The shared contract also defines a versioned solver-neutral structural snapshot and immutable revision service. The existing voxel game and OpenSees adapter are not yet wired to that model; see [structural state](structural-state.md).
