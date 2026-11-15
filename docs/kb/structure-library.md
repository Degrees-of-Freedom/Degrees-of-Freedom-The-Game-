---
title: "Structure Library"
last_validated: 2026-11-15
validated_against:
  - scripts/generate-structure-library.mjs
  - scripts/render-structure-previews.ps1
  - apps/web/src/game/structureLibrary.test.ts
  - apps/web/src/components/StructureLibrary.tsx
  - apps/web/public/structures/catalog.json
  - apps/web/public/structures/evaluator-baseline.json
  - apps/web/src/evaluator/engine/rustDesign.ts
  - apps/web/src/evaluator/engine/rustDesign.test.ts
owner: unknown
status: current
---

# Structure library

The workspace has 20 deterministic voxel specimens, from a one-member column to an 80-node, 208-member building. These exercise existing viewer and solver behavior; they are not independently verified engineering benchmarks or a general turn-state database.

## Browse and solve

Use the Structure library selector to browse previews, then **Load structure**. **Previous & load** and **Next & load** cycle with wraparound. Geometry is copied into a dedicated `library` level; other challenge and sandbox saves are preserved. Each load within the library is undoable. Editing does not mutate the source records. The library has one browser save slot, not a save per specimen. The viewer fits the camera when a specimen loads. The selector describes the selected source preview; after editing, it is not a live thumbnail of the model.

Open **Structure library** in the environment action bar. Use **Run simulation** for the structure evaluation (on the Rust solver) and the configured structural check. OpenSees requires the separate service and its current capability limits still apply. Loading a specimen does not solve it. Old analysis is invalidated by model identity when cycling. The library uses the challenge-mode persistence slot and retains the selected presentation style; it preserves creative/repair saves and the current multiplayer turn state.

## Records and previews

`apps/web/public/structures/` contains:

- `catalog.json`: versioned catalog with all 20 full records.
- `records/<id>.json`: individual records, including metadata, intended stability, dimensions, counts and a validated v1 voxel save.
- `previews/<id>.png`: 960 × 720 orthographic geometry previews; supports are blocks and downward loads are red arrows. These use exact record coordinates, not solved deformations or viewer screenshots.
- `contact-sheet.png`: all 20 previews.
- `structures.sqlite`: portable database with table `structures`: primary-key `id`, `name`, `family`, `member_count`, `node_count`, `preview` and full `record_json`. Example query: `SELECT id, name, member_count FROM structures ORDER BY id;`. This is a downloadable index, not a running backend. Machine-generated structures live separately in `evolved.sqlite` (see [structure GAN](structure-gan.md)); regenerating this library does not touch it.
- `evaluator-baseline.json`: observed regression summaries of the structure evaluator on the Rust solver, with provenance, separate from design expectations. It replaced `voxel-baseline.json` on 2026-11-15.

Records use two-metre grid cells, kN point loads and the existing section catalog. A `joint` locks all member-end axes; otherwise the evaluator releases bending rotations but retains torsion. Foundations fix all six DOFs. Library analysis uses sandbox semantics, unlimited inventory/budget, `q0 = 0`, existing self-weight, notional loads and ULS/SLS combinations. These are not pure point-load analytical solutions. Self-weight and member wind are distributed along members in the Rust load cases. SI translation is tested through `toStructuralModel`; OpenSees numerical results are not part of the stored baseline.

Some imported specimens intentionally exceed interactive member-length limits (notably the pyramid and mast guys). They test imported geometry; being loadable does not establish legal game placement. General per-end connections and turn-state proposals remain separate.

## Coverage and observed behavior

| IDs | Specimens | Main purpose |
| --- | --- | --- |
| 01–03 | Stocky/slender columns, cantilever | Axial load, bending, scale |
| 04–07 | Rigid/released/braced/timber portals | Joints, mechanisms, stiffness contrast |
| 08–12 | Space frame, two-storey frame, braced/moment towers, midrise | 3D connectivity, height, dense picking, scaling |
| 13–15 | Short/long/cable-diagonal bridges | Deck load paths, span, cable behavior |
| 16–18 | Timber roof grid, pyramid, guyed mast | Spatial geometry, material colors, pretension |
| 19–20 | Supported plus floating, unsupported cube | Partial-result scope and no-foundation diagnostics |

`expectation` is qualitative design intent. Cable specimens are marked `review`. The baseline records:

- **Mechanism and support cases.** The released portal (05) is a mechanism, case 19 has two floating nodes, and case 20 has no foundation.
- **Buckling.** Two specimens whose intent is `stable` buckle under the library's factored loads. The slender column (02) buckles at 0.37 of its governing combination. The IPE cantilever (03) stalls at 31 % of the load, near its lateral-torsional buckling load of about 9 kN at the tip. Both are reported as unresolved with a buckling explanation, not as mechanisms. The voxel kernel had reported both as standing, with α_cr 0.25 (02) and utilisation 1.35 (03).
- **Utilisation.** The pyramid exceeds utilisation 1.
- **Buckling factor.** The baseline also records α_cr (`bucklingFactor`), with 128 standing for "128 or more".

These failures are useful specimens, not import failures. The baseline omits displacements and utilisation for unusable results, and case 19's numbers apply only to its supported component. See [voxel retirement](voxel-retirement.md#evidence-and-differences-from-the-voxel-results) for the comparison with the voxel results.

The library was integrated with upstream `main` at `6900f96`. That solver removes the previous diagonal regularization, reduces inactive unloaded rotational coordinates, and rejects unconverged cable active sets. The initial baseline comparison detected displacement changes in ten specimens and all four combinations becoming failed for the released portal; the baseline was deliberately refreshed for this implementation. This records a version change, not independent numerical validation.

## Regenerate and verify

From the repository root, with Node 24 (built-in SQLite):

```powershell
node scripts/generate-structure-library.mjs
# Windows System.Drawing/GDI+ renders previews.
./scripts/render-structure-previews.ps1

# Refresh observed results deliberately, then review the changes:
$env:UPDATE_STRUCTURE_BASELINE = '1'
npx vitest run apps/web/src/game/structureLibrary.test.ts
Remove-Item Env:UPDATE_STRUCTURE_BASELINE

# Normal verification never rewrites the baseline:
npx vitest run apps/web/src/game/structureLibrary.test.ts
npm run build
```

Edit the generator to change specimens; regenerate records and database together. Regenerate previews for geometry/label changes. Tests check unique geometry and edges, bounds, metadata, PNG signatures, save validation, detached loading/undo, SI translation and all 20 evaluations. Categorical results compare exactly. Displacement, utilisation and buckling factor use a tolerance of `1e-9 + abs(reference) * 1e-6`. Provenance includes the base Git revision, a hash of the evaluator source contents (the working tree may contain uncommitted changes) and the SHA-256 of the solver binary. Timing is excluded: this is not a latency benchmark. The observed baseline detects implementation changes; it does not independently prove numerical accuracy or engineering safety.
