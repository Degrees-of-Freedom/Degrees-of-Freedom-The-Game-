---
title: "Structural State and Persistence"
last_validated: 2026-11-14
validated_against:
  - apps/web/src/game/structuralState.ts
  - apps/web/src/game/structuralState.test.ts
  - apps/web/src/game/persistence.ts
  - apps/web/src/game/store.ts
  - apps/web/src/game/analysis.ts
  - apps/web/src/solver/voxelInput.ts
  - apps/web/src/solver/voxelSections.ts
  - apps/web/src/solver/voxelLoads.ts
  - docs/kb/solver-criteria.md
owner: unknown
status: partial
---

# Structural State and Persistence

This page describes the implemented experimental voxel state service and the proposed path to a general, solver-neutral structural state. It does not meet all of the proposed [solver criteria](solver-criteria.md): independent member-end connectivity, general six-axis connection laws, reusable material definitions, nonlinear history, and a shared solver adapter remain work to do. There is no SQLite or remote state service.

## Browser saves

The game store saves each level to browser localStorage under `voxstruct:<levelId>` and the selected level separately at `voxstruct:level`. The version 1 JSON envelope is:

```json
{
  "format": "dof-voxel-save",
  "version": 1,
  "levelId": "sandbox",
  "model": {
    "members": [{ "id": 1, "a": "0,0,0", "b": "0,0,1", "type": "shs" }],
    "attrs": { "0,0,0": { "found": true }, "0,0,1": { "load": 50 } },
    "nextId": 2
  }
}
```

Member IDs are positive unique integers below `nextId`; endpoints are distinct nonnegative integer grid-coordinate keys. Member type is `shs`, `glulam`, `ipe`, `heb`, or `cable`. Attributes are optional foundation, joint, load, locked and target flags/values; loads are in kN. The voxel solver joins members by coordinate key and uses two-metre cells; a node has six potential DOFs. These are experimental voxel semantics, not the intended general connectivity model. A save captures game geometry and attributes, not a frozen solver model or level catalog.

`createStateService(storage)` accepts the browser storage interface and returns explicit found/missing/error and save success/error outcomes. It validates strict shape, versions, finite numbers, member IDs, endpoints and level-key identity. An old unversioned `GameModel` is read as legacy and converted to v1 on the next successful save; reading alone does not overwrite it. Corrupt, unsupported-version and mismatched saves are never overwritten by this service. The workspace warns when loading or saving fails, and otherwise uses a fresh level if a save cannot be read. Existing data remains in localStorage for recovery. Browser storage can still be cleared by the user or browser. The workspace can import and export model JSON. Cloud sync, cross-session revision history, and conflict resolution remain open. Parsed objects are detached from stored data.

## Recomposition for the existing solver

`toVoxelInput` resolves a game model and level into the current solver's model and level inputs. `createVoxelAnalysisSnapshot` validates and copies those inputs into a separate JSON envelope: `format: dof-voxel-analysis`, `version: 1`, `model`, `level`, and `solverProfile`. The level records resolved loading and objective inputs, including target ground heights; unlimited budget is JSON null and restored to Infinity. The snapshot excludes results and UI state. `recomposeVoxelAnalysis` validates the envelope, reconstructs independent input objects, and refuses a profile mismatch. Both analysis and auto-design use this path.

The profile records the experimental algorithm identifier plus current grid size, section catalog, load combinations and load factors. Since the solver reads those values from code, the profile prevents replay after their values differ; it does not run an old solver or independently capture every source-code dependency. Any behavior-changing solver edit must bump the algorithm identifier before claiming compatible replay. Store the application/solver revision with any benchmark run; cross-version numerical equivalence is not guaranteed. The voxel solver is approximate and uses metres and kN; its output is not a verified engineering result.

## General structural snapshot: proposed next schema

Conor Schafer's [criteria](solver-criteria.md) require an immutable, versioned solver-neutral model with explicit semantics. A future format should record stable model/revision IDs and SI units; reference coordinates; independently addressable member-end interfaces; intentional connections with six local free/rigid/elastic laws; member family and orientation; resolved material/section and capacity properties; cable rest length or initial strain; configurable foundation restraints and IDs; persistent nodal loads, load cases and self-weight policy; and committed damage separately from computed results. Coincident geometry must not itself imply a connection. Keep player/turn and display state outside the analytical model. The exact attachment model, local-frame/rotation conventions, units, force signs, load paths, and failure policy require decisions before this can be a validated interoperability contract.

A solver adapter must validate capability and reject any input it cannot represent, preserve object ID mappings, and record the adapter/solver version and effective analysis options. Do not silently drop connectivity, stiffness, loads or damage. Unverified results must be marked unavailable, with component scope and diagnostics. No adapter for this general model exists yet. The current voxel snapshot is deliberately identified as a different format; it must not be mistaken for the general schema.

## Benchmark fixtures and storage direction

Use human-readable, version-controlled JSON as the proposed canonical source for benchmark cases, one per file. SQLite may later provide a generated index or results store, but is not needed for the current per-level browser saves. A fixture should include a schema version, stable ID, model and analysis options, required capabilities, expected status and result scope, reference and derivation, units, per-quantity relative and absolute tolerances, and characteristic force/moment scales. Unsupported cases are reported as unsupported, not passed. Store timing runs separately with solver revision, hardware, environment, warmup, sample count and latency percentiles.

Start with axial tension/compression, cantilever bending and torsion, a simply supported beam, and unequal support stiffness. Add rigid/pin/partial/semi-rigid joints, unconnected coincident members, a stable component beside an unstable one, a triangulated 3D truss, and an unbraced mechanism. Later fixtures cover imperfect-column buckling and sway, cable slack/pretension, overload and optional redistribution, symmetry and coordinate transforms, preview/replay, and invalid inputs. Expected numerical values, source references and zero tolerances still need to be defined and reviewed; no such fixture suite is implemented by this change. Proposed accuracy gates and 10,000 seeded states are in the criteria, not demonstrated results.
