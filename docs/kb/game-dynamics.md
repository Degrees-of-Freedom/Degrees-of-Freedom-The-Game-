---
title: "Game Architecture and Turn Dynamics"
last_validated: 2026-11-14
validated_against:
  - docs/kb/game-completion-criteria.md
  - docs/kb/avatar-criteria.md
  - prototypes/timburr-companion/README.md
  - docs/kb/animation-criteria.md
  - apps/web/src/game/model.ts
  - apps/web/src/game/store.ts
  - apps/web/src/game/examples.ts
  - apps/web/src/game/placementRules.ts
  - apps/web/src/game/persistence.ts
  - docs/kb/solver-criteria.md
  - docs/kb/turn-criteria.md
  - docs/kb/joint-dof-criteria.md
owner: unknown
status: partial
---

# Game Architecture and Turn Dynamics

The voxel experiment has tower, bridge and weight pickup challenges and a sandbox, finite inventories in challenges, member and attachment placement, removal, swapping, undo, and reference examples for Tower I, Bridge I and Pickup I. The random pickup challenge can generate a new undoable layout. Models are saved per level in browser local storage when available. These are prototype rules, not established final game design. The Zustand store owns the model and edit history. Placement rules and browser persistence are separate modules. Analysis results are not stored: the workspace holds the voxel result and the OpenSees stability check in component state, each tied to the exact model it was computed from, so an edit clears both.

The owner has now confirmed the core turn rules in [turn, deck and connection criteria](turn-criteria.md): draw two cards from each of two decks, then play up to one element, one load and two connections. Passing is allowed. Each connection attaches one member end to a shared joint. The later [joint DOF criteria](joint-dof-criteria.md) require all attached ends at that joint to have matching freedoms in physical axes, with fully fixed foundations by default; this replaces different end-release choices at one joint and is enforced for the playable fixed and ball profiles. End-turn analysis identifies introduced issues; adverse moves remain and receive a 1-point deduction once per turn with a verified new/worsened issue. Unchanged issues and unresolved results do not trigger deductions. Shared access allows new loads/attachments, placed player connections cannot be edited, player foundations are setup-only with the explicit neutral-system repair exception, and base-game loads are persistent downward gravity loads. The [unified runtime](unified-runtime.md#shared-table-playtest) implements the draw, staging, attachment, cancellation and commit rules in the local Shared table playtest. The shared experimental solver records an end-turn status. Verified before-and-after issue comparisons and penalties remain pending. The criteria distinguish confirmed rules from proposals and open questions.

## Proposed solver-facing turn policy

[Solver criteria sections 4 and 9](solver-criteria.md#4-turn-resolution-and-failure) propose 2–4 players and an initial foundation and column per player. The newer [turn criteria](turn-criteria.md) define the confirmed draw/play limits and proposed detailed transaction/assessment policy. The proposed completed-turn transaction reapplies persistent loads to current topology from reference geometry, preserves committed damage and explicit initial strain, and records a stable model/version ID. Preview must not mutate committed state or trigger penalties. This turn policy is not implemented by the voxel editing loop.

Fully fixed foundations, shared access and persistent gravity are confirmed defaults. Full reanalysis remains a proposed solver-facing policy. Retaining player geometry without automatic destructive collapse is confirmed, now supplemented by recorded game-owned automatic correction for instability and overload. Quarter-only interior attachment on every family, additive repair without automatic destruction, and final-only attraction scoring are now confirmed by the completion criteria. Quarter numerical laws, self-weight/uplift/zero-load scoring, permanent neutral local-repair catalogue/envelopes, worsening thresholds and exact catalogue parameters remain to define; permanent damage/deformed geometry belongs only to a future separately approved variant. Keep these policies outside the physics kernel. An unverified component must not receive a new authoritative reaction score; optional failure release/removal requires a bounded deterministic reanalysis policy, not a dynamic-collapse claim.

## Action presentation requirements

See [animation and sound criteria](animation-criteria.md) for setup, draws, staging, per-end attachments, loads, analysis, issue/score feedback, handoff and match-outcome presentation. Animation must follow versioned authoritative events, preserve private information and never consume cards, apply penalties or decide outcomes through completion callbacks. Proposed timings and dramatic cues do not change turn rules or resolve open scoring/end-condition policies.

## Avatar reactions

[Timburr avatar criteria](avatar-criteria.md) define personality and public-event reactions independently of game state. Automatic Conkeldurr transformation requires a compatible verified serious-issue event; the current experimental turn report is insufficient. The avatar specification does not introduce penalties, collapse or match rules. Implementation is deferred; see the [prototype handoff](../../prototypes/timburr-companion/README.md).

## Core match rules and completion criteria

The later [completion decision register](game-completion-criteria.md) confirms fixed rounds and final-only load-share percentage minus accumulated penalties, highest adjusted score wins, plus first-release local hot-seat privacy. [Placement](placement-criteria.md) confirms grid/diagonal placement, quarter attachments on every family, clash-free geometry and one assembly card per element play with separately paid external connections. [Repair](failure-repair-criteria.md) retains structures and resolves issues through additions without automatic destruction. These supersede earlier contrary proposals; exact thresholds, definitions and numerical integration remain pending.
