---
title: "Development and Testing"
last_validated: 2026-11-14
validated_against:
  - package.json
  - apps/web/package.json
  - packages/solver-contract/package.json
owner: unknown
status: partial
---

# Development and Testing

From the repository root, install dependencies with `npm install`, start the web app with `npm run dev`, build with `npm run build`, check TypeScript with `npm run typecheck`, and run tests with `npm test`. The dev command builds the shared contract before starting Vite; rebuild it after editing its source.

The application is an early scaffold. Solver reference problems and gameplay tests remain to be defined.
