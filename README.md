# Degrees of Freedom: The Game

Degrees of Freedom is a planned turn-based structural engineering game where players build and test structures on a 3D grid. The goal is to explore load paths, stability, failure, and structural complexity.

## Run the game

Install Node.js and npm, then run `npm install` and `npm run dev`. Run `npm run build`, `npm run typecheck`, and `npm test` for validation.

The repository contains the web app in `apps/web`, the shared solver contract in `packages/solver-contract`, a Rust structural solver in `crates/dof-solver`, and an OpenSees analysis service in `services/opensees`. See [the knowledge base](docs/kb/README.md) for architecture and project status.

The [unified runtime](docs/kb/unified-runtime.md) opens in one application with a title screen, mode select and per-mode setup, then the Grow Dusk workspace (the other four environments remain in the codebase but are not offered). Creative is the default mode. It includes Engineering challenges, Creative, Forensics, Load in space and a local Shared table card playtest. **Run simulation** is available in every mode, with **Results** for the current model after a run. The approximate voxel analysis lacks independent validation for engineering design. Shared table uses an experimental applied-load solve with individual member-end connections and reports unresolved cases when a solve is unavailable.

## The in-browser solver

Run analysis in the workspace also shows a structural check: a geometrically nonlinear analysis of the model with each member's card section, tension-only cables and self-weight, under the level's gravity loads only (no wind, no load combinations). The panel reports a verdict, the reasons, mechanisms, redundancy, the largest movement, the highest utilisation, slack cables and the reaction at each foundation. It is computed in the browser by the Rust solver in `crates/dof-solver`, compiled to WebAssembly. The compiled module is committed, so nothing extra is needed to run the app.

To work on the solver, install [Rust](https://rustup.rs) and run `rustup target add wasm32-unknown-unknown`. Then `npm run test:solver` runs its tests, `npm run build:solver` rebuilds the module into the web app, and `npm run bench:solver` times it. See [its README](crates/dof-solver/README.md) and the [Rust solver page](docs/kb/rust-solver.md).

## Run the OpenSees service

The same check can come from OpenSees instead. Install [uv](https://docs.astral.sh/uv/), then run `npm run dev:opensees` to serve structural analysis on `http://localhost:8000` and `npm run test:opensees` to run its tests. Start the web app with `VITE_SOLVER=opensees` to use it. See [its README](services/opensees/README.md).

The [original prototype notes](prototypes/voxel-struct/README.md) link to the standalone version in Git history.
The proposed [solver criteria](docs/kb/solver-criteria.md) define the target physics, result contract, acceptance tests, and implementation order. The [gap analysis](docs/kb/solver-criteria-gap-analysis.md) records current coverage and remaining work; the voxel experiment does not yet satisfy these criteria.

The [turn criteria](docs/kb/turn-criteria.md) define the two decks, confirmed draw/play limits, proposed six-DOF connection presets, and end-turn issue/penalty assessment. The Shared table implements the confirmed card placement rules. End turn records an experimental structural assessment. Verified issue comparison and penalties remain pending.
