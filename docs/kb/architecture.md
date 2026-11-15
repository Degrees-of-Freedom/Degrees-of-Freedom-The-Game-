---
title: "Architecture"
last_validated: 2026-11-15
validated_against:
  - docs/kb/grow-dusk-runtime.md
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
  - apps/web/src/game/analysisModel.ts
  - apps/web/src/game/structuralSummary.ts
  - apps/web/src/components/StabilityCheckPanel.tsx
  - apps/web/src/solver/wasm
  - crates/dof-solver/README.md
  - packages/solver-contract/src/analysis.ts
owner: unknown
status: partial
---

# Architecture

The normal match has a dedicated route, an IndexedDB transaction coordinator and an End Turn worker that reuses the versioned TurnState domain. The release board and engineering inspector consume that state. See the [release runtime and recovery boundary](grow-dusk-runtime.md).

The npm workspace contains a React and TypeScript site in `apps/web`, using React Router, Zustand, Three.js and Vite. The shared `packages/solver-contract` defines two contracts: the original structural model, result types and asynchronous adapter interface, and a detailed analysis model and result written against the solver criteria. TypeScript project references build the shared package before the app.

Two solver backends sit outside the npm workspace. `crates/dof-solver` is a Rust crate with no dependencies that compiles to a WebAssembly module; the app bundles the compiled module and runs it in the browser. `services/opensees` is a Python project, managed with uv, that implements the versioned structural contract over HTTP with FastAPI and OpenSeesPy.

The workspace incorporates the Voxel Struct experiment. Its Zustand store owns voxel game state and rules, while the Three.js scene renders and interacts with that state. The workspace calls the experimental TypeScript analysis through the game boundary. A game boundary translates the model and level into solver-owned inputs; it does not implement the shared solver adapter. Its sections, loads and checks cannot yet be represented by the shared contract, so backend interchangeability remains future work.

A second, narrower path does use the shared contract. The `useStabilityCheck` hook sends the model to the adapter chosen by `solver/index.ts` and picks the contract by solver capability. If the adapter implements the detailed contract (the Rust solver), `game/analysisModel.ts` translates the game and level into a detailed model with card sections, tension-only cables, connection laws, foundations and gravity loads, and `game/structuralSummary.ts` reduces the result for the "Structural check" panel. Otherwise (the OpenSees service) `game/structuralModel.ts` translates it into the original contract, which carries geometry, connectivity, connection type, foundations and point loads, and the panel shows the stability report. Either way the result appears beside the voxel results. Both analyses start from the same Run analysis action and report independently, so a solver failure does not block the voxel analysis. By default the adapter is the Rust solver running in the browser; the OpenSees service is used when the build configuration asks for it. The Rust module is also stateless and has no imports: a JSON request goes in and a JSON result comes out. The OpenSees service is stateless: each request carries a whole model and gets a whole result. Inside the service, request schema, OpenSees translation, and stiffness-matrix stability assessment are separate modules, and only the translation module imports OpenSees. The original standalone prototype is [archived in Git history](../../prototypes/voxel-struct/README.md).

The [unified runtime](unified-runtime.md) maps five prototype environments onto this architecture. The launcher and full-screen workspace follow the prototype branch for visual design.

## Where changes belong

- `game/` owns the model, level setup, terrain, inventory, placement rules, persistence, undo, and the Shared table card lifecycle. The store coordinates these operations. `analysis.ts` and `turnAnalysis.ts` translate editor and Shared table states into voxel solver inputs. `structuralModel.ts` translates editor state into the original shared solver contract and `analysisModel.ts` into the detailed one; `structuralSummary.ts` turns a detailed result into the values the panel shows.
- `solver/opensees.ts` is the HTTP adapter for the OpenSees service. `solver/index.ts` selects the adapter from build-time configuration. `services/opensees` owns the code that calls OpenSees.
- `solver/wasm/wasmSolver.ts` loads the compiled Rust module and is the adapter for both contracts; `solver/wasm/legacyContract.ts` translates the original contract to and from the detailed one. `crates/dof-solver` owns all of the physics. The module in `solver/wasm/dof_solver.wasm` is a build artefact of that crate, rebuilt by `npm run build:solver`.
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

The shared contract also defines a versioned solver-neutral structural snapshot and immutable revision service. The voxel game and legacy OpenSees check do not use that model. A separate manual workspace flow can run a narrow shared-snapshot subset through OpenSees and store unverified results; see [structural state](structural-state.md) and [analysis results](analysis-results.md).

Shared table writes the completed structural request and available experimental reactions in its versioned turn event. The same session write records the card and turn transition. [Analysis results](analysis-results.md#shared-table-save-and-reload) describes the load policy and replay boundary.

See [structural solver](structural-solver.md) for analysis limitations and candidate frameworks, and [Rust solver](rust-solver.md) for that backend. The Rust solver ships inside the web bundle, so it needs no deployment of its own. The OpenSees service runs locally for development and has an untested Dockerfile. Persistence beyond local browser storage, turn flow, and deployment remain open.
