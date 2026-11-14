---
title: "Architecture"
last_validated: 2026-11-14
validated_against:
  - package.json
  - apps/web/package.json
  - apps/web/src
  - packages/solver-contract/src/index.ts
  - services/opensees/README.md
owner: unknown
status: partial
---

# Architecture

## Current foundation

The npm workspace contains a React and TypeScript site in `apps/web` and a preliminary structural model and solver adapter contract in `packages/solver-contract`. `services/opensees` reserves a location for a future service; it contains no implementation. The web app uses React Router, Zustand, Three.js, and Vite. TypeScript project references build the shared package before the app.

The intended areas are game architecture and turns, structural analysis, and the 3D viewer. The web scaffold separates game state, UI, pages, viewer, and solver placeholder into directories. The Zustand store owns a model and reset action; the viewer receives a model as a prop and owns its graphics resources. The asynchronous adapter interface provides a potential boundary for local or remote analysis. No actual solver or gameplay rules are implemented.

## Working boundaries

- Keep structural model and solver-facing types in the shared contract rather than coupling a solver to React or Three.js. The existing contract is preliminary and will need revision as semantics are decided.
- Keep game state and turn decisions separate from rendering and backend-specific solver details. How analysis requests and results flow through game state remains open.
- Keep backend conversion and unsupported-feature handling in adapters so candidates can be evaluated against a common contract. This is an intended integration rule; no real adapter yet demonstrates it.
- Treat the viewer as a consumer of structural state, not the source of engineering or game rules. Its current member rendering does not imply analysis or placement functionality.

See [structural solver](structural-solver.md) for candidate frameworks, model decisions, and testing options. The lifecycle and deployment of OpenSees, placement of future TypeScript and Rust solvers, persistence, and turn/update flow remain undecided.
