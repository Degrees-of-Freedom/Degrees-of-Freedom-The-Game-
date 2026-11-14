---
title: "Knowledge Base"
last_validated: 2026-11-14
validated_against:
  - README.md
  - package.json
  - docs/kb/architecture.md
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

This is the canonical entry point for durable project knowledge. The game remains at the concept stage with an initial web scaffold. The workspace includes experimental voxel building, challenges, and approximate numerical analysis alongside a preliminary shared solver contract and unavailable-solver placeholder. It does not implement a turn system, and the voxel analysis is not an implementation of the shared adapter. Distinguish documented intent and proposed experiments from implemented behavior and decisions.

## Pages

| Page | Use this when |
| --- | --- |
| [project.md](project.md) | Understanding the concept, status, and repository. |
| [architecture.md](architecture.md) | Understanding the three intended areas, current frameworks, and modular boundaries. |
| [code-standards.md](code-standards.md) | Applying TypeScript, folder structure, modularity, React, Zustand, and routing standards. |
| [structural-solver.md](structural-solver.md) | Working on the model, solver candidates, adapter boundaries, or proposed validation options. |
| [structural-state.md](structural-state.md) | Browser saves, experimental solver snapshots, and proposed general state and fixture design. |
| [solver-criteria.md](solver-criteria.md) | Reading the owner-supplied proposed solver requirements, acceptance gates, implementation order, and open gameplay decisions. |
| [solver-criteria-gap-analysis.md](solver-criteria-gap-analysis.md) | Comparing current code and tests with the criteria and planning implementation milestones. |
| [turn-criteria.md](turn-criteria.md) | Defining the two decks, turn phases, six-DOF connection cards, issue assessment and penalty decisions. |
| [game-dynamics.md](game-dynamics.md) | Working on game state, turns, rules, or modes. |
| [3d-viewer.md](3d-viewer.md) | Working on the 3D grid, interaction, or visual feedback. |
| [development-and-testing.md](development-and-testing.md) | Finding current setup, commands, and test coverage. |

## Maintenance

- Validate facts against current code, configuration, tests, or explicitly identified project decisions; list sources in front matter.
- Update affected pages in the same change as durable behavior or decisions. Keep `last_validated` and `status` accurate.
- Use `current`, `partial`, `needs-review`, or `deprecated` for status. Record unanswered questions rather than guessing.
- Treat design intent as intent, not shipped functionality. Existing non-KB documents are context unless explicitly cited and validated.

