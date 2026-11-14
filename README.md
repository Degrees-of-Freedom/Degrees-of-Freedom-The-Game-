# Degrees of Freedom: The Game

Degrees of Freedom is a planned turn-based structural engineering game where players build and test structures on a 3D grid. The goal is to explore load paths, stability, failure, and structural complexity.

## Run the game

Install Node.js and npm, then run `npm install` and `npm run dev`. Run `npm run build`, `npm run typecheck`, and `npm test` for validation.

The repository contains the web app in `apps/web`, the shared solver contract in `packages/solver-contract`, and an OpenSees analysis service in `services/opensees`. See [the knowledge base](docs/kb/README.md) for architecture and project status.

The [unified runtime](docs/kb/unified-runtime.md) opens five prototype environments in one application. Grow Dusk is the primary launcher entry and opens in Creative. It includes Engineering challenges, Creative, Forensics, Load in space and a local Shared table card playtest. **Run simulation** is available in every mode, with **Results** for the current model after a run. The approximate voxel analysis lacks independent validation for engineering design. Shared table uses an experimental applied-load solve with individual member-end connections and reports unresolved cases when a solve is unavailable.

## Run the analysis service

Install [uv](https://docs.astral.sh/uv/), then run `npm run dev:opensees` to serve structural analysis on `http://localhost:8000` and `npm run test:opensees` to run its tests. With the service running, Run analysis in the workspace also shows an OpenSees stability check: free degrees of freedom, mechanisms, and redundancy. See [its README](services/opensees/README.md).

The [original prototype notes](prototypes/voxel-struct/README.md) link to the standalone version in Git history.
The proposed [solver criteria](docs/kb/solver-criteria.md) define the target physics, result contract, acceptance tests, and implementation order. The [gap analysis](docs/kb/solver-criteria-gap-analysis.md) records current coverage and remaining work; the voxel experiment does not yet satisfy these criteria.

The [turn criteria](docs/kb/turn-criteria.md) define the two decks, confirmed draw/play limits, proposed six-DOF connection presets, and end-turn issue/penalty assessment. The Shared table implements the confirmed card placement rules. End turn records an experimental structural assessment. Verified issue comparison and penalties remain pending.
