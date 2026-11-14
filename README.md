# Degrees of Freedom: The Game

Degrees of Freedom is a planned turn-based structural engineering game where players build and test structures on a 3D grid. The goal is to explore load paths, stability, failure, and structural complexity.

## Run the scaffold

Install Node.js and npm, then run `npm install` and `npm run dev`. Run `npm run build`, `npm run typecheck`, and `npm test` for validation.

The repository contains the web app in `apps/web`, the preliminary shared solver contract in `packages/solver-contract`, and a reserved OpenSees service location in `services/opensees`. See [the knowledge base](docs/kb/README.md) for architecture and project status.

The workspace includes an experimental voxel building and analysis loop with tower, bridge and weight pickup challenges and a sandbox. Analysis is approximate, has not been independently validated, and is not for engineering design. A turn system is not implemented.

The [original prototype notes](prototypes/voxel-struct/README.md) link to the standalone version in Git history.
The proposed [solver criteria](docs/kb/solver-criteria.md) define the target physics, result contract, acceptance tests, and implementation order. The [gap analysis](docs/kb/solver-criteria-gap-analysis.md) records current coverage and remaining work; the voxel experiment does not yet satisfy these criteria.

The [turn criteria](docs/kb/turn-criteria.md) define the two decks, confirmed draw/play limits, proposed six-DOF connection presets, and end-turn issue/penalty assessment. They record open design questions and are not implemented gameplay.
