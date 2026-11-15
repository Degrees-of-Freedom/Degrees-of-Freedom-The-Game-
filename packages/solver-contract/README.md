# Solver contract

Shared model, result, and adapter types. No solver is implemented here. There are two contracts: the original one described first, and a detailed one described at the end.

- **Units:** SI base units: metres, newtons, newton-metres, radians.
- **Six-component vectors:** global translations X/Y/Z followed by rotations X/Y/Z, or the matching forces and moments.
- **Member ends:** optional `startFixity` and `endFixity`, each `fixed` (transfers moment) or `pinned`. Omitted means `fixed`.
- **Results:** `success` carries displacements and optionally reactions, member forces, and a stability report. `unstable` carries the stability report with mechanism mode shapes. `unsupported` and `error` carry a message.
- **Member forces:** axial force is signed, tension positive. Shear, torsion, and end moments are magnitudes, so no local-axis convention is needed.

Adapters must reject input they cannot represent. Element properties, load cases, and failure criteria are not part of the contract; the OpenSees service documents the choices it makes in [its README](../../services/opensees/README.md).

## Detailed analysis contract

`src/analysis.ts` adds a second, fuller contract written against the [solver criteria](../../docs/kb/solver-criteria.md): `AnalysisModel` (sections with properties and capacities; beam, brace and cable members; six connection laws per member end; foundations and loads with ids), `AnalysisOptions`, `DetailedAnalysisResult` (per-component status and validity, reason codes, modes, signed reactions, member and connection forces, utilisation) and the `DetailedSolver` interface.

The Rust solver in [`crates/dof-solver`](../../crates/dof-solver/README.md) is its only implementation, and that crate defines the conventions. In a detailed result `null` means unavailable or unverified, never zero. The contract is a proposal that follows the criteria; the game does not produce it yet.
