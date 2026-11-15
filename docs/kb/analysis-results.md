---
title: "Structural Analysis Results"
last_validated: 2026-11-14
validated_against:
  - packages/solver-contract/src/analysis-result.ts
  - packages/solver-contract/src/analysis-results-store.ts
  - packages/solver-contract/src/analysis-results-store.test.ts
  - packages/solver-contract/src/stored-analysis.ts
  - apps/web/src/solver/structuralOpenSees.ts
  - apps/web/src/solver/runStoredOpenSees.ts
  - apps/web/src/solver/structuralOpenSees.test.ts
  - apps/web/src/components/StoredAnalysisPanel.tsx
  - packages/solver-contract/src/structural-state.ts
  - packages/solver-contract/src/structural-state-service.ts
  - apps/web/src/game/turns.ts
  - apps/web/src/game/turnAnalysis.ts
  - apps/web/src/game/turnEvidence.ts
  - apps/web/src/game/turnEvidence.test.ts
  - apps/web/src/game/session.ts
  - docs/kb/solver-criteria.md
  - docs/kb/turn-criteria.md
owner: unknown
status: partial
---

# Structural Analysis Results

The shared solver-contract package defines a versioned result format and a separate logical results store. This records solver output against a structural snapshot; it does not run or verify a solver, implement game scoring, or make a result authoritative. Shared table archives a versioned experimental result with each new completed turn. The workspace also offers a manual OpenSees run over imported structural requests.

## Run record

`structuralAnalysisResultSchema` and `parseStructuralAnalysisResult` validate a `dof-analysis-result`, version 1. Each run has a model-scoped run ID, purpose (`preview`, `turn`, or `benchmark`), timestamps, duration, solver and adapter IDs and versions, fidelity label, and the complete `StructuralAnalysisRequest` including its snapshot, revision and load path. A zero-based result stage identifies which load-path stage the quantities describe; one record reports one stage. Turn runs carry match, turn, player and rules-version IDs; benchmark runs carry fixture/version, hardware, OS and runtime descriptions. Preview runs carry neither context. Timestamps and solver information are supplied by the producer, not independently authenticated.

The outcome is `success`, `unstable`, `unresolved`, `unsupported`, or `error`, with reason codes and warnings. Unresolved, unsupported and error outcomes require a reason; unsupported and error outcomes cannot contain physical results. A run can contain component-scoped verified results even if other components are unresolved. Classifications are stable, marginal, unstable or unknown, and each component has its own verified/unverified/unavailable label and IDs for its joints, endpoints and members. An unavailable component must be unknown. Unverified and unavailable component classifications need reason codes.

Each displacement, reaction, member-end force, connection force/relative motion, utilization or active-state value has explicit `verified`, `unverified` or `unavailable` status. Unverified values and unavailable values include a reason. Unavailable values have no value field: zero remains a real zero. Member and connection records can also include a governing limit state and an explicitly assessed no-failure/failed result. Optional fields not present mean not reported, not no failure. Modes have scoped joint and endpoint shapes; different bases or signs can represent the same mechanism space.

Vector order is global UX/UY/UZ/RX/RY/RZ for displacements and FX/FY/FZ/MX/MY/MZ for reactions. Member start/end forces and connection forces/relative motions use the member or connector local frame, respectively; the run must identify their sign conventions and the residual-normalization convention. Units follow the snapshot's SI convention. Signed values are retained. Force and moment residuals have separate characteristic scales and tolerances; a producer labeling a stable or marginal component or its equilibrium-dependent quantities verified must supply converged, compatibility and active-law checks, and residuals no greater than its stated tolerances.

These are **producer claims and structural consistency checks**, not independent verification. The store does not validate numerical solutions, select acceptable tolerance policies, compare modes, or decide whether a solver/fidelity is authorized for a game turn. A game policy must establish those rules before using any result for scoring. The status and labels must not turn unverified or unavailable outputs into a verified score.

## Storage interface and limits

`createAnalysisResultsStore(storage)` uses the same synchronous `getItem`/`setItem` interface as `createStructuralStateService`. It stores a separate `dof-analysis-results:v1:<encoded model ID>` JSON collection. `write` validates the entire record, checks that the referenced model/revision is already stored and that its snapshot exactly matches the request, and preserves each run ID immutably. Repeating an identical write is idempotent; attempting to change an existing run, save without the matching state, or overwrite a corrupt or unknown-version collection returns an error and preserves the prior bytes. `read` returns all validated runs for a model; `readRun` retrieves one. Returned objects are detached, and the embedded request retains the exact input even if a later run uses another revision.

A collection is written in one storage call. This does **not** provide compare-and-swap, safe concurrent writes across tabs, a multiuser database, indexing across models, or an atomic transaction with the separate structural-state or game-session records. Multiple runs in one collection can consume browser quota. Any flow that writes across those records needs its own transaction or recovery protocol. Explicitly saving preview results is possible, but previews need not be persisted. This standalone archive has no retention API or database backend.

The match save must retain the applicable issue and penalty policy when verified scoring is added. Benchmarks should retain fixture references and environment metadata, and compare against independently sourced expectations in a separate benchmark harness. Existing solver agreement or a `verified` field alone is not evidence that numerical acceptance criteria have passed.

The [visualization criteria](visualization-criteria.md) call for simultaneous-load deformation, signed actions and scoped validity. Joint and endpoint results can support those views where verified, but this record does not provide element-interior interpolation or individual-load attribution; those require a documented compatible solver result and method. Mode shapes remain separate from equilibrium displacements.

## OpenSees integration

The Solver input drawer offers **Run and review saved structural analyses**. Load the supplied cantilever request or enter a solver-neutral request JSON, then choose **Run and save**. The request snapshot is validated and saved first; the result is recorded under its model ID and can be retrieved with **Load saved runs**. The service URL follows the same local-development / VITE_OPENSEES_URL rule as the existing check. Invalid input, storage failure, service errors and unsupported features are reported; changing the request or closing the panel aborts/invalidates pending work. A canceled run may leave its immutable input revision, but does not write a stale result. This is a manual preview workflow, not a turn or scoring commit.

`analyzeAndStore` validates the saved input before invoking a shared-request adapter, checks cancellation and freshness before writing, and refuses a result whose request differs. `runStoredOpenSees` combines snapshot saving, this execution boundary and the OpenSees adapter. The adapter queries the live service's health/version and capabilities, checks exact member properties against that service, and currently accepts only single-stage linear static analysis of active undamaged frame members, zero initial strain, no self-weight, and fully fixed or ball connections. It rejects cables, braces, springs, partial/elastic connections, pinned-pinned frames (the current service turns these into trusses), incompatible section properties, nonzero pinned-end moment loads and other unsupported cases before analysis. Applied load cases and factors are combined into nodal SI loads.

The backend returns whole-model results without the residuals and component-scoped evidence needed by the proposed criteria. Stored displacements and reactions are therefore tagged **unverified**, as is the whole-model stability classification. Pinned-end rotations, local end actions, connection response, mode shapes and capacities are not reconstructed from unavailable information; the stored warnings explain these omissions. This adapter cannot provide authoritative game analysis or score. The Shared table runs its own applied-load analysis and archives its evidence through the match save. The general shared snapshot also does not yet represent all quarter-interface, assembly and match-state requirements; see [structural state](structural-state.md).

## Shared table save and reload

End turn solves the playtest once and records its status, resolved structural request and available signed foundation reactions with the accepted event. The request is compiled from the turn board and draft attachments in SI units. It preserves separate coincident ends, card provenance, section axes, cable pretension, the simultaneous gravity cards and the current playtest's lumped self-weight policy. The experimental solver reports the whole-model scope. Numerical values are unverified, and failed or missing reactions have an unavailable marker. The Turn panel can display the last committed reactions after reload.

Session version 2 writes draft, committed events and embedded evidence together through the existing single-key browser save. Replay validates run, player and revision lineage and restores the saved result without re-solving. Version 1 replays still load and retain their original short outcomes. If saving fails, the app reports it and retains the in-memory turn. This path is single-device storage and offers no cross-tab conflict guarantee. Archived turn records are in the match save. Manually saved runs remain accessible through the standalone results store.

## Three solver paths

The game owns the board, rules, committed revisions and which result a turn accepts. Each solver should translate a frozen shared request into its native model and return the agreed result envelope. Keep backend-specific options and native diagnostics with the run where they affect replay. Reuse the same joint, endpoint, member, foundation and load IDs at the game boundary. Run all comparisons under the same simultaneous loads, units and self-weight policy.

- OpenSees static can start from the existing linear adapter. The newer OpenSees branch changes the capability and result shapes, so it needs its own mapping.
- The current nonlinear OpenSees branch advances load through static equilibria. If the intended OpenSees dynamic path includes time-dependent motion, define the time history, mass, damping, initial conditions and sampled outputs for it.
- Rust uses a separate detailed model and local Z orientation reference. Transform the shared local Y basis into its Z reference. Validate a section with unequal inertias and preserve the native residual and force-sign definitions.

The active Shared table currently archives the voxel playtest. Wiring these three solver paths into it, defining quarter ports and assembly mappings, measuring representative turn latency and enabling verified scoring are subsequent work. Solver comparison should include the input, component verdicts, residual checks and end-to-end latency alongside solver compute time.

## Results panel presentation

The workspace presents the selected structural solver first, with its name visible for idle, running, completed and unavailable checks. Detailed and stability-only adapters share metric labels and layout; unsupported values are not invented. Changing solver hides the previous solver's result immediately. Stability, capacity use and support reactions remain distinct, and unresolved states use a caution treatment rather than a failure verdict.

The separate approximate voxel calculation is labelled Scene preview. It supplies the viewer overlays and must not be attributed to the selected structural solver. Load-case selection, deformation exaggeration and member inspection operate on this preview. The displacement slider multiplies the viewer's automatic exaggeration, not physical displacement. Model checks are expandable. Shared-table results identify the selected structural solver but explain that current shared-table analysis uses the approximate voxel solver.
