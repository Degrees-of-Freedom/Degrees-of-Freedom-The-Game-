---
title: "Development and Testing"
last_validated: 2026-11-14
validated_against:
  - package.json
  - apps/web/package.json
  - packages/solver-contract/package.json
  - apps/web/src/game/store.test.ts
  - apps/web/src/solver/opensees.test.ts
  - services/opensees/pyproject.toml
  - services/opensees/tests
  - prototypes/voxel-struct/README.md
owner: unknown
status: partial
---

# Development and Testing

From the repository root, install dependencies with `npm install`, start the web app with `npm run dev`, build with `npm run build`, check TypeScript with `npm run typecheck`, and run tests with `npm test`. The dev command builds the shared contract before starting Vite; rebuild it after editing its source. The root build builds the contract before the web app.

Vitest checks that reset produces an empty node list, that the placeholder solver reports analysis as unsupported, and that the OpenSees adapter posts models and maps responses and failures correctly against a stubbed `fetch`. One further adapter test runs only when `VITE_OPENSEES_URL` points at a running service. These tests do not validate complete reset behavior, gameplay, or the viewer.

The OpenSees service in `services/opensees` is a Python project that needs [uv](https://docs.astral.sh/uv/); uv installs the pinned Python 3.12 and dependencies on first use. Start it with `npm run dev:opensees` (port 8000) and test it with `npm run test:opensees`. Its pytest suite validates numerical results against closed-form cases and covers mechanisms, validation, and the HTTP layer; see [structural solver](structural-solver.md#testing). `npm test` does not run the Python tests. The service Dockerfile has not been built or tested.

The standalone prototype in `prototypes/voxel-struct` has no build step or automated tests. Serve the folder over HTTP (for example `python -m http.server 8765 --directory prototypes/voxel-struct`) and open it in a browser; it loads Three.js from a CDN. Its README lists the manual reference checks performed.
