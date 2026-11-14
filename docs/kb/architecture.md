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
  - services/opensees/src/dof_opensees
  - apps/web/src/solver/opensees.ts
  - apps/web/src/solver/index.ts
  - apps/web/src/game/structuralModel.ts
  - apps/web/src/game/useStabilityCheck.ts
  - apps/web/src/solver/wasm
  - crates/dof-solver/README.md
  - packages/solver-contract/src/analysis.ts
owner: unknown
status: partial
---

# Architecture

The npm workspace contains a React and TypeScript site in `apps/web`, using React Router, Zustand, Three.js and Vite. The shared `packages/solver-contract` defines two contracts: the original structural model, result types and asynchronous adapter interface, and a detailed analysis model and result written against the solver criteria. TypeScript project references build the shared package before the app.

Two solver backends sit outside the npm workspace. `crates/dof-solver` is a Rust crate with no dependencies that compiles to a WebAssembly module; the app bundles the compiled module and runs it in the browser. `services/opensees` is a Python project, managed with uv, that implements the original contract over HTTP with FastAPI and OpenSeesPy.

The workspace incorporates the Voxel Struct experiment. Its Zustand store owns voxel game state and rules, while the Three.js scene renders and interacts with that state. The workspace calls the experimental TypeScript analysis through the game boundary. A game boundary translates the model and level into solver-owned inputs; it does not implement the shared solver adapter. Its sections, loads and checks cannot yet be represented by the shared contract, so backend interchangeability remains future work.

A second, narrower path does use the shared contract. `game/structuralModel.ts` translates the game model into a contract model that carries geometry, connectivity, connection type, foundations and point loads. The `useStabilityCheck` hook sends it to the adapter chosen by `solver/index.ts`, and the workspace shows the returned stability report beside the voxel results. Both analyses start from the same Run analysis action and report independently, so a solver failure does not block the voxel analysis. By default the adapter is the Rust solver running in the browser; the OpenSees service is used when the build configuration asks for it. The Rust module is also stateless and has no imports: a JSON request goes in and a JSON result comes out. The OpenSees service is stateless: each request carries a whole model and gets a whole result. Inside the service, request schema, OpenSees translation, and stiffness-matrix stability assessment are separate modules, and only the translation module imports OpenSees. The original standalone prototype is [archived in Git history](../../prototypes/voxel-struct/README.md).

## Where changes belong

- `game/` owns the model, level setup, terrain, inventory, placement rules, persistence, and undo. The store coordinates these operations; `game/analysis.ts` translates game state into voxel solver inputs and `game/structuralModel.ts` translates it into the shared contract.
- `solver/opensees.ts` is the HTTP adapter for the OpenSees service and `solver/index.ts` selects the adapter from build-time configuration. `services/opensees` owns everything that touches OpenSees.
- `solver/wasm/wasmSolver.ts` loads the compiled Rust module and is the adapter for both contracts; `solver/wasm/legacyContract.ts` translates the original contract to and from the detailed one. `crates/dof-solver` owns all of the physics. The module in `solver/wasm/dof_solver.wasm` is a build artefact of that crate, rebuilt by `npm run build:solver`.
- `solver/voxel.ts` coordinates an analysis. Frame assembly and solving, stability, load generation, design checks, level objectives, and auto-sizing each have their own modules.
- `viewer/Scene.tsx` manages Three.js setup and teardown. Picking translates pointer coordinates into hits; interaction turns hits into store actions. Meshes, overlays, and load-path particles live alongside the scene.
- `pages/Workspace.tsx` connects the scene and game actions to the controls and panels in `components/`. Styles are grouped by base rules, panels, workspace layout, and responsive overrides.

## Working boundaries

- Keep structural model and solver-facing types in the shared contract rather than coupling a solver to React or Three.js. The existing contract is preliminary and needs revision as semantics are decided.
- Keep game state and turn decisions separate from rendering and backend-specific solver details. The voxel experiment has editing rules but no turn system.
- Keep backend conversion and unsupported-feature handling in adapters. The OpenSees service follows this rule by rejecting request fields it does not know, and the game translation returns notes for what the contract cannot express.
- Treat the viewer as a consumer of structural state, not the source of engineering or game rules.

See [structural solver](structural-solver.md) for analysis limitations and candidate frameworks, and [Rust solver](rust-solver.md) for that backend. The Rust solver ships inside the web bundle, so it needs no deployment of its own. The OpenSees service runs locally for development and has an untested Dockerfile. Persistence beyond local browser storage, turn flow, and deployment remain open.
