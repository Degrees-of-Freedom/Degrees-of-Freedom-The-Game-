---
title: "Retiring the Voxel Analysis"
last_validated: 2026-11-15
validated_against:
  - apps/web/src/evaluator
  - apps/web/src/evaluator/engine/rustDesign.ts
  - apps/web/src/evaluator/engine/rustDesign.test.ts
  - apps/web/src/evaluator/engine/releaseTurn.ts
  - apps/web/src/game/analysis.ts
  - apps/web/src/game/turnAnalysis.ts
  - apps/web/src/solver/voxel
  - apps/web/src/pages/Workspace.tsx
  - apps/web/src/components/environment/EngineeringOptions.tsx
  - apps/web/public/structures/evaluator-baseline.json
  - crates/dof-solver/src/solve.rs
  - crates/dof-solver/tests/reserve.rs
  - crates/dof-solver/README.md
  - packages/solver-contract/src/analysis.ts
owner: unknown
status: partial
---

# Retiring the Voxel Analysis

**Status: mostly done; the kernel is not deleted.** On 2026-11-14 the project owner said the voxel analysis would probably be fully retired, with the [Rust solver](rust-solver.md) and the OpenSees service as the selectable backends. Since 2026-11-15 the game logic lives in a structure evaluator and the editor runs on the Rust solver. The legacy TypeScript kernel remains only for older Shared table catalogues. Whether to delete it, and with it those catalogues' live analysis, is an open owner decision (see below).

## What changed

The old `solver/voxel*.ts` modules mixed game-level evaluation with a linear frame kernel. They are now split:

- **`apps/web/src/evaluator/`: the structure evaluator.**
  - Model and level inputs (`EvaluatorModel`, `EvaluatorLevel`) and card sections.
  - Stiffness-free geometry and components (`geometry.ts`).
  - Load combinations (`loads.ts`).
  - Design checks, objectives and stars, auto-design (`sizing.ts`) and card capacity.
  - Evidence policy (`evidence.ts`) and the load path.
  - The result type `StructureEvaluation` (`results.ts`), which the panel, viewer and load path read.
  - Engines in `engine/`.
- **`apps/web/src/solver/voxel/`: the legacy kernel.** Frame and cable stiffness, linear solve, buckling screen and linear verification. Its types extend the evaluator's geometry types, and nothing under `evaluator/` imports it.

| Consumer | Engine now |
| --- | --- |
| Editor and levels (`analyzeGame`), structure library, auto-design (`autoDesignGame`) | Rust, `evaluator/engine/rustDesign.ts`, on the worker-backed `wasmSolver` |
| Scored release match (`grow-dusk-release-1`) | Rust, `evaluator/engine/releaseTurn.ts` (already before this change) |
| Older Shared table catalogues (`analyzeTurn` for other catalogues), with their repair, issue and penalty helpers | Legacy voxel kernel |

## How the Rust engine replaces each voxel feature

| Voxel feature | Now |
| --- | --- |
| Four ultimate and serviceability combinations with wind, partial factors and notional sway | `designLoadCase` builds the same actions as Rust load cases. Self-weight and member wind stay distributed; lumped to the nodes, their totals equal the kernel's loads (tested). Notional sway is 1/200 of vertical load per metre of self-weight and per node of variable load. |
| P-Δ amplification `1/(1 − 1/α)` | Not needed: the analysis is geometrically nonlinear, so second-order moments are in the cut forces. |
| Member demand with end-force corrections for self-weight | The station envelope of Rust's cut forces (two elements per member). |
| Serviceability deflection estimate | Rust's chord sag per member (`deflection.maxFromChord`). |
| Global buckling factor α_cr (linear screen, one element per member) | Rust's linearised stability reserve about each verified ultimate state (`reserveMethod: "linearized"`, cap 128). With two elements per member it includes a strut buckling between its ends. |
| Mechanism detection | Rust's first-order mechanism flag, reported even when nonlinear recovery cannot also prove it. |
| Objectives, stars, design checks, joint and foundation capacity, auto-design | Unchanged evaluator code on the Rust response. Auto-design now only upsizes after its first round, so it settles under second-order redistribution. |
| Load-path visualisation, overlays | Unchanged; they read `StructureEvaluation`. |

### What the Rust solver gained

`options.reserveSearch` reports a stability reserve for a stable or marginal nonlinear component. Before, the solver only bisected for a critical load *below* the applied load. There are two methods. `path` continues the nonlinear equilibrium and also finds limit points; each increment may move no node more than 1 % of the component size, so it cannot jump across a snap-through. `linearized` extrapolates the verified tangent along the path. The field is emitted only when requested. The rebuilt module reproduces all 20 archived release browser matches and 660 confirmed records (`node scripts/physics/check-saved-solver.mjs 39508f0`). See the [crate README](../../crates/dof-solver/README.md) and `crates/dof-solver/tests/reserve.rs`.

## Evidence and differences from the voxel results

On the three level references (tower, bridge, pick-up), success, stars, maximum utilisation and foundation utilisation are the same as with voxel. The Rust run of the ultimate combinations takes 40–190 ms in Node. In Chromium the first run took about 2 s, including module download and worker start-up, and later runs about 0.65 s alongside the structural check.

The buckling factor differs. Voxel reported α_cr > 128 on all three references. Rust reports 4.0, 3.0 and 1.9. For the bridge and pick-up, these equal the hand Euler load of the critical pin-ended strut divided by its ultimate compression (3.02 and 1.89); `rustDesign.test.ts` checks this within 2 %. The voxel screen could not see a strut buckling between its ends. All three references still pass, with α_cr shown as a warning below 10.

In the [structure library](structure-library.md), 18 of 20 specimens keep their voxel stability verdict. Maximum utilisation:

- Equal on 11 specimens.
- Within 2 % on three (07, 16, 18).
- Higher on two: 08 space frame and 11 unbraced tower, from 0.28 to 0.42.

Two specimens are reclassified, and the mechanism is unchanged:

- **02 slender column.** Voxel's own α_cr was 0.25. Rust finds that it buckles (factor 0.37 under the governing combination). It is now reported as buckling, not as a passing column.
- **03 cantilever.** The 8 m IPE 300 arm buckles laterally-torsionally at about 9 kN at the tip (4.013 √(EI_z GJ)/L², Saint-Venant torsion). The factored loads pass that, so no equilibrium is found beyond 31 % of the load, and the evaluator explains this as likely buckling. The voxel kernel could not represent lateral-torsional buckling.
- **05 released portal.** Still a mechanism.

Several α_cr values are lower than voxel's (for example 04 rigid portal: 2.2 against 7.5; the path method agrees at 2.23). The new observed baseline is `public/structures/evaluator-baseline.json`.

The linearised reserve is an estimate. Against the path method it agrees within about 1 % on four specimens, is lower on five (by up to 10× on the very flexible roof grid, whose path stiffens), and is higher on the guyed mast (110 against 75). Code-style α_cr is a linearised quantity, and the nonlinear ultimate solve independently catches buckling below the applied load.

## Remaining work

1. **Older Shared table catalogues.** They still analyse with the kernel and record `voxel-linear-frame-v1` / `voxel-cable-frame-v1` evidence; replay validates saved evidence without re-running a solver. Moving them to Rust changes their results and evidence formulation. Their helpers (`turnRepair.ts`, `turnIssues.ts`, `turns.ts` scoring for non-release catalogues) and tests (`turnAnalysis`, `turnEvidence`, `supportResponse`, `spring`, `planar`, `trichord`, `cablePorts`, `structuralState`, `runtime`) assume linear-kernel numbers.
2. **OpenSees as an evaluator engine.** Not done. OpenSees still has one steel section and no member loads, self-weight or strength results, so it remains the structural check only.
3. **Delete the kernel** (`solver/voxel/`) once item 1 is decided, and update the knowledge base.

## Decisions needed

- Retire the older Shared table catalogues, keep them on the kernel, or move them to Rust with new evidence.
- Whether a member buckling check (χ) is still wanted now that the analysis reports buckling directly. It is kept for now and may double-count with the nonlinear analysis.
- How levels and star thresholds should be re-tuned for the lower α_cr. The thresholds are unchanged, and the three references still pass.
- Whether α_cr should use the slower `path` method for exact nonlinear reserves (about 2.4 s per ultimate combination on the bridge reference).

This page was written by an AI agent from the code and the measurements recorded above.
