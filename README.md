# Degrees of Freedom: The Game

Degrees of Freedom is a planned turn-based structural engineering game where players build and test structures on a 3D grid. The goal is to explore load paths, stability, failure, and structural complexity.

## Run the game

Install Node.js and npm, then run `npm install` and `npm run dev`. Run `npm run build`, `npm run typecheck`, and `npm test` for validation.

The repository contains the web app in `apps/web`, the preliminary shared solver contract in `packages/solver-contract`, and a reserved OpenSees service location in `services/opensees`. See [the knowledge base](docs/kb/README.md) for architecture and project status.

The [unified runtime](docs/kb/unified-runtime.md) opens five prototype environments in one application. It includes Engineering challenges, Creative, Forensics, Load in space and a local Shared table card playtest. The approximate voxel analysis lacks independent validation for engineering design. Shared table analysis remains unresolved pending solver support for individual member-end connections.

The [original prototype notes](prototypes/voxel-struct/README.md) link to the standalone version in Git history.
The proposed [solver criteria](docs/kb/solver-criteria.md) define the target physics, result contract, acceptance tests, and implementation order. The [gap analysis](docs/kb/solver-criteria-gap-analysis.md) records current coverage and remaining work; the voxel experiment does not yet satisfy these criteria.

The [turn criteria](docs/kb/turn-criteria.md) define the two decks, confirmed draw/play limits, proposed six-DOF connection presets, and end-turn issue/penalty assessment. The Shared table implements the confirmed card placement rules. Numerical comparison and verified penalties require a compatible solver.
