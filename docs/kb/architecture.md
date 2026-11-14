---
title: "Architecture"
last_validated: 2026-11-14
validated_against:
  - package.json
  - apps/web/src
  - packages/solver-contract/src/index.ts
  - services/opensees/README.md
owner: unknown
status: partial
---

# Architecture

## Current foundation

The npm workspace contains a React and TypeScript site in `apps/web` and a shared preliminary structural model and solver adapter contract in `packages/solver-contract`. `services/opensees` reserves a location for a future service; it contains no implementation.

The site separates its Zustand game state, UI components, routes, Three.js viewer, and solver adapter placeholder into directories. The viewer receives a structural model rather than owning the game state. The contract permits asynchronous adapters so future local or remote solvers can share an interface. No actual solver or gameplay rules are implemented.

## Open questions

- Define exact units, material and element properties, load cases, result formats, and supported analysis capabilities before implementing adapters.
- Decide the lifecycle and deployment of OpenSees and the placement of future TypeScript and Rust solver implementations.
- Define ownership and update flow for turns, analysis, results, and persistence.
