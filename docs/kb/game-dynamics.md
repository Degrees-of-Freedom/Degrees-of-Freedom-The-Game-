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
  - docs/kb/turn-criteria.md
owner: unknown
status: partial
---

# Game Architecture and Turn Dynamics

The voxel experiment has tower, bridge and weight pickup challenges and a sandbox, finite inventories in challenges, member and attachment placement, removal, swapping, undo, and reference examples for Tower I, Bridge I and Pickup I. The random pickup challenge can generate a new undoable layout. Models are saved per level in browser local storage when available. These are prototype rules, not established final game design. The Zustand store owns the model and edit history. Placement rules and browser persistence are separate modules.

The owner has now confirmed the core turn rules in [turn, deck and connection criteria](turn-criteria.md): draw two cards from each of two decks, then play up to one element, one load and two connections. Passing is allowed. Each connection attaches one member end to a shared joint. End-turn analysis identifies introduced issues; adverse moves remain and receive a 1-point deduction once per turn with a verified new/worsened issue. Unchanged issues and unresolved results do not trigger deductions. Shared access allows new loads/attachments, placed connections cannot be edited, foundations are setup-only, and base-game loads are persistent downward gravity loads. The [unified runtime](unified-runtime.md#shared-table-playtest) implements the draw, staging, attachment, cancellation and commit rules in the local Shared table playtest. Numerical issue verification and penalties remain pending. The criteria distinguish confirmed rules from proposals and open questions.

## Proposed solver-facing turn policy

[Solver criteria sections 4 and 9](solver-criteria.md#4-turn-resolution-and-failure) propose 2–4 players and an initial foundation and column per player. The newer [turn criteria](turn-criteria.md) define the confirmed draw/play limits and proposed detailed transaction/assessment policy. The proposed completed-turn transaction reapplies persistent loads to current topology from reference geometry, preserves committed damage and explicit initial strain, and records a stable model/version ID. Preview must not mutate committed state or trigger penalties. This turn policy is not implemented by the voxel editing loop.

Proposed defaults are fixed foundations, cross-player connections, persistent gravity, full reanalysis, retaining unstable geometry on the grid, and no automatic collapse. Interior attachments, self-weight/uplift scoring, penalty worsening thresholds, permanent failure and repair, permanent deformed geometry, and cumulative scoring still require owner decisions. Keep these policies outside the physics kernel. An unverified component must not receive a new authoritative reaction score; optional failure release/removal requires a bounded deterministic reanalysis policy, not a dynamic-collapse claim.
