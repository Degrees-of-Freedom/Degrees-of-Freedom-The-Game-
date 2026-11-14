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
  - docs/kb/solver-criteria.md
  - docs/kb/turn-criteria.md
  - docs/kb/solver-criteria-gap-analysis.md
  - docs/kb/development-and-testing.md
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
| [structural-solver.md](structural-solver.md) | Working on the model, the OpenSees service, stability assessment, adapter boundaries, or solver tests. |
| [structural-state.md](structural-state.md) | Browser saves, experimental solver snapshots, and proposed general state and fixture design. |
| [solver-criteria.md](solver-criteria.md) | Reading the owner-supplied proposed solver requirements, acceptance gates, implementation order, and open gameplay decisions. |
| [solver-criteria-gap-analysis.md](solver-criteria-gap-analysis.md) | Comparing current code and tests with the criteria and planning implementation milestones. |
| [turn-criteria.md](turn-criteria.md) | Defining the two decks, turn phases, six-DOF connection cards, issue assessment and penalty decisions. |
| [game-dynamics.md](game-dynamics.md) | Working on game state, turns, rules, or modes. |
| [3d-viewer.md](3d-viewer.md) | Working on the 3D grid, interaction, or visual feedback. |
| [development-and-testing.md](development-and-testing.md) | Finding current setup, commands, and test coverage. |

## Turn rules: source of truth

Start with [turn criteria](turn-criteria.md#1-status-and-confirmed-rules) for the owner's confirmed two-deck rules. The page includes the card families, six-DOF connection profile table, turn lifecycle, whole-structure issue comparison, 1-point penalty policy, a worked example, persistence requirements and acceptance scenarios.

The confirmed decisions are distinct from the proposed connection presets and unresolved balance choices. [Questions still to resolve](turn-criteria.md#9-questions-still-to-resolve) tracks opening hands, deck balance, load magnitudes, placement limits, scoring and match endings. The Shared table implements the card lifecycle and explicit attachments. Verified issue assessment and penalties remain pending. Later confirmed turn decisions supersede earlier gameplay proposals in the solver criteria; numerical solver requirements remain in [solver criteria](solver-criteria.md).

## Maintenance

- Validate facts against current code, configuration, tests, or explicitly identified project decisions; list sources in front matter.
- Update affected pages in the same change as durable behavior or decisions. Keep `last_validated` and `status` accurate.
- Use `current`, `partial`, `needs-review`, or `deprecated` for status. Record unanswered questions rather than guessing.
- Treat design intent as intent, not shipped functionality. Existing non-KB documents are context unless explicitly cited and validated.

