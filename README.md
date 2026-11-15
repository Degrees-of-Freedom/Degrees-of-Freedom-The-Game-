# Degrees of Freedom: The Game

Two players share a table, build on a 3D grid, fit connections and place gravity loads. In Grow Dusk, the browser assesses every turn. After eight rounds, signed foundation load share and historical deductions determine the result. The [criteria ledger](docs/kb/criteria-ledger.md) records release acceptance and outstanding gates.

## Run the game

Install Node.js 22 or later, then run `npm ci` and `npm run dev`. Open **Play** to start or resume the local Grow Dusk match. **More modes** opens the existing engineering, Creative, Forensics, Load in space and Shared table workspaces.

The repository contains the web app in `apps/web`, the shared solver contract in `packages/solver-contract`, a Rust structural solver in `crates/dof-solver`, and an OpenSees analysis service in `services/opensees`. See [the knowledge base](docs/kb/README.md) for architecture and project status.

The [Grow Dusk runtime guide](docs/kb/grow-dusk-runtime.md) covers turn authority, browser saves and recovery, controls, build prerequisites, static hosting and reproducible tests. For a distributable build, install Rust with the `wasm32-unknown-unknown` target and run `npm run build`. Output is in `apps/web/dist`.

## The in-browser solver

Grow Dusk uses Rust compiled to WebAssembly for card gravity with self-weight off. The turn worker isolates components, checks stability and capacities, and records the accepted physical repair or unresolved scope. The editor has its own analysis options. The development checkout includes the compiled module.

To work on the solver, install [Rust](https://rustup.rs) and run `rustup target add wasm32-unknown-unknown`. Then `npm run test:solver` runs its tests, `npm run build:solver` rebuilds the module into the web app, and `npm run bench:solver` times it. See [its README](crates/dof-solver/README.md) and the [Rust solver page](docs/kb/rust-solver.md).

## Run the OpenSees service

OpenSees powers independent numerical checks and optional editor workflows. Install [uv](https://docs.astral.sh/uv/), run `npm run test:opensees` for the references, or `npm run dev:opensees` for the local editor service. See the [service README](services/opensees/README.md).

The [original prototype notes](prototypes/voxel-struct/README.md) link to the standalone version in Git history.
The proposed [solver criteria](docs/kb/solver-criteria.md) define the target physics, result contract, acceptance tests, and implementation order. The [gap analysis](docs/kb/solver-criteria-gap-analysis.md) records current coverage and remaining work; the voxel experiment does not yet satisfy these criteria.

The [turn criteria](docs/kb/turn-criteria.md) and [card definitions](docs/kb/card-definition-criteria.md) document the release printing, draw limits, physical connection laws and end-turn policy.
