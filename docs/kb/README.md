---
title: "Knowledge Base"
last_validated: 2026-11-14
validated_against:
  - README.md
  - package.json
  - docs/kb/architecture.md
  - docs/kb/structural-solver.md
  - docs/kb/development-and-testing.md
owner: unknown
status: partial
---

# Knowledge Base

## Purpose and status

This is the canonical entry point for durable project knowledge. The game remains at the concept stage with an initial web scaffold and one solver backend. The scaffold includes an orbitable viewer, a small game store, a solver contract, and solver adapters; it does not implement gameplay. An OpenSees analysis service exists in `services/opensees` but the web UI does not call it yet. Distinguish documented intent and proposed experiments from implemented behavior and decisions.

## Pages

| Page | Use this when |
| --- | --- |
| [project.md](project.md) | Understanding the concept, status, and repository. |
| [architecture.md](architecture.md) | Understanding the three intended areas, current frameworks, and modular boundaries. |
| [structural-solver.md](structural-solver.md) | Working on the model, the OpenSees service, stability assessment, adapter boundaries, or solver tests. |
| [game-dynamics.md](game-dynamics.md) | Working on game state, turns, rules, or modes. |
| [3d-viewer.md](3d-viewer.md) | Working on the 3D grid, interaction, or visual feedback. |
| [development-and-testing.md](development-and-testing.md) | Finding current setup, commands, and test coverage. |

## Maintenance

- Validate facts against current code, configuration, tests, or explicitly identified project decisions; list sources in front matter.
- Update affected pages in the same change as durable behavior or decisions. Keep `last_validated` and `status` accurate.
- Use `current`, `partial`, `needs-review`, or `deprecated` for status. Record unanswered questions rather than guessing.
- Treat design intent as intent, not shipped functionality. Existing non-KB documents are context unless explicitly cited and validated.
