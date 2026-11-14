# Degrees of Freedom: The Game

Degrees of Freedom is a planned turn-based structural engineering game where players build and test structures on a 3D grid. The goal is to explore load paths, stability, failure, and structural complexity.

## Run the scaffold

Install Node.js and npm, then run `npm install` and `npm run dev`. Run `npm run build`, `npm run typecheck`, and `npm test` for validation.

The repository contains the web app in `apps/web`, the shared solver contract in `packages/solver-contract`, and an OpenSees analysis service in `services/opensees`. See [the knowledge base](docs/kb/README.md) for architecture and project status.

The workspace includes an experimental voxel building and analysis loop with tower, bridge and weight pickup challenges and a sandbox. Analysis is approximate, has not been independently validated, and is not for engineering design. A turn system is not implemented.

## Run the analysis service

Install [uv](https://docs.astral.sh/uv/), then run `npm run dev:opensees` to serve structural analysis on `http://localhost:8000` and `npm run test:opensees` to run its tests. With the service running, Run analysis in the workspace also shows an OpenSees stability check: free degrees of freedom, mechanisms, and redundancy. See [its README](services/opensees/README.md).

The [original prototype notes](prototypes/voxel-struct/README.md) link to the standalone version in Git history.
The proposed [solver criteria](docs/kb/solver-criteria.md) define the target physics, result contract, acceptance tests, and implementation order. The [gap analysis](docs/kb/solver-criteria-gap-analysis.md) records current coverage and remaining work; the voxel experiment does not yet satisfy these criteria.
