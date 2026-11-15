---
title: "Retiring the Voxel Analysis"
last_validated: 2026-11-14
validated_against:
  - apps/web/src/game/analysis.ts
  - apps/web/src/game/turnAnalysis.ts
  - apps/web/src/game/turnEvidence.ts
  - apps/web/src/game/turns.ts
  - apps/web/src/game/modes.ts
  - apps/web/src/game/structuralState.ts
  - apps/web/src/game/analysisModel.ts
  - apps/web/src/game/structuralModel.ts
  - apps/web/src/components/AnalysisPanel.tsx
  - apps/web/src/components/environment/EngineeringOptions.tsx
  - apps/web/src/components/RuntimeControls.tsx
  - apps/web/src/viewer
  - apps/web/src/solver/voxelResults.ts
  - apps/web/src/solver/voxelLoads.ts
  - apps/web/src/solver/voxelObjectives.ts
  - apps/web/src/solver/voxelSizing.ts
  - apps/web/src/solver/voxelDesignChecks.ts
  - apps/web/src/solver/loadPath.ts
  - apps/web/src/solver/structuralOpenSees.ts
  - packages/solver-contract/src/analysis.ts
owner: unknown
status: needs-review
---

# Retiring the Voxel Analysis

**Status: proposal.** The project owner said on 2026-11-14 that the voxel analysis is probably going to be fully retired, with the [Rust solver](rust-solver.md) and the OpenSees service as the selectable backends. That is not yet a decision, and nothing below is implemented. This page records what the voxel analysis does for the game today, what each replacement can supply, and an order in which it could be removed.

The voxel analysis is the TypeScript frame analysis in `apps/web/src/solver/voxel*.ts` and `frame*.ts`, reached through `analyzeGame` and `autoDesignGame` in `game/analysis.ts` and `analyzeTurn` in `game/turnAnalysis.ts`. Its result type is `VoxelAnalysis` in `solver/voxelResults.ts`.

## What uses it today

| Area | Consumer | What it reads |
| --- | --- | --- |
| Workspace | `pages/Workspace.tsx` `run()` | Calls `analyzeTurn` on the Shared table and `analyzeGame` elsewhere; passes the result to the scene and the analysis panel. |
| Objectives | `game/modes.ts` `modeProgress` | `error`, `mechanism`, `floating`, `success`: forensics completion and the Grow hint. |
| Results panel | `components/AnalysisPanel.tsx` | Verdict and stars, objectives, mass, per-combination maximum displacement and reactions, utilisation and governing check per member, end forces, the load-case selector, load-path shares. |
| Auto-design | `components/environment/EngineeringOptions.tsx` | `autoDesignGame`: a resized model and its analysis. |
| Viewer | `viewer/sceneResults.ts`, `structureMeshes.ts`, `scenePicking.ts`, `solver/loadPath.ts`, `flowParticles.ts` | Deformed shape, load and reaction arrows (gravity and wind), utilisation and mechanism colours, member tooltips, load-path particles. |
| Shared table | `game/turnAnalysis.ts`, `game/turnEvidence.ts`, `store.ts` `endTurn` | Status classification and the foundation reactions recorded with each committed turn, under solver id `voxel-playtest`. Penalties are not computed (`penalty: 0` in `turns.ts`). |
| Card data | `game/analysisModel.ts`, `game/turnEvidence.ts`, `game/structuralState.ts` | Import the section catalogue `ITEMS` and grid size `S` from `solver/voxelSections.ts`. |

`ModeObjective` in `components/RuntimeControls.tsx` also reads `modeProgress` but has no caller.

## What each replacement can supply

The Rust solver returns the detailed result in `packages/solver-contract/src/analysis.ts`. OpenSees returns the original contract result in `packages/solver-contract/src/index.ts`.

| Need | Rust solver | OpenSees service |
| --- | --- | --- |
| Verdict: mechanism, unsupported part, error | Per-component status, flags and reasons; mapping only | Stability report; whole model only |
| Deformed shape, largest movement | Node displacements and rotations | Node displacements |
| Reactions | Six signed components per foundation | Six components per support |
| Utilisation and governing check | Section strength per member and connection | None |
| Member end forces | `[N, Vy, Vz, T, My, Mz]` in local axes | Axial (signed), shear, torsion and end moments as magnitudes |
| Slack cables | Yes | No: cables are two-way ties |
| Self-weight, card sections, uniform member loads | Yes | No: one steel section, no member loads |
| Level loads (tower payload, bridge traffic) | Yes | No: the original translation sends placed point loads only |
| Load combinations, wind, partial factors, notional loads | **Partly.** Several load cases per call (`analyzeCases`), each factored by its own load factor and gravity; enveloping, wind and notional loads would be game code | No |
| Member buckling factor, slenderness, deflection limit | Buckling appears as instability instead. Member deflection is reported at each element boundary, with the sag from the chord; the limit check itself would be game code | No |
| Joint and foundation capacities | Connection capacities exist in the contract but the game sends none; foundation capacity would be a TypeScript check on reactions | No |
| Auto-design | Possible as a loop over Rust results; not written | No |

A player who chooses OpenSees loses everything the voxel analysis adds beyond kinematic stability, displacements and reactions. The stored-analysis flow in `solver/structuralOpenSees.ts` also rejects self-weight and pretensioned members, so it cannot record Shared table turns, which use both.

## Features with no replacement yet

- **Load combinations and wind.** The voxel analysis runs four combinations (ultimate and serviceability, wind along X and Y) with partial factors and notional loads (`solver/voxelLoads.ts`). The serviceability objectives, star ratings and auto-design all depend on them.
- **Auto-design** (`solver/voxelSizing.ts`).
- **Objectives, success and stars** (`solver/voxelObjectives.ts`). Height, deck continuity, cost and mass are geometry and can move to game code; drift and deflection limits need serviceability results.
- **Load-path visualisation**, which is typed on `VoxelAnalysis`.
- **Shared table evidence.** Saved matches embed analysis results and replay validates them without re-running a solver, so old matches stay loadable after the voxel code is deleted. A new solver must keep the same status mapping.

Saved structures (`dof-voxel-save` v1) store only the model, so no results need migrating.

## Proposed order

Each step can ship on its own.

1. **A neutral game-analysis type** (verdict flags, displacements, member utilisation and forces, reactions, load vectors, load cases), with a voxel adapter. Move the panel, viewer, load path and objectives onto it. No behaviour change.
2. **A Rust adapter to that type**, so the viewer and panel show the selected backend's results. Results will differ visibly: the 3D analysis with pinned connections reports mechanisms the voxel analysis does not.
3. **An OpenSees adapter**, showing what it cannot supply as unavailable, and adding level loads to its translation.
4. **Move shared code out of `solver/`**: the section catalogue and grid size into game card data; cost, mass and geometric objectives into game code; foundation and connection capacity checks.
5. **Load combinations**: build each combination as a load case and send them in one `analyzeCases` call, then envelope the results in TypeScript. Each case is still a full solve, so four combinations cost about four times one analysis.
6. **Objectives and stars** on the neutral type, with levels re-tuned.
7. **Auto-design** on the Rust solver, or retire the feature.
8. **Shared table** turns through the Rust solver, keeping the recorded status mapping.
9. **Replace the voxel tests** (`solver/voxel.test.ts`, `loadPath.test.ts`, `restraints.test.ts`, `frameMath.test.ts`, `game/analysis.test.ts`, `creativeControls.test.ts`, `modeSimulation.test.ts`, `runtime.test.ts`, `structuralState.test.ts`, `turnAnalysis.test.ts`, `turnEvidence.test.ts`, `structureLibrary.test.ts` and its baseline `public/structures/voxel-baseline.json`).
10. **Delete** `solver/voxel*.ts`, `frame*.ts`, `game/analysis.ts` and the voxel snapshot code, and update the knowledge base.

Steps 1, 2, 4, 8 and 9 must come before the deletion; steps 5 to 7 must be done or explicitly dropped.

## Decisions needed

- Whether the voxel analysis is retired, and whether OpenSees must reach feature parity or stays a reduced check.
- Whether load combinations and wind stay in the game.
- Whether a member buckling factor and slenderness limit are still wanted when the analysis is nonlinear and reports buckling directly.
- Whether auto-design survives.
- How levels and star thresholds are re-tuned when results change.

This page was written from a read of the code by an AI agent, spot-checked against the sources listed above.
