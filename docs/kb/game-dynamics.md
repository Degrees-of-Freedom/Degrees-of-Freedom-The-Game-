---
title: "Game Architecture and Turn Dynamics"
last_validated: 2026-11-14
validated_against:
  - README.md
  - apps/web/src/game/store.ts
  - apps/web/src/game/store.test.ts
  - apps/web/src/game/examples.ts
owner: unknown
status: partial
---

# Game Architecture and Turn Dynamics

The web scaffold has a Zustand store containing an initially empty structural model, the analysis state of that model, and the solver adapter in use. Its actions reset the model, replace it, and run an analysis. The analysis state is idle, running, or done with a result. Replacing the model discards its analysis and cancels a run in progress, and a newer run supersedes an older one, so a shown result always belongs to the shown model. The store does not implement turns, placement, game rules, scoring, or persistence.

Three example structures in `apps/web/src/game/examples.ts` stand in for building tools: one cube frame geometry as a braced pinned truss, an unbraced pinned frame, and an unbraced rigid frame. They exist to exercise the analysis and are not game content.

The concept proposes players taking turns placing structural members and connections, applying loads, and developing a structure, with goal-based and failure-based modes. Rules and outcomes remain open.
