---
title: "Architecture"
last_validated: 2026-11-14
validated_against:
  - README.md
owner: unknown
status: partial
---

# Architecture

## Purpose

Orient work around the intended parts of the project. The three-area organization below comes from the project owner's direction; it is not an implemented architecture.

## Intended areas

| Area | Responsibility | Detail |
| --- | --- | --- |
| Structural solver | Evaluate the structure and its response to loads. | [Structural solver](structural-solver.md) |
| Game architecture and turn dynamics | Represent game state, player actions, turns, rules, and modes. | [Game dynamics](game-dynamics.md) |
| 3D viewer | Present the grid and structure and support visual interaction. | [3D viewer](3d-viewer.md) |

These are conceptual boundaries, not a commitment to separate processes or packages. The owner intends to use WebGL for the viewer; other technology choices remain under consideration. A future design should define how game state supplies a structural model to the solver and how results and state are presented in the viewer.

## Open questions

- What are the data contracts, ownership boundaries, and update flow between the three areas?
- Which parts run locally or remotely, and what technologies will they use?
