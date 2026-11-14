---
title: "Structural Solver"
last_validated: 2026-11-14
validated_against:
  - README.md
  - packages/solver-contract/src/index.ts
  - apps/web/src/solver/unavailable.ts
owner: unknown
status: partial
---

# Structural Solver

The game intends to communicate load paths, instability, member or connection failure, and structural complexity. No structural solver is implemented. The web app has an adapter placeholder that reports analysis as unsupported.

The preliminary shared TypeScript contract describes nodes, members, supports, loads, an asynchronous adapter, and results. It is not yet sufficient for numerical analysis: exact units, member and material properties, load cases, constraints, result conventions, and failure criteria need decisions. Adapters must report unsupported input explicitly.

## Design decision: node degrees of freedom

The project owner decided that the structural model will use six potential degrees of freedom per node: translation along global X, Y, and Z, followed by rotation about those axes. Supports and other constraints may restrict them. This does not imply every element resists all six movements.

OpenSees, custom Rust, and TypeScript are intended solver experiments. Their accuracy, supported models, execution environments, and reference cases remain to be evaluated.
