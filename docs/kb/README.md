---
title: "Knowledge Base"
last_validated: 2026-11-15
validated_against:
  - docs/kb/grow-dusk-runtime.md
  - README.md
  - package.json
  - docs/kb/architecture.md
  - docs/kb/unified-runtime.md
  - docs/kb/code-standards.md
  - docs/kb/analysis-results.md
  - docs/kb/structural-solver.md
  - docs/kb/rust-solver.md
  - docs/kb/voxel-retirement.md
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
  - docs/kb/cantilever-placement.md
owner: unknown
status: partial
---

# Knowledge Base

## Purpose and status

**Play** opens the versioned, two-player Grow Dusk match. New matches use `grow-dusk-release-2`, adding fixed source collars at a continuous frame's original quarter or midpoint; existing v1 matches keep their rules and card printings. More modes → Shared table exposes the same fresh cantilever preset alongside historical catalogues. Its turn worker uses in-browser Rust/WASM and commits `/match` through IndexedDB. The operating instructions and acceptance status are in the [release runtime](grow-dusk-runtime.md), [cantilever placement](cantilever-placement.md) and [criteria ledger](criteria-ledger.md). The playtest descriptions below document the preceding presets and secondary modes.

The secondary workspaces retain their playable presets, editor and earlier environment implementations. The editor can request linear or bounded nonlinear analysis through the OpenSees adapter. The [criteria ledger](criteria-ledger.md) records the current Shared table findings separately from the earlier preset walkthroughs.

## Pages

| Page | Use this when |
| --- | --- |
| [criteria-ledger.md](criteria-ledger.md) | Checking the audited game criteria, implementation assignments, accepted playtest decisions and release evidence. |
| [unified-runtime.md](unified-runtime.md) | Mapping the source environments, runtime entry points, features and remaining gaps. |
| [project.md](project.md) | Understanding the concept, status, and repository. |
| [architecture.md](architecture.md) | Understanding the three intended areas, current frameworks, and modular boundaries. |
| [code-standards.md](code-standards.md) | Applying TypeScript, folder structure, modularity, React, Zustand, and routing standards. |
| [structural-solver.md](structural-solver.md) | Working on the model, required element catalogue, the OpenSees service, stability assessment, adapter boundaries, or solver tests. |
| [rust-solver.md](rust-solver.md) | Working on the Rust WebAssembly solver: its coverage of the criteria, test evidence, timings, and open decisions. |
| [voxel-retirement.md](voxel-retirement.md) | Planning the proposed retirement of the voxel analysis: what depends on it, what the Rust solver and OpenSees can replace, and a migration order. |
| [element-representation-criteria.md](element-representation-criteria.md) | Generating lightweight column, spring, planar/trichord truss, wide-flange, HSS and cable geometry, with readable and true-scale views. |
| [analysis-results.md](analysis-results.md) | Persisting versioned solver runs, validity and result provenance. |
| [structural-state.md](structural-state.md) | Browser saves, experimental solver snapshots, and proposed general state and fixture design. |
| [structure-library.md](structure-library.md) | Loading and cycling 20 voxel specimens, PNG previews, SQLite records and observed solver baselines. |
| [solver-criteria.md](solver-criteria.md) | Reading the owner-supplied proposed solver requirements, acceptance gates, implementation order, and open gameplay decisions. |
| [solver-criteria-gap-analysis.md](solver-criteria-gap-analysis.md) | Comparing current code and tests with the criteria and planning implementation milestones. |
| [turn-criteria.md](turn-criteria.md) | Defining the two decks, turn phases, six-DOF connection cards, issue assessment and penalty decisions. |
| [game-completion-criteria.md](game-completion-criteria.md) | Entry point for eight completion specifications, confirmed decisions, proposals and implementation dependencies. |
| [scoring-match-criteria.md](scoring-match-criteria.md) | Defining fixed rounds, final-only load share minus penalties, outcome validity and ties. |
| [placement-criteria.md](placement-criteria.md) | Defining grid/diagonal placement, quarter attachments, clashes, assembly plays and external connections. |
| [cantilever-placement.md](cantilever-placement.md) | Building v2 fixed cantilevers and quarter/midpoint overhangs, preserving original source identity, and checking implementation limits and evidence. |
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
| [Load-path implementation prompt](../implementation-prompts/load-path-primary-direction.md) | Implementing primary-direction load-transfer vectors, with independent tension/compression styling. |
| [visualization-criteria.md](visualization-criteria.md) | Defining calculated deflected shape, load-path overlays, contours, force inspection and result validity. |
| [3d-viewer.md](3d-viewer.md) | Working on the 3D grid, interaction, or visual feedback. |
| [development-and-testing.md](development-and-testing.md) | Finding current setup, commands, and test coverage. |

## Completion rules and decisions

Start with [core game completion criteria](game-completion-criteria.md) for the eight specifications and decision register. The owner confirmed fixed rounds, final load-share percentage minus accumulated penalties, local hot-seat privacy, grid/diagonal and quarter-point attachments for all families, no physical clashes, one assembly card per element play, and retained structures repaired through additions. Check each family's physical and gameplay acceptance in the criteria ledger.

## Turn rules: source of truth

Start with [turn criteria](turn-criteria.md#1-status-and-confirmed-rules) for the owner's confirmed two-deck rules. The page includes the card families, six-DOF connection profile table, turn lifecycle, whole-structure issue comparison, 1-point penalty policy, a worked example, persistence requirements and acceptance scenarios.

The [completion decision register](game-completion-criteria.md#2-owner-confirmed-decision-register) specifies scoring, match format, placement and repair choices. The Shared table implements the card lifecycle and explicit attachments. Its versioned scored preset compares verified member/connector overload and witnessed instability on persistent physical IDs. Numerical tests and remaining validation gates are recorded in the [solver criteria](solver-criteria.md) and [criteria ledger](criteria-ledger.md).

## Animation and sound direction

[Animation and sound criteria](animation-criteria.md) record the owner-confirmed magical arena style: fast, subtle routine feedback with rare dramatic failure, major lead-change and victory moments. They cover all game actions, coordinated sound, optional structural glow/pulse and truthful structural visualization. Timing budgets, settings defaults and rollout details are proposals; this specification does not claim implementation.

## Avatar and preserved prototype

[Timburr avatar criteria](avatar-criteria.md) describe the compact companion and reactions. The active Grow Dusk playtest uses the two original attributed models preserved in the [prototype handoff](../../prototypes/timburr-companion/README.md), including a deliberately activated Conkeldurr preview and static portrait fallback. The models have no embedded animation clips. See [presentation acceptance](criteria-ledger.md#viewer-controls-and-presentation) for verified controls and remaining reactions.

## Joint freedoms and graphical representation

[Joint DOF criteria](joint-dof-criteria.md) record the owner-confirmed Selected joint / All joints / Off display (Selected default), global axes with local detail, brief optional demonstrations and a distinct solver-instability layer. All ends intentionally attached at one shared joint must now use matching freedoms, replacing earlier differing end-release choices there; foundations are fully fixed by default. Turn and solver criteria reflect the revision. The playtest enforces the law for fixed and ball profiles. Recovery identifies incompatible legacy attachments and preserves their source bytes. See the [implementation ledger](criteria-ledger.md) for overlay and elastic solver status.

## Structural element representation

[Element representation criteria](element-representation-criteria.md) require recognizable section/assembly geometry for the catalogue recorded in [structural solver](structural-solver.md#required-element-catalogue-and-geometry-direction). The owner confirmed planar two-chord trusses, triangular three-chord trusses, axial helical springs and slightly enlarged sections with true-scale inspection. Procedural geometry, LOD, numerical accuracy boundaries and acceptance fixtures are specified for future implementation; visual inclusion does not add playable cards or solver capabilities.

## Automatic correction and final fallback

In the scored frame preset, the game retains the player move and any originating deduction. It tries physical local reinforcement for verified instability and overload. Accepted props and neutral ground anchors persist, participate in equilibrium and earn no player attraction. Turn details identifies the local contact, checks, signed support redistribution and any pending issue after bounded attempts. The final award uses verified reactions divided by all applied card gravity. See the [repair policy](failure-repair-criteria.md#7-permanent-neutral-repairs-with-local-intervention), [decision register](game-completion-criteria.md#2-owner-confirmed-decision-register) and [tested match and remaining scope](criteria-ledger.md).

## Maintenance

- Validate facts against current code, configuration, tests, or explicitly identified project decisions; list sources in front matter.
- Update affected pages in the same change as durable behavior or decisions. Keep `last_validated` and `status` accurate.
- Use `current`, `partial`, `needs-review`, or `deprecated` for status. Record unanswered questions rather than guessing.
- Treat design intent as intent, not shipped functionality. Existing non-KB documents are context unless explicitly cited and validated.

## Frozen first-release product decisions

The owner delegated the remaining simplicity/quality decisions to Codex. Read the **Delegated first-release decisions — 2026-11-14** appendices in [completion](game-completion-criteria.md), [turns](turn-criteria.md), [cards](card-definition-criteria.md), [scoring](scoring-match-criteria.md), [placement](placement-criteria.md), [repair](failure-repair-criteria.md), [controls](controls-camera-criteria.md), [multiplayer](multiplayer-criteria.md), [saves](saved-match-criteria.md), [avatar](avatar-criteria.md), [animation](animation-criteria.md) and [release acceptance](release-acceptance-criteria.md).

They freeze `grow-dusk-release-1`: two players/eight rounds, finite authored decks, no opening hand or hand cap, end-turn assessment, above-ground player-built load targets, compact Timburr feedback, concrete presentation defaults, local recovery and a named platform/test matrix. They resolve earlier open product proposals without claiming implementation or weakening numerical criteria. In particular, load placement directly on setup supports is excluded in the new preset, and experimental multi-turn checkpoints are not its default. Preserve historical evidence and saves under their original ruleset versions.

## Complete-release implementation prompt

[Complete Grow Dusk release implementation prompt](../implementation-prompts/complete-grow-dusk-release.md) provides the implementation handoff for the frozen release decisions: criteria precedence, coordinated agents, integrated milestones, minimal UI, numerical verification, full-game tests and final review. It is an execution prompt, not evidence of completed implementation.
