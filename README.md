# Degrees of Freedom: The Game

Degrees of Freedom is a planned turn-based structural engineering game where players build and test structures on a 3D grid. The goal is to explore load paths, stability, failure, and structural complexity.

## Run the scaffold

Install Node.js and npm, then run `npm install` and `npm run dev`. Run `npm run build`, `npm run typecheck`, and `npm test` for validation.

The repository contains the web app in `apps/web`, the shared solver contract in `packages/solver-contract`, and an OpenSees analysis service in `services/opensees`. See [the knowledge base](docs/kb/README.md) for architecture and project status.

The current app is a foundation with an orbitable 3D grid. Building tools and gameplay are not implemented, and the app does not call the analysis service yet.

## Run the analysis service

Install [uv](https://docs.astral.sh/uv/), then run `npm run dev:opensees` to serve structural analysis on `http://localhost:8000` and `npm run test:opensees` to run its tests. The service reports stability, degrees of freedom, mechanisms, displacements, reactions, and member forces; see [its README](services/opensees/README.md).

A standalone, playable build-and-analyse prototype lives in [prototypes/voxel-struct](prototypes/voxel-struct/README.md); it is separate from the scaffold.
