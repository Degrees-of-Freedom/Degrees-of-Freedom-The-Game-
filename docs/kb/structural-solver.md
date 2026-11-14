---
title: "Structural Solver"
last_validated: 2026-11-14
validated_against:
  - README.md
  - packages/solver-contract/src/index.ts
  - packages/solver-contract/README.md
  - apps/web/src/solver/unavailable.ts
  - apps/web/src/solver/voxelLoads.ts
  - apps/web/src/game/turnAnalysis.ts
  - apps/web/src/solver/voxel.ts
  - services/opensees/README.md
  - docs/kb/solver-criteria.md
  - docs/kb/turn-criteria.md
  - docs/kb/solver-criteria-gap-analysis.md
owner: unknown
status: partial
---

# Structural Solver

The game intends to communicate load paths, instability, member or connection failure, and structural complexity. The workspace includes an experimental voxel-specific numerical analysis extracted from the standalone prototype. It uses metres and kN internally, frame and cable elements, multiple load combinations, regularization and simplified stability and design checks. It has not been independently validated and is not suitable for engineering design. It is not a shared `SolverAdapter`; the placeholder adapter still returns `unsupported`.

## Target requirements and implementation status

The owner-supplied [solver criteria](solver-criteria.md) are the proposed implementation requirements. They specify intentional member-end connectivity, six-axis connection laws, exact rigid constraints, verified linear and nonlinear physics, component-scoped stability and validity, signed reactions, and deterministic turn analysis. Their gameplay defaults, numerical gates, and performance targets remain proposals. The [gap analysis and milestones](solver-criteria-gap-analysis.md) compare them with current code and tests; no milestone is accepted as complete.

The [turn criteria](turn-criteria.md) now define the confirmed two-deck draw/play limits and per-end connection-card model. The criteria call for comparing the complete structure with the prior committed state. The Shared table currently runs an experimental applied-load solve before committing the draft. The solver preserves member-end identity in fixed and ball connections, releases three rotations at ball connections, and gives unattached ends distinct node IDs even when they coincide with a joint. End turn records stable, unstable, partial or unresolved. Verified before-and-after issue matching and penalties remain pending.

## Model and interface today

The preliminary shared TypeScript contract defines nodes with 3D positions, members joining node IDs, nodal supports and loads, and an asynchronous `SolverAdapter`. A model carries an `SI` label, but the exact units are not specified. Supports contain six restraint flags; loads contain force and moment vectors. A successful result contains six displacement values per node and warnings; other results report `unsupported` or `error` with a message. The interface accepts an optional abort signal, but cancellation behavior is not specified or demonstrated by a real adapter.

The project owner decided that a node has six potential degrees of freedom, in global translation X, Y, Z then rotation X, Y, Z order. Constraints may restrain them; this does not mean every element resists all six. The contract does not yet define the numerical interpretation of displacement rotations, element properties, connection behavior, load cases, or failure criteria.

## Modularity and candidate frameworks

The shared contract is the intended boundary between the game and interchangeable solver adapters. Adapters translate the common model to their backend and must explicitly report unsupported input; an adapter must not silently claim an analysis for features it cannot represent. The contract currently provides no capability discovery or detailed validation schema, so those remain design work.

OpenSees, a custom Rust solver, and a shared-contract TypeScript solver remain intended experiments, not implemented or selected solutions. The voxel TypeScript analysis is a separate game-specific experiment. The reserved `services/opensees` directory contains no service or endpoint. Possible evaluation approaches include a remote OpenSees service, a Rust implementation compiled for an appropriate runtime, and a TypeScript implementation; execution environment, integration, deployment, and supported features remain open. Compare candidates against the same agreed model semantics and reference cases before treating their results as interchangeable. Record unsupported features and numerical limitations for each adapter.

Before numerical implementation, decide exact units and coordinate/sign conventions; element and material properties; connectivity and releases; support and constraint semantics; load cases and combinations; analysis type; result quantities and conventions; stability diagnostics; and failure criteria. Establish how invalid models, unsupported features, solver errors, cancellation, and version or capability differences are communicated. The current types alone do not enforce these rules.

## Testing options to work through

[Criteria section 7](solver-criteria.md#7-acceptance-tests) now supplies the proposed benchmark suite and gates: at most 0.1% relative error for nonzero linear analytical quantities, 1% for nonlinear reference quantities, 2% for mesh-converged buckling loads, and normalized equilibrium residual at most 1e-5. Absolute tolerances for expected zeros and characteristic force/moment scales still need specification. These are targets, not demonstrated solver accuracy.

Current tests cover selected voxel examples, an axial displacement reference, matrix operations, force balance, and load-path behavior. They do not establish compliance with the complete criteria. See the [gap analysis](solver-criteria-gap-analysis.md) for requirement coverage and the [development and testing page](development-and-testing.md) for commands and validation evidence.

For each implementation milestone, add analytical or independently trusted reference fixtures, regression tests, and pass/fail evidence. Verify adapter translation, result validity, unsupported inputs, cancellation, and any service integration separately. Compare nonlinear cases under identical physical assumptions and load paths; agreement between implementations alone does not establish correctness.
