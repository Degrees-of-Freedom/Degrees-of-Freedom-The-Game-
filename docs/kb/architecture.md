---
title: "Architecture"
last_validated: 2026-11-14
validated_against:
  - package.json
  - apps/web/package.json
  - apps/web/src
  - packages/solver-contract/src/index.ts
  - services/opensees/README.md
  - services/opensees/src/dof_opensees
  - apps/web/src/solver/opensees.ts
owner: unknown
status: partial
---

# Architecture

## Current foundation

The npm workspace contains a React and TypeScript site in `apps/web` and a structural model and solver adapter contract in `packages/solver-contract`. `services/opensees` is a separate Python project, managed with uv and outside the npm workspace, that serves structural analysis over HTTP with FastAPI and OpenSeesPy. The web app uses React Router, Zustand, Three.js, and Vite. TypeScript project references build the shared package before the app.

The intended areas are game architecture and turns, structural analysis, and the 3D viewer. The web scaffold separates game state, UI, pages, viewer, and solver adapters into directories. The Zustand store owns a model and reset action; the viewer receives a model as a prop and owns its graphics resources. The asynchronous adapter interface is the boundary for local or remote analysis. The web app holds two adapters: a placeholder that reports analysis as unsupported, and an HTTP client for the OpenSees service. The store holds the active adapter and the analysis state; the workspace page triggers a run and passes the result to the inspector panel and the viewer. No gameplay rules are implemented.

The OpenSees service is stateless: each request carries a whole model and gets a whole result. Inside the service, request schema, OpenSees translation, and stiffness-matrix stability assessment are separate modules, and only the translation module imports OpenSees.

## Working boundaries

- Keep structural model and solver-facing types in the shared contract rather than coupling a solver to React or Three.js. The existing contract is preliminary and will need revision as semantics are decided.
- Keep game state and turn decisions separate from rendering and backend-specific solver details. Analysis today is one explicit request for the whole model, started by the user; how it fits into turns remains open.
- Keep backend conversion and unsupported-feature handling in adapters so candidates can be evaluated against a common contract. The OpenSees service follows this rule by rejecting request fields it does not know.
- Treat the viewer as a consumer of structural state, not the source of engineering or game rules. Its current member rendering does not imply analysis or placement functionality.

See [structural solver](structural-solver.md) for candidate frameworks, model decisions, and testing options. The OpenSees service runs locally for development and has an untested Dockerfile; where it is deployed, placement of future TypeScript and Rust solvers, persistence, and turn/update flow remain undecided.
