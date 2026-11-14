# Degrees of Freedom: The Game

Degrees of Freedom is a planned turn-based structural engineering game where players build and test structures on a 3D grid. The goal is to explore load paths, stability, failure, and structural complexity.

## Run the scaffold

Install Node.js and npm, then run `npm install` and `npm run dev`. Run `npm run build`, `npm run typecheck`, and `npm test` for validation.

The repository contains the web app in `apps/web`, the preliminary shared solver contract in `packages/solver-contract`, and a reserved OpenSees service location in `services/opensees`. See [the knowledge base](docs/kb/README.md) for architecture and project status.

The current app is a foundation with an orbitable 3D grid. Building tools, gameplay, and structural analysis are not implemented.
