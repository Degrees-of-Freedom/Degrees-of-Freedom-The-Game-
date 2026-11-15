---
title: "Structural State and Persistence"
last_validated: 2026-11-14
validated_against:
  - docs/kb/game-completion-criteria.md
  - docs/kb/element-representation-criteria.md
  - packages/solver-contract/src/structural-state.ts
  - packages/solver-contract/src/structural-state-service.ts
  - packages/solver-contract/src/structural-state.test.ts
  - apps/web/src/game/structuralState.ts
  - apps/web/src/game/structuralState.test.ts
  - apps/web/src/game/persistence.ts
  - apps/web/src/game/store.ts
  - apps/web/src/game/analysis.ts
  - apps/web/src/evaluator/model.ts
  - apps/web/src/evaluator/sections.ts
  - apps/web/src/evaluator/loads.ts
  - docs/kb/solver-criteria.md
  - docs/kb/turn-criteria.md
  - docs/kb/structural-solver.md
  - apps/web/src/game/structuralModel.ts
owner: unknown
status: partial
---

# Structural State and Persistence

The [structure library](structure-library.md) supplies 20 voxel specimens, PNG previews, a generated SQLite catalog and observed regression baselines. Its SQLite file is a portable catalog, not a state persistence service.

This page describes the shared solver-neutral structural snapshot and revision storage, plus the existing experimental voxel saves. The shared snapshot is a data contract, not a numerical solver or complete turn system. Shared table compiles a structural request from explicit turn attachments and stores it with experimental reactions. The workspace also offers a limited manual OpenSees workflow. Nonlinear physics and full criteria validation remain work to do. The state service does not use SQLite or a remote service; the separate structure library distributes a SQLite index.

## Shared structural snapshot v1

`@dof/solver-contract` exports `structuralSnapshotSchema`, `parseStructuralSnapshot`, and the inferred `StructuralSnapshot` type. The JSON envelope is tagged `dof-structural-state`, version 1; it contains model/revision IDs and an optional parent revision. All numeric quantities use SI: metres, newtons, newton-metres, pascals, kilograms, seconds and radians. Global axes are right-handed with Z up; six-axis arrays are UX/UY/UZ/RX/RY/RZ. No owner or card identity affects physics by itself.

- `joints` have IDs and reference positions. Every member has separately identified start and end interfaces with their own reference positions. Equal coordinates do not connect anything. An explicit connection joins one endpoint to one coincident joint; no more than one connector can be attached to an end. An unattached end remains disconnected. Joint and end IDs remain distinct even at the same location.
- `members` distinguish frame, axial brace, tension-only cable and standalone axial spring. Frames, braces and cables reference saved material and section records. Frames require E, G, A, Iy, Iz and J; frames and braces may carry initial strain, and cable state specifies rest length or initial strain. Springs record axial stiffness and rest length, with optional mass per length. A member's `referenceY` selects local roll: local X runs from start to end, Y is the normalized projection of the reference vector onto the plane normal to X, and Z = X cross Y. Zero-length members and parallel/zero reference directions are rejected. Spring and brace numerical formulations are not implemented by the contract.
- A connection records ID, joint and endpoint, its own reference-Y direction in the same end-A-to-end-B frame convention, optional card identity, explicit active/released state, capacities, and six local laws. Each law is free, locked, or elastic with positive stiffness; elastic translational stiffness is N/m and rotational stiffness is N·m/rad. Locked means an exact constraint, not an infinitely strong connection. The contract records the laws; nonlinear rotation and constitutive conventions still need agreement before a solver can claim support.
- Materials and sections contain resolved numeric properties and named capacities. Capacity names are identifiers, not a defined interaction formula; the solver must reject capacity checks it cannot interpret. Foundations identify a joint, six restraints and optional owner. Loads have IDs, explicit joint/endpoint targets, global force and moment vectors, persistence, and optional card provenance. Load cases reference loads and factors. Optional member self-weight records a global gravity vector in m/s² and requires material density or spring mass per length; it is not silently generated as a duplicate nodal load.
- Card provenance records instance and versioned definition IDs, and duplicate deployed instance IDs are rejected. It is not the complete match state: decks, hands, player turns, issue assessments, penalties and committed analysis results belong to a future transaction layer.

`parseStructuralSnapshot` rejects unknown fields/versions, nonfinite numbers, duplicate IDs within collections, missing references, invalid local frames, mismatched connection locations and incompatible self-weight data. It returns a detached copy. It does not decide gameplay legality or prove stability. Unconnected or unstable components are legal states. Optional member and connection damage descriptors preserve a versioned definition ID and numeric parameters; a solver must reject unrecognized descriptors. The format does not yet define general limit-state interactions, solver-specific nonlinear history, member subdivision or arbitrary distributed loads; these require explicitly versioned extensions.

`structuralAnalysisRequestSchema` pairs one snapshot with linear-static or geometric-nonlinear-static analysis and an ordered load path. Each stage lists absolute factors by load case; unlisted cases have zero factor. Its explicit self-weight factor multiplies the saved gravity load and must be zero if self-weight is disabled. A limited experimental OpenSees adapter consumes a subset of this request; unsupported features are rejected explicitly. Adapters must validate feature support and return unsupported or unresolved rather than change meanings. No conversion from old voxel snapshots is automatic because coincident joints, loads and catalog assumptions cannot always be recovered safely.

`createStructuralStateService(storage)` stores validated immutable revisions under encoded model/revision keys using a synchronous `getItem`/`setItem` interface. It refuses to overwrite a different or corrupt revision, checks parent existence within the model, and returns explicit outcomes; loading validates again. Each revision is one storage write. This is not an atomic multiplayer turn transaction, conflict-free multi-tab store, directory index, SQLite database or cloud service. The manual workspace analysis uses this service. Shared table embeds its structural revision and evidence together in the match session. Back up browser data independently; storage quotas and deletion remain browser-controlled.

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

## Review against the latest criteria

The v1 save and voxel snapshot preserve only the current prototype. They cannot yet serve as authoritative turn or general solver state:

| Requirement | Current state and gap |
| --- | --- |
| Member families and card properties | Five fixed voxel names are stored. Beam-column and cable have experimental implementations; no distinct axial brace or standalone spring is representable. A section name refers to code-defined values, not per-card resolved properties, section orientation, or versioned card identity. The voxel profile records a catalog but does not make it a portable independent solver model. The spring and brace decisions are described in [member direction](structural-solver.md#member-and-connection-direction-from-tanias-branch). |
| Cable state | The voxel solver uses catalog pretension; snapshots do not record per-card cable rest length, initial strain or pretension. Cable active-set behavior is experimental and is not verified nonlinear cable physics. |
| Explicit connections | A boolean joint at a coordinate affects all attached ends. There are no connection IDs, independently connectable member-end interfaces, six-axis free/locked/elastic laws, orientation, stiffness, capacity, or detached coincident joints. The v1 format cannot express the confirmed per-end card rule. |
| Foundation and load identities | Foundation and scalar load attributes are keyed by coordinates; there are no separate stable IDs, ownership or explicit member-end targets. Configurable six-DOF restraints, general forces/moments, persistent load-card identities and self-weight policy are absent. |
| Base-game loading | The confirmed turn rules use persistent downward gravity cards. The legacy voxel solver also generates wind, load combinations and other level loads; replaying it does not implement the base-game load policy. |
| Committed turns and replay | Neither save includes turn/model revision IDs, card and deck state, ownership, parent revision, analysis options, issue baseline, penalties or atomic turn commits. A detached solver snapshot is not a complete deterministic turn record. |
| Other solvers | `dof-voxel-analysis` is not the shared SI contract. The current OpenSees stability translation discards section and several load details and treats cables as two-way ties, with a warning. It is not a lossless recomposition of saved voxel state or a general analysis adapter. |

Preserve old saves as legacy prototype data. The shared schema now models per-end connections and attachments, resolved properties and orientations, loads, and stable object/revision IDs; migrate voxel data only when the original meaning is recoverable. An adapter must reject or explicitly label unsupported features. No general schema migration or independently validated benchmark fixture suite exists today. The separate [structure library](structure-library.md) has 20 experimental voxel specimens and regression baselines.

## General structural snapshot: remaining work

Conor Schafer's [criteria](solver-criteria.md) require an immutable, versioned solver-neutral model with explicit semantics. The shared format records stable model/revision IDs and SI units; reference coordinates; independently addressable member-end interfaces; intentional connections with six local free/rigid/elastic laws; member family and orientation; resolved material/section and capacity properties; cable rest length or initial strain; configurable foundation restraints and IDs; persistent nodal loads, load cases and self-weight policy; and active/removed member and active/released connection states. Versioned damage descriptors can be retained, but their physical meaning is not standardized. Coincident geometry must not itself imply a connection. Keep player/turn and display state outside the analytical model. Large-rotation conventions, local force signs, nonlinear load-path interpretation, capacity interactions and failure policy still need agreement and solver validation.

A solver adapter must validate capability and reject any input it cannot represent, preserve object ID mappings, and record the adapter/solver version and effective analysis options. Do not silently drop connectivity, stiffness, loads or damage. Unverified results must be marked unavailable, with component scope and diagnostics. The experimental OpenSees adapter supports only a narrow linear subset; see [analysis results](analysis-results.md#opensees-integration). The current voxel snapshot is deliberately identified as a different format; it must not be mistaken for the general schema.

## Benchmark fixtures and storage direction

Use human-readable, version-controlled JSON as the proposed canonical source for benchmark cases, one per file. SQLite may later provide a generated index or results store, but is not needed for the current per-level browser saves. A fixture should include a schema version, stable ID, model and analysis options, required capabilities, expected status and result scope, reference and derivation, units, per-quantity relative and absolute tolerances, and characteristic force/moment scales. Unsupported cases are reported as unsupported, not passed. Store timing runs separately with solver revision, hardware, environment, warmup, sample count and latency percentiles.

Start with axial tension/compression, cantilever bending and torsion, a simply supported beam, and unequal support stiffness. Add rigid/pin/partial/semi-rigid joints, unconnected coincident members, a stable component beside an unstable one, a triangulated 3D truss, and an unbraced mechanism. Later fixtures cover imperfect-column buckling and sway, cable slack/pretension, overload and optional redistribution, symmetry and coordinate transforms, preview/replay, and invalid inputs. Expected numerical values, source references and zero tolerances still need to be defined and reviewed; no independently validated fixture suite is implemented by this change; see the separate experimental [structure library](structure-library.md). Proposed accuracy gates and 10,000 seeded states are in the criteria, not demonstrated results.

## Future element representation definitions

[Element representation criteria](element-representation-criteria.md) require versioned section dimensions/roll, spring parameters, planar/trichord assembly topology, stable parent/part/interface IDs and cable geometry metadata as appropriate. Current browser member types and preliminary analytical definitions do not cover that complete catalogue. Extend validated schemas deliberately before persistence or numerical use; readable thickness, selection targets and LOD are presentation preferences and must not change authoritative physical data. Migration, assembly cards and solver mapping remain future work.

See [structural analysis results](analysis-results.md) for the standalone run archive, embedded turn evidence, and transactional limits.

## Complete match and quarter-interface requirements

[Saved-match criteria](saved-match-criteria.md) extend the target beyond a structural snapshot: private decks/hands, draws, phase/draft, rules/catalogue versions, model/evidence lineage, penalty ledger, final score and atomic/recoverable head commits. [Placement criteria](placement-criteria.md) require parent-relative quarter ports and assembly part mappings across all families. Existing snapshot v1 joint/endpoint/two-terminal member records do not establish complete quarter-interface, assembly or match-transaction support. Do not reinterpret legacy snapshots silently; migrate explicitly or keep them read-only.
