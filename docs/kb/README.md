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

## Purpose and status

This is the canonical entry point for durable project knowledge. The early web prototype presents five environments in one application, with voxel editing, challenges, approximate numerical analysis, and a local Shared table card playtest. Shared table turns commit with experimental applied-load results where available. The OpenSees service implements the shared solver adapter for stability and degree-of-freedom checks. Distinguish implemented behavior from proposed experiments and future decisions.

## Pages

| Page | Use this when |
| --- | --- |
| [unified-runtime.md](unified-runtime.md) | Mapping the source environments, runtime entry points, features and remaining gaps. |
| [project.md](project.md) | Understanding the concept, status, and repository. |
| [architecture.md](architecture.md) | Understanding the three intended areas, current frameworks, and modular boundaries. |
| [code-standards.md](code-standards.md) | Applying TypeScript, folder structure, modularity, React, Zustand, and routing standards. |
| [structural-solver.md](structural-solver.md) | Working on the model, required element catalogue, the OpenSees service, stability assessment, adapter boundaries, or solver tests. |
| [element-representation-criteria.md](element-representation-criteria.md) | Generating lightweight column, spring, planar/trichord truss, wide-flange, HSS and cable geometry, with readable and true-scale views. |
| [structural-state.md](structural-state.md) | Browser saves, experimental solver snapshots, and proposed general state and fixture design. |
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

## Completion rules and decisions

Start with [core game completion criteria](game-completion-criteria.md) for the eight new specifications and decision register. The owner confirmed fixed rounds, final load-share percentage minus accumulated penalties, local hot-seat privacy, grid/diagonal and quarter-point attachments for all families, no physical clashes, one assembly card per element play, and retained structures repaired through additions. These supersede older contrary proposals; implementation and numerical acceptance remain pending.

## Turn rules: source of truth

Start with [turn criteria](turn-criteria.md#1-status-and-confirmed-rules) for the owner's confirmed two-deck rules. The page includes the card families, six-DOF connection profile table, turn lifecycle, whole-structure issue comparison, 1-point penalty policy, a worked example, persistence requirements and acceptance scenarios.

The confirmed decisions are distinct from the proposed connection presets and unresolved balance choices. [Questions still to resolve](turn-criteria.md#9-questions-still-to-resolve) tracks remaining parameters; the [completion decision register](game-completion-criteria.md#2-owner-confirmed-decision-register) now resolves the main scoring, match-format, placement and repair choices. The Shared table implements the card lifecycle and explicit attachments. Verified issue assessment and penalties remain pending. Later confirmed turn decisions supersede earlier gameplay proposals in the solver criteria; numerical solver requirements remain in [solver criteria](solver-criteria.md).

## Animation and sound direction

[Animation and sound criteria](animation-criteria.md) record the owner-confirmed magical arena style: fast, subtle routine feedback with rare dramatic failure, major lead-change and victory moments. They cover all game actions, coordinated sound, optional structural glow/pulse and truthful structural visualization. Timing budgets, settings defaults and rollout details are proposals; this specification does not claim implementation.

## Avatar direction and deferred prototype

[Timburr avatar criteria](avatar-criteria.md) are the source of truth for the owner’s criteria-first avatar work: a small companion across screens, expanding for important reactions, with a proposed temporary Conkeldurr foreman mode. The avatar is not implemented in the active app. [Prototype handoff](../../prototypes/timburr-companion/README.md) preserves an unapplied code/asset patch and its known gaps for a future Codex/Claude run. Review the criteria before reusing it; experimental analysis must not trigger a verified-failure reaction.

## Joint freedoms and graphical representation

[Joint DOF criteria](joint-dof-criteria.md) record the owner-confirmed Selected joint / All joints / Off display (Selected default), global axes with local detail, brief optional demonstrations and a distinct solver-instability layer. All ends intentionally attached at one shared joint must now use matching freedoms, replacing earlier differing end-release choices there; foundations are fully fixed by default. Turn and solver criteria reflect the revision. Overlay rendering, rule enforcement and legacy migration are future implementation work.

## Structural element representation

[Element representation criteria](element-representation-criteria.md) require recognizable section/assembly geometry for the catalogue recorded in [structural solver](structural-solver.md#required-element-catalogue-and-geometry-direction). The owner confirmed planar two-chord trusses, triangular three-chord trusses, axial helical springs and slightly enlarged sections with true-scale inspection. Procedural geometry, LOD, numerical accuracy boundaries and acceptance fixtures are specified for future implementation; visual inclusion does not add playable cards or solver capabilities.

## Automatic correction and final fallback

Later owner decisions confirm historical penalties remain after repair, matching freedom states/physical axes may have different elastic stiffnesses, and final attraction awards use verified components against total applied gravity with zero award for unknown contributions. Player moves are retained while the program applies recorded game-owned repairs for instability and overload, explained by Timburr. See [issue correction](failure-repair-criteria.md#6-automatic-correction-transaction) and the [decision register](game-completion-criteria.md#2-owner-confirmed-decision-register). The owner confirmed permanent neutral scaffolding/ground anchors with no player attraction award and local direct intervention; whole-structure effects are still reanalyzed. See the [local repair policy](failure-repair-criteria.md#7-permanent-neutral-repairs-with-local-intervention). These are requirements, not implemented correction or a promise of stable equilibrium for every arbitrary input.

## Maintenance

- Validate facts against current code, configuration, tests, or explicitly identified project decisions; list sources in front matter.
- Update affected pages in the same change as durable behavior or decisions. Keep `last_validated` and `status` accurate.
- Use `current`, `partial`, `needs-review`, or `deprecated` for status. Record unanswered questions rather than guessing.
- Treat design intent as intent, not shipped functionality. Existing non-KB documents are context unless explicitly cited and validated.
