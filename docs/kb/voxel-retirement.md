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
  - apps/web/src/game/turns.ts
  - apps/web/src/game/turnEngine.test.ts
  - apps/web/src/main.tsx
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

**Status: done for all new analysis; the kernel is kept only to replay old saves.** On 2026-11-14 the project owner said the voxel analysis would probably be fully retired, with the [Rust solver](rust-solver.md) and the OpenSees service as the selectable backends. Since 2026-11-15 the game logic lives in a structure evaluator. Everything that analyses a structure now uses the Rust solver: the editor, levels, auto-design, the structure library, the release and new Shared table playtest matches. On 2026-11-15 the owner chose to move the older playtest card sets to Rust rather than retire them. The legacy TypeScript kernel remains only so that playtest matches saved before that change still replay.

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
| Shared table playtest card sets (frame, hollow, planar, trusses, springs, joints, cables, legacy), new matches | Rust, the same adapter as the release, with member self-weight in ordinary previews. Recorded as `engine: "rust-1"` in the match and its save. |
| Shared table playtest matches saved before 2026-11-15 (no `engine` field) | Legacy voxel kernel, so their saved issue, penalty and repair evidence reproduces on replay |

## How the Rust engine replaces each voxel feature

| Voxel feature | Now |
| --- | --- |
| Four ultimate and serviceability combinations with wind, partial factors and notional sway | `designLoadCase` builds the same actions as Rust load cases. Self-weight and member wind stay distributed; lumped to the nodes, their totals equal the kernel's loads (tested). Notional sway is 1/200 of vertical load per metre of self-weight and per node of variable load. |
| P-Δ amplification `1/(1 − 1/α)` | Not needed: the analysis is geometrically nonlinear, so second-order moments are in the cut forces. |
| Member demand with end-force corrections for self-weight | The station envelope of Rust's cut forces (two elements per member). |
| Serviceability deflection estimate | Rust's chord sag per member (`deflection.maxFromChord`). |
| Global buckling factor α_cr (linear screen, one element per member) | Rust's linearised stability reserve about each verified ultimate state (`reserveMethod: "linearized"`, cap 128). With two elements per member it includes a strut buckling between its ends. |
| Mechanism detection | Rust's first-order mechanism flag, reported even when nonlinear recovery cannot also prove it. |
| Objectives, stars, design checks, joint and foundation capacity, auto-design | Unchanged evaluator code on the Rust response, except that the member buckling reduction χ was removed (see owner decisions). Auto-design now only upsizes after its first round, so it settles under second-order redistribution. |
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

## Shared table playtest matches

Replaying a saved playtest match re-runs each turn's assessment and rejects the save if issues, penalties or repairs differ (`endTurn` in `game/turns.ts`). Only the final award is read from the save without re-solving. Switching these card sets to Rust outright would therefore have made every existing save unloadable. Instead, each match records its engine (`TurnState.engine`, saved in the session header):

- New matches use `rust-1` and analyse on the Rust turn adapter (`evaluator/engine/releaseTurn.ts`). It now accepts member self-weight for ordinary previews, the card pretension for cables printed without a rest length, and the card stiffness for older springs. Release requests are byte-identical.
- Saves without the field replay on the kernel, with their original `voxel-linear-frame-v1` / `voxel-cable-frame-v1` evidence. An unknown engine is rejected. Relabelling a Rust save as legacy does not reproduce (tested).
- Score receipts name the Rust solver for Rust matches. Archived turn evidence records `dof-rust`, `geometric-nonlinear-static`.
- The store replays a saved match synchronously when it loads, so `main.tsx` instantiates the WASM before importing the app. The vitest setup does the same.

What changed in results, with the evidence in the tests:

- Quarter-connected frames and the foundation-uplift split now match closed forms that include shear deformation (Timoshenko) within 1e-4; voxel ignored shear.
- Cable transfers match the independent force-method reference (`docs/evidence/cable/reference.py`) within 1e-8.
- Two values with no independent reference were re-pinned as observed: the reloaded cable match (3.0235 kN, previously 2.9996) and the collared spring (0.0452 kN, previously 0.0438).
- A grossly overloaded assembly that deforms excessively is now reported as overloaded (utilisation about 59), where voxel withheld its capacity as outside its linear envelope.
- An unloaded slender column's capacity is verified at zero actions, where voxel withheld it because a linear response needs α_cr ≥ 10.

A small 16-turn Rust match plays in about 27 ms and replays in about 13 ms in Node. In Chromium, a cables-set match recorded `"engine":"rust-1"` in its save and restored after a page reload.

## Owner decisions, 2026-11-15

- **Older playtest card sets: move to Rust** (above).
- **Member buckling check (χ): removed.** Solver criterion A02 requires the analysis itself to include member P-δ, with enough discretisation for member buckling. The nonlinear Rust analysis does, so χ counted buckling twice. The slenderness limit stays, as a detailing rule. Only the roof grid's library utilisation changed (0.6721 to 0.6717).
- **Level thresholds and stars: unchanged.** Stars depend on passing every objective and on cost against budget, not on α_cr. α_cr only feeds the "α_cr ≥ 1" objective and a warning below 10. Buckling below the applied load already fails the nonlinear ultimate solve, so the lower values show as warnings and change no outcome.
- **α_cr method: linearised.** The solver criteria require verified critical buckling loads within 2 % (met on the Euler and sway-portal tests) and defer post-buckling path tracing, which is what the `path` method adds.

## Remaining work

1. **OpenSees as an evaluator engine.** Not done. OpenSees still has one steel section and no member loads, self-weight or strength results, so it remains the structural check only.
2. **Delete the kernel** (`solver/voxel/`) only if replaying pre-migration playtest saves is no longer needed. Without it, those saves would fail to load. Its only remaining importer is `game/turnAnalysis.ts`.

This page was written by an AI agent from the code and the measurements recorded above.
