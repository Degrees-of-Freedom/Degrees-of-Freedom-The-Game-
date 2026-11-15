---
title: "Code Standards"
last_validated: 2026-11-14
validated_against:
  - package.json
  - apps/web/package.json
  - apps/web/tsconfig.json
  - packages/solver-contract/tsconfig.json
  - apps/web/src
  - packages/solver-contract/src/index.ts
  - docs/kb/architecture.md
owner: unknown
status: current
---

# Code Standards

These are project standards for new and changed code, not a claim that every existing file already follows them. The game is at the concept stage; proposed systems and future integrations must be identified as such. See [architecture](architecture.md) for the current implementation and boundaries.

## TypeScript and interfaces

- Use TypeScript for the web app and shared JavaScript-facing packages. Both current TypeScript projects enable strict checking. Use explicit types at module boundaries and model domain concepts with named types; let local inference reduce noise.
- Avoid `any` and unchecked assertions. Treat external input, persisted data, and service responses as untrusted: validate them at the boundary and report invalid or unsupported cases explicitly.
- Keep shared solver-facing models and interfaces in `packages/solver-contract`; do not leak React, Three.js, or backend-specific types into the contract. Change the contract deliberately when semantics are agreed, and update consumers and documentation together.
- Prefer descriptive names, small functions, immutable updates where practical, and straightforward control flow. Document assumptions and non-obvious decisions, not what the code already says.

## Structure and responsibility

Organize by domain and responsibility, keeping related code and tests close. The existing repository provides these starting points:

| Location | Responsibility |
| --- | --- |
| `apps/web/src/pages/` | Route-level composition and page orchestration. |
| `apps/web/src/components/` | Reusable interface components and focused panels. |
| `apps/web/src/game/` | Game domain models, rules, state coordination, and game-to-solver translation. |
| `apps/web/src/solver/` | Web-side analysis and solver integration; keep numerical logic independent of UI and rendering. |
| `apps/web/src/viewer/` | Three.js scene, rendering, picking, and interaction with the game boundary. |
| `apps/web/src/styles/` | Styles grouped by concern. |
| `packages/solver-contract/` | Shared structural types and solver adapter contract. |
| `crates/` | Rust crates. `crates/dof-solver` is the structural solver; it has no dependencies and must stay independent of the game, UI and turn rules. |
| `scripts/` | Build and benchmark scripts run through npm. |
| `services/` | Backend service implementations, when added. |

Keep each file focused on one cohesive responsibility. Extract a separate module when a file mixes domain rules, presentation, state orchestration, numerical work, or external I/O, or when a part can be understood and tested independently. Keep related code together; do not split merely to meet a line count. Prefer small public APIs and explicit dependencies over cross-domain imports, circular dependencies, or global mutable state. Put reusable domain logic outside components and stores, and avoid duplicating rules in the viewer or UI.

Design for extension through clear boundaries and composition: a new rule, view, or solver backend should not require changes across unrelated layers. Introduce abstractions when they express a real boundary or supported variation, rather than anticipating every possible feature. Adapters translate between shared domain contracts and implementation-specific formats, and must surface unsupported capabilities instead of silently changing meaning.

## React, Zustand, and routing

- Use React components for presentation and composition. Extract reusable behavior into focused hooks and domain functions; keep components from owning solver calculations or game rules. Clean up effects and Three.js resources when their owners unmount or change.
- Use Zustand stores to coordinate shared client state and actions. Group state by domain as complexity grows, select only the state a component needs, and keep updates predictable and immutable. Put pure rules and transformations in separately testable modules; avoid using the store as a catch-all for rendering, network transport, and numerical logic. Keep transient component-only state local.
- Use React Router for application routes and navigation. Keep route definitions and page composition clear; use links for navigation and keep route-specific UI in pages. Add routes when product behavior requires them, without assuming a future turn flow or game mode already exists.
- Keep asynchronous service calls and errors at explicit boundaries. The UI should represent loading, failure, and unavailable capabilities accurately, rather than implying a solver or feature exists when it does not.

## Verification and maintenance

Add or update focused tests for meaningful behavior and boundary cases, especially rules, state transitions, data validation, and solver integration. Do not treat passing unit tests as numerical validation. Run the checks relevant to the change; the available commands and coverage limits are in [development and testing](development-and-testing.md). Update affected knowledge-base pages and inline/API documentation when behavior or decisions change. Record unresolved choices and limitations instead of presenting them as implemented facts.
