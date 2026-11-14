# Solver contract

Shared model, result, and adapter types. No solver is implemented here.

- **Units:** SI base units: metres, newtons, newton-metres, radians.
- **Six-component vectors:** global translations X/Y/Z followed by rotations X/Y/Z, or the matching forces and moments.
- **Member ends:** optional `startFixity` and `endFixity`, each `fixed` (transfers moment) or `pinned`. Omitted means `fixed`.
- **Results:** `success` carries displacements and optionally reactions, member forces, and a stability report. `unstable` carries the stability report with mechanism mode shapes. `unsupported` and `error` carry a message.
- **Member forces:** axial force is signed, tension positive. Shear, torsion, and end moments are magnitudes, so no local-axis convention is needed.

Adapters must reject input they cannot represent. Element properties, load cases, and failure criteria are not part of the contract; the OpenSees service documents the choices it makes in [its README](../../services/opensees/README.md).
