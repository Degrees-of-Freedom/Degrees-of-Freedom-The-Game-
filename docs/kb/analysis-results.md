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
  - apps/web/src/game/session.ts
  - docs/kb/solver-criteria.md
  - docs/kb/turn-criteria.md
owner: unknown
status: partial
---

# Structural Analysis Results

The shared solver-contract package defines a versioned result format and a separate logical results store. This records solver output against a structural snapshot; it does not run or verify a solver, implement game scoring, or make a result authoritative. The current Shared table records experimental turn summaries separately. A separate workspace tool can run and store supported solver-neutral requests through OpenSees; it does not automatically convert the game or commit turn scores.

## Run record

`structuralAnalysisResultSchema` and `parseStructuralAnalysisResult` validate a `dof-analysis-result`, version 1. Each run has a model-scoped run ID, purpose (`preview`, `turn`, or `benchmark`), timestamps, duration, solver and adapter IDs and versions, fidelity label, and the complete `StructuralAnalysisRequest` including its snapshot, revision and load path. A zero-based result stage identifies which load-path stage the quantities describe; one record reports one stage. Turn runs carry match, turn, player and rules-version IDs; benchmark runs carry fixture/version, hardware, OS and runtime descriptions. Preview runs carry neither context. Timestamps and solver information are supplied by the producer, not independently authenticated.

The outcome is `success`, `unstable`, `unresolved`, `unsupported`, or `error`, with reason codes and warnings. Unresolved, unsupported and error outcomes require a reason; unsupported and error outcomes cannot contain physical results. A run can contain component-scoped verified results even if other components are unresolved. Classifications are stable, marginal, unstable or unknown, and each component has its own verified/unverified/unavailable label and IDs for its joints, endpoints and members. An unavailable component must be unknown. Unverified and unavailable component classifications need reason codes.

Each displacement, reaction, member-end force, connection force/relative motion, utilization or active-state value has explicit `verified`, `unverified` or `unavailable` status. Unverified values and unavailable values include a reason. Unavailable values have no value field: zero remains a real zero. Member and connection records can also include a governing limit state and an explicitly assessed no-failure/failed result. Optional fields not present mean not reported, not no failure. Modes have scoped joint and endpoint shapes; different bases or signs can represent the same mechanism space.

Vector order is global UX/UY/UZ/RX/RY/RZ for displacements and FX/FY/FZ/MX/MY/MZ for reactions. Member start/end forces and connection forces/relative motions use the member or connector local frame, respectively; the run must identify their sign conventions and the residual-normalization convention. Units follow the snapshot's SI convention. Signed values are retained. Force and moment residuals have separate characteristic scales and tolerances; a producer labeling a stable component or its equilibrium-dependent quantities verified must supply converged, compatibility and active-law checks, and residuals no greater than its stated tolerances.

These are **producer claims and structural consistency checks**, not independent verification. The store does not validate numerical solutions, select acceptable tolerance policies, compare modes, or decide whether a solver/fidelity is authorized for a game turn. A game policy must establish those rules before using any result for scoring. The status and labels must not turn unverified or unavailable outputs into a verified score.

## Storage interface and limits

`createAnalysisResultsStore(storage)` uses the same synchronous `getItem`/`setItem` interface as `createStructuralStateService`. It stores a separate `dof-analysis-results:v1:<encoded model ID>` JSON collection. `write` validates the entire record, checks that the referenced model/revision is already stored and that its snapshot exactly matches the request, and preserves each run ID immutably. Repeating an identical write is idempotent; attempting to change an existing run, save without the matching state, or overwrite a corrupt or unknown-version collection returns an error and preserves the prior bytes. `read` returns all validated runs for a model; `readRun` retrieves one. Returned objects are detached, and the embedded request retains the exact input even if a later run uses another revision.

A collection is written in one storage call. This does **not** provide compare-and-swap, safe concurrent writes across tabs, a multiuser database, indexing across models, or an atomic transaction with the separate structural-state or game-session records. Multiple runs in one collection can consume browser quota. A future transactional backend is required before claiming atomic turn + result + score commits. Explicitly saving preview results is possible, but previews need not be persisted. No retention/deletion policy, automatic game-to-snapshot conversion, atomic match transaction, database backend, or migration from current prototype results is implemented.

Committed game turns should eventually reference an immutable run and the applicable issue/penalty policy, with game transaction and result persistence coordinated atomically. Benchmarks should retain fixture references and environment metadata, and compare against independently sourced expectations in a separate benchmark harness. Existing solver agreement or a `verified` field alone is not evidence that numerical acceptance criteria have passed.

The [visualization criteria](visualization-criteria.md) call for simultaneous-load deformation, signed actions and scoped validity. Joint and endpoint results can support those views where verified, but this record does not provide element-interior interpolation or individual-load attribution; those require a documented compatible solver result and method. Mode shapes remain separate from equilibrium displacements.

## OpenSees integration

The Solver input drawer offers **Run and review saved structural analyses**. Load the supplied cantilever request or enter a solver-neutral request JSON, then choose **Run and save**. The request snapshot is validated and saved first; the result is recorded under its model ID and can be retrieved with **Load saved runs**. The service URL follows the same local-development / VITE_OPENSEES_URL rule as the existing check. Invalid input, storage failure, service errors and unsupported features are reported; changing the request or closing the panel aborts/invalidates pending work. A canceled run may leave its immutable input revision, but does not write a stale result. This is a manual preview workflow, not a turn or scoring commit.

`analyzeAndStore` validates the saved input before invoking a shared-request adapter, checks cancellation and freshness before writing, and refuses a result whose request differs. `runStoredOpenSees` combines snapshot saving, this execution boundary and the OpenSees adapter. The adapter queries the live service's health/version and capabilities, checks exact member properties against that service, and currently accepts only single-stage linear static analysis of active undamaged frame members, zero initial strain, no self-weight, and fully fixed or ball connections. It rejects cables, braces, springs, partial/elastic connections, pinned-pinned frames (the current service turns these into trusses), incompatible section properties, nonzero pinned-end moment loads and other unsupported cases before analysis. Applied load cases and factors are combined into nodal SI loads.

The backend returns whole-model results without the residuals and component-scoped evidence needed by the proposed criteria. Stored displacements and reactions are therefore tagged **unverified**, as is the whole-model stability classification. Pinned-end rotations, local end actions, connection response, mode shapes and capacities are not reconstructed from unavailable information; the stored warnings explain these omissions. This adapter cannot provide authoritative game analysis or score. The current voxel/Shared table solver and its separately stored summaries are unchanged. The general shared snapshot also does not yet represent all quarter-interface, assembly and match-state requirements; see [structural state](structural-state.md).
