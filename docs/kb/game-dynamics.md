---
title: "Game Architecture and Turn Dynamics"
last_validated: 2026-11-14
validated_against:
  - apps/web/src/game/model.ts
  - apps/web/src/game/store.ts
  - apps/web/src/game/examples.ts
owner: unknown
status: partial
---

# Game Architecture and Turn Dynamics

The voxel experiment has tower, bridge and weight pickup challenges and a sandbox, finite inventories in challenges, member and attachment placement, removal, swapping, undo, and reference examples for Tower I, Bridge I and Pickup I. The random pickup challenge can generate a new undoable layout. Models are saved per level in browser local storage when available. These are prototype rules, not established final game design. The Zustand store owns the model and editing actions separately from the viewer.

The concept proposes players taking turns placing structural members and connections, applying loads, and developing a structure, with goal-based and failure-based modes. A turn system and final rules remain open.

