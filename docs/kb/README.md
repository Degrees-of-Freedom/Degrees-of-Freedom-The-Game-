---
title: "Knowledge Base"
last_validated: 2026-11-14
validated_against:
  - README.md
owner: unknown
status: partial
---

# Knowledge Base

## Purpose

This is the canonical entry point for durable project knowledge. The project is at the concept stage; distinguish documented intent from implemented behavior and unresolved design decisions.

## Pages

| Page | Use this when |
| --- | --- |
| [project.md](project.md) | Understanding the concept, status, and repository. |
| [architecture.md](architecture.md) | Understanding the three intended areas and their boundaries. |
| [structural-solver.md](structural-solver.md) | Working on structural models, analysis, stability, or failure feedback. |
| [game-dynamics.md](game-dynamics.md) | Working on game state, turns, rules, or modes. |
| [3d-viewer.md](3d-viewer.md) | Working on the 3D grid, interaction, or visual feedback. |
| [development-and-testing.md](development-and-testing.md) | Finding current setup and validation information. |

## Maintenance

- Validate facts against current code, configuration, tests, or explicitly identified project decisions; list sources in front matter.
- Update affected pages in the same change as durable behavior or decisions. Keep `last_validated` and `status` accurate.
- Use `current`, `partial`, `needs-review`, or `deprecated` for status. Record unanswered questions rather than guessing.
- Treat design intent as intent, not shipped functionality. Existing non-KB documents are context unless explicitly cited and validated.
