---
title: "Knowledge Base"
last_validated: 2026-11-14
validated_against:
  - README.md
  - package.json
  - docs/kb/architecture.md
  - docs/kb/unified-runtime.md
  - docs/kb/code-standards.md
  - docs/kb/structural-solver.md
  - docs/kb/element-representation-criteria.md
  - docs/kb/solver-criteria.md
  - docs/kb/turn-criteria.md
  - docs/kb/game-completion-criteria.md
  - docs/kb/joint-dof-criteria.md
  - docs/kb/animation-criteria.md
  - docs/kb/avatar-criteria.md
  - prototypes/timburr-companion/README.md
  - docs/kb/solver-criteria-gap-analysis.md
  - docs/kb/development-and-testing.md
  - docs/kb/visualization-criteria.md
owner: unknown
status: partial
---

# Knowledge Base

## Current requirements and implementation status

**Read [multiplayer simplification — current criteria](multiplayer-refresh-criteria.md) first.** This newest owner revision supersedes conflicting older rules: multiplayer only, four source-selectable draws, any held-card plays, configurable default three-global-turn checkpoints, 15×15 field, 5/7/10 maximum lengths, one axial/bending member/cable/two k₀ springs, three rotation-only connector types, immutable default foundation/column, no extra foundations or downward correction columns, minimum local safety constraints, inspector/cursor refinements, active roaming avatar, correct axial vectors and quit anytime.

These are criteria, not a claim that current code implements them. Existing runtime/backend descriptions are preserved as facts; older broad catalogue/mode/repair requirements are historical where they conflict. [Core criteria hub](game-completion-criteria.md) routes the domains. [Four separate implementation-session prompts](../implementation-prompts/README.md) provide ordered handoffs; no sessions are spawned and no runtime implementation is performed by this documentation change.

## Pages

| Page | Use this when |
| --- | --- |
| [multiplayer-refresh-criteria.md](multiplayer-refresh-criteria.md) | Latest multiplayer-only rules, checkpoint cadence, minimal correction, current cards and presentation. |
| [Implementation prompts](../implementation-prompts/README.md) | Four ordered, separate Codex/Claude session briefs and handoff contracts. |
| [criteria-ledger.md](criteria-ledger.md) | Implementation-branch evidence and earlier playtest scope; latest MR criteria take precedence as target requirements. |
| [unified-runtime.md](unified-runtime.md) | Mapping the source environments, runtime entry points, features and remaining gaps. |
| [project.md](project.md) | Understanding the concept, status, and repository. |
| [architecture.md](architecture.md) | Understanding the three intended areas, current frameworks, and modular boundaries. |
| [code-standards.md](code-standards.md) | Applying TypeScript, folder structure, modularity, React, Zustand, and routing standards. |
| [structural-solver.md](structural-solver.md) | Working on the model, required element catalogue, the OpenSees service, stability assessment, adapter boundaries, or solver tests. |
| [element-representation-criteria.md](element-representation-criteria.md) | Generating the standard member, cable and two endpoint-coil spring variants, with readable/true-scale views. |
| [structural-state.md](structural-state.md) | Browser saves, experimental solver snapshots, and proposed general state and fixture design. |
| [structure-library.md](structure-library.md) | Loading and cycling 20 voxel specimens, PNG previews, SQLite records and observed solver baselines. |
| [solver-criteria.md](solver-criteria.md) | Reading the owner-supplied proposed solver requirements, acceptance gates, implementation order, and open gameplay decisions. |
| [solver-criteria-gap-analysis.md](solver-criteria-gap-analysis.md) | Comparing current code and tests with the criteria and planning implementation milestones. |
| [turn-criteria.md](turn-criteria.md) | Defining the two decks, turn phases, six-DOF connection cards, issue assessment and penalty decisions. |
| [game-completion-criteria.md](game-completion-criteria.md) | Entry point for eight completion specifications, confirmed decisions, proposals and implementation dependencies. |
| [scoring-match-criteria.md](scoring-match-criteria.md) | Defining fixed rounds, final-only load share minus penalties, outcome validity and ties. |
| [placement-criteria.md](placement-criteria.md) | Defining grid/diagonal placement, quarter attachments, clashes, assembly plays and external connections. |
| [card-definition-criteria.md](card-definition-criteria.md) | Authoring versioned physical properties, spring/assembly/cable laws, catalogue capabilities and decks. |
| [failure-repair-criteria.md](failure-repair-criteria.md) | Assessing verified issues, recording one-point penalties, retaining geometry and clearly reporting repair. |
| [controls-camera-criteria.md](controls-camera-criteria.md) | Specifying mouse/keyboard/touch workflows, precision targeting, camera behavior and accessibility. |
| [multiplayer-criteria.md](multiplayer-criteria.md) | Specifying first-release local hot-seat, private handoff, information visibility and future authority boundaries. |
| [saved-match-criteria.md](saved-match-criteria.md) | Saving/recovering complete matches, atomic commits, replay, migration and private exports. |
| [release-acceptance-criteria.md](release-acceptance-criteria.md) | Validating a complete playable match with evidence, numerical/performance gates and supported scope. |
| [game-dynamics.md](game-dynamics.md) | Working on game state, turns, rules, or modes. |
| [avatar-criteria.md](avatar-criteria.md) | Defining Timburr’s personality, compact presence, reactions, Conkeldurr transformation, model sources and deferred implementation handoff. |
| [animation-criteria.md](animation-criteria.md) | Defining all-action animation and sound requirements, optional structural glow/pulse, accessibility, timing and acceptance scenarios. |
| [joint-dof-criteria.md](joint-dof-criteria.md) | Defining translation/twist glyphs, global/local views, shared-joint freedoms, foundation defaults and the separate instability overlay. |
| [visualization-criteria.md](visualization-criteria.md) | Defining calculated deflected shape, load-path overlays, contours, force inspection and result validity. |
| [3d-viewer.md](3d-viewer.md) | Working on the 3D grid, interaction, or visual feedback. |
| [development-and-testing.md](development-and-testing.md) | Finding current setup, commands, and test coverage. |

## Criteria precedence and outstanding parameters

The current MR01–MR19 register is authoritative. Earlier G-series decisions are retained only in [historical context](history/pre-refresh-game-decisions.md). Numerical truth, final-only adjusted share scoring, privacy, quarter attachments, no material clashes and recoverable saves remain unless explicitly revised. Actual k₀/member/capacity values, height, interval bounds, tolerance/budgets and deck/exhaustion/tie policies remain clearly authored parameters, not permission to restore old restrictions.

## Maintenance

- Keep current requirements distinct from actual runtime/backend behavior and historical tests.
- Link changed rules to the current revision and record pass/fail evidence for later implementation.
- Do not present archived prototypes, screenshots or pending numerical work as accepted features.

## Implementation branch status

This criteria-only integration preserves the runtime at implementation commit `633887d`, including its owner-requested pause and unfinished workstreams. See [criteria ledger](criteria-ledger.md) for implementation evidence. The new target criteria do not revert or reimplement that code and do not claim its existing frame/quarter-attachment/scoring work is absent. Previously recorded evidence remains in Git history at that commit and in the ledger; future implementation must reconcile it with the MR01–MR19 target rather than overwrite it.
