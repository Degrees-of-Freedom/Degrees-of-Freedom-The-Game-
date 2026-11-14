---
title: "Structural Solver"
last_validated: 2026-11-14
validated_against:
  - README.md
  - packages/solver-contract/src/index.ts
  - packages/solver-contract/README.md
  - apps/web/src/solver/unavailable.ts
  - apps/web/src/solver/voxel.js
  - services/opensees/README.md
owner: unknown
status: partial
---

# Structural Solver

The game intends to communicate load paths, instability, member or connection failure, and structural complexity. The workspace includes an experimental voxel-specific numerical analysis extracted from the standalone prototype. It uses metres and kN internally, frame and cable elements, multiple load combinations, regularization and simplified stability and design checks. It has not been independently validated and is not suitable for engineering design. It is not a shared `SolverAdapter`; the placeholder adapter still returns `unsupported`.

## Model and interface today

The preliminary shared TypeScript contract defines nodes with 3D positions, members joining node IDs, nodal supports and loads, and an asynchronous `SolverAdapter`. A model carries an `SI` label, but the exact units are not specified. Supports contain six restraint flags; loads contain force and moment vectors. A successful result contains six displacement values per node and warnings; other results report `unsupported` or `error` with a message. The interface accepts an optional abort signal, but cancellation behavior is not specified or demonstrated by a real adapter.

The project owner decided that a node has six potential degrees of freedom, in global translation X, Y, Z then rotation X, Y, Z order. Constraints may restrain them; this does not mean every element resists all six. The contract does not yet define the numerical interpretation of displacement rotations, element properties, connection behavior, load cases, or failure criteria.

## Modularity and candidate frameworks

The shared contract is the intended boundary between the game and interchangeable solver adapters. Adapters translate the common model to their backend and must explicitly report unsupported input; an adapter must not silently claim an analysis for features it cannot represent. The contract currently provides no capability discovery or detailed validation schema, so those remain design work.

OpenSees, a custom Rust solver, and a shared-contract TypeScript solver remain intended experiments, not implemented or selected solutions. The voxel JavaScript analysis is a separate game-specific experiment. The reserved `services/opensees` directory contains no service or endpoint. Possible evaluation approaches include a remote OpenSees service, a Rust implementation compiled for an appropriate runtime, and a TypeScript implementation; execution environment, integration, deployment, and supported features remain open. Compare candidates against the same agreed model semantics and reference cases before treating their results as interchangeable. Record unsupported features and numerical limitations for each adapter.

Before numerical implementation, decide exact units and coordinate/sign conventions; element and material properties; connectivity and releases; support and constraint semantics; load cases and combinations; analysis type; result quantities and conventions; stability diagnostics; and failure criteria. Establish how invalid models, unsupported features, solver errors, cancellation, and version or capability differences are communicated. The current types alone do not enforce these rules.

## Testing options to work through

These are proposed evaluation options, not existing solver tests or approved acceptance thresholds:

1. Define small analytical reference cases for each supported element and analysis type, including displacements, reactions, and internal forces where available. Examples could include an axial bar and a cantilever, once properties and conventions are fixed.
2. Exercise restraints and mechanisms, disconnected or malformed models, zero-length members, unsupported features, and singular systems. Decide which cases return validation errors, unsupported results, or instability diagnostics.
3. Check equilibrium and appropriate symmetry, scaling, and coordinate transformation properties. Specify absolute and relative tolerances with units and justify them per quantity and case.
4. Run the same compatible cases through candidate adapters and compare with analytical references or independently trusted benchmark results. Agreement between implementations alone does not establish correctness.
5. Test adapter translation, result mapping, error handling, and cancellation independently from backend numerical tests; add integration tests for any real service or runtime. Measure performance and deployment costs on representative models only after agreeing on comparable workloads.

Reference fixtures, benchmark sources, acceptance thresholds, and a first supported model subset remain to be chosen. See [development and testing](development-and-testing.md) for current commands and coverage.

