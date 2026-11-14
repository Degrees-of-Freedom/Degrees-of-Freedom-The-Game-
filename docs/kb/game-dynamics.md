---
title: "Game Architecture and Turn Dynamics"
last_validated: 2026-11-14
validated_against:
  - apps/web/src/game/model.ts
  - apps/web/src/game/store.ts
  - apps/web/src/game/examples.ts
  - apps/web/src/game/placementRules.ts
  - apps/web/src/game/persistence.ts
  - docs/kb/solver-criteria.md
owner: unknown
status: partial
---

# Game Architecture and Turn Dynamics

The voxel experiment has tower, bridge and weight pickup challenges and a sandbox, finite inventories in challenges, member and attachment placement, removal, swapping, undo, and reference examples for Tower I, Bridge I and Pickup I. The random pickup challenge can generate a new undoable layout. Models are saved per level in browser local storage when available. These are prototype rules, not established final game design. The Zustand store owns the model and edit history. Placement rules and browser persistence are separate modules. Analysis results are not stored: the workspace holds the voxel result and the OpenSees stability check in component state, each tied to the exact model it was computed from, so an edit clears both.

The concept proposes players taking turns placing structural members and connections, applying loads, and developing a structure, with goal-based and failure-based modes. A turn system and final rules remain open.

## Proposed solver-facing turn policy

[Solver criteria sections 4 and 9](solver-criteria.md#4-turn-resolution-and-failure) propose 2–4 players, an initial foundation and column per player, and a member plus up to two connections per turn. The proposed completed-turn transaction reapplies persistent loads to current topology from reference geometry, preserves committed damage and explicit initial strain, and records a stable model/version ID. Preview must not mutate committed state or trigger penalties. This turn policy is not implemented by the voxel editing loop.

Proposed defaults are fixed foundations, cross-player connections, persistent gravity, full reanalysis, retaining unstable geometry on the grid, and no automatic collapse. Interior attachments, self-weight/uplift scoring, instability penalties, permanent failure and repair, permanent deformed geometry, and cumulative scoring still require owner decisions. Keep these policies outside the physics kernel. An unverified component must not receive a new authoritative reaction score; optional failure release/removal requires a bounded deterministic reanalysis policy, not a dynamic-collapse claim.
