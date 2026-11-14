---
title: "Unified Game Runtime"
last_validated: 2026-11-14
validated_against:
  - "origin/ftroshani at 93851e99692255cd64c2f9f23a64da417e82c782, prototypes/game-environment"
  - "Owner direction to use the prototype branch for visual layouts, styles, and graphics"
  - apps/web/src/pages/MainMenu.tsx
  - apps/web/src/pages/Workspace.tsx
  - apps/web/src/components/environment
  - apps/web/src/styles
  - apps/web/src/viewer
  - apps/web/src/game
  - apps/web/src/solver/voxel.ts
owner: unknown
status: partial
---

# Unified Game Runtime

The visual references are the five standalone environments from the [prototype branch at the captured revision](https://github.com/Degrees-of-Freedom/Degrees-of-Freedom-The-Game-/tree/93851e99692255cd64c2f9f23a64da417e82c782/prototypes/game-environment). The original launcher described four environments; Grow Dusk was present separately and is included here. Launcher images in `apps/web/public/environments` are captures of those original WebGL environments. The full-screen workspace ports their arrangements, palettes, and control groups into React and Three.js. The reference pages and their shared JavaScript model do not run in the app.

## Entry points and boundaries

- `/` presents the environment launcher. Grow Dusk is the primary launcher entry. It opens Creative, as do Grow, Levels and Blocks. Kit opens the local Shared table. The launcher also offers the five game modes. `/play` opens the current workspace.
- A game mode defines a rules context; an environment changes presentation and placement interaction. Switching the environment preserves the structure. Engineering challenges use tower, bridge, and pickup levels; Creative permits open editing; Forensics starts from a prepared repair fixture; Load in space starts with a suspended load target; Shared table uses cards.
- `store.ts` coordinates editor state, history, and persistence. `turns.ts` owns the Shared table rules. `session.ts` validates and reconstructs a turn session from versioned deterministic events. `connectivity.ts` reports foundation reachability independently of numerical analysis.
- `Scene.tsx` and its viewer modules share one renderer, with camera, guides, geometry, picking, and palette selected by the environment. `components/environment` and the scoped `environment-*.css` files provide the chrome, trays, and controls. Build options exposes precise coordinate entry.
- The experimental voxel solver remains separate from the viewer. Solver input in the workspace drawer presents a versioned editor model or the Shared table state. It differs from the branch prototype’s draft split-element JSON and from the preliminary shared solver contract.

## Environment mapping

| Environment | Current adaptation | Source behavior or detail that differs |
| --- | --- | --- |
| Grow | Cream quay, pale water, role-colored members, reachable-point bloom and chained placement in an orbitable 3D scene. | Uses the unified placement rules, shared lattice, and member sections. The original model discovers joints where supported lattice points lie along intersecting members and splits them for solver output. Voxel analysis uses shared endpoints. |
| Grow Dusk | Grow interaction with a dark dock, evening sky, colored water and warm accents. | Shares the same model and the same Grow geometry limitations. |
| Levels | Isometric board, active working level, quarter turns, relief guide and working-level controls. | The source floor interaction is adapted to the shared picker and member rules. The editor’s board and constraints follow the active game mode. |
| Blocks | Bay placement and shared-edge deduplication, with brace and eraser controls in a quay scene. | Bay placement is an atomic structural edit. The source keeps separate bay and panel plans, accounts for shared faces, and remembers erased segments for restoration. The adaptation does not reproduce the entire plan-and-mask model. |
| Kit | Evening turntable, player strips, card tray, local handoff and member-end placement. | The original exact-length sticks, direct joint and foundation tokens, free take-backs, and three-action budget describe a prototype sandbox. The Shared table uses printed maximum lengths and confirmed card rules. |

Some visual feedback and input details differ across the reference and the unified renderer, including arrangement at small viewport sizes and how occluded picks resolve. Treat the source screenshots as visual references rather than evidence that every interaction or frame matches.

## Model and analysis semantics

A standard workspace member has two lattice endpoints. Creative can author six DOF restraints at a support and choose among signed X, Y and Z point-load directions. The editor persists those values. The current voxel analysis applies independent axis restraints and signed point-load directions. Reachability follows shared member endpoints in the voxel editor and explicit attached ends in Shared table. Reachability indicates a graph path to a support; stability, stiffness, and capacity require analysis. Load totals count explicit point loads, separate from generated solver loads.

**Run simulation** analyzes the current model or Shared table draft and opens the results drawer. **Results** reopens the available analysis for the unchanged model. Creative, Forensics and Shared table use an applied-load case with point loads and member self-weight. Engineering challenges and Load in space use the active level’s experimental design combinations and objective checks. Applied-load results show deformation, reactions and member-end axial forces, shear and bending moments; they do not claim capacity or buckling checks. Utilization and governing checks are available for design combinations. Floating components are excluded from solved response and explicitly reported. The approximate solver is unvalidated for engineering design. See [structural solver](structural-solver.md) and [solver criteria](solver-criteria.md).

Grow and Grow Dusk support drag-to-place and clicking the active anchor to cancel a chain. Levels starts a populated board at level two and supports Shift-click to place a column one level down. Blocks cycles a panel through either diagonal, cross-bracing and no brace, as one undoable edit; the starting orientation is canonical rather than aim-dependent. These operations use the shared store and placement rules.

## Shared table playtest

The [confirmed turn rules](turn-criteria.md#1-status-and-confirmed-rules) supersede the placeholder three-action Kit prototype. The current deterministic local playtest uses two players, eight rounds, one fixed starting foundation and connected column per player, and retains unplayed cards. Those setup and balance values are playtest choices. Each turn draws two cards from the element/load deck and two from the connection deck. The active player may stage one member, one downward load and two individual end connectors, or pass. Draft cancellation restores staged cards without drawing again. Shared loads and attachments may target the other player's structure. Existing attachments are immutable.

The playtest includes fixed and ball profiles. Members may meet geometrically without being attached. A render projection maps this explicit board into the common scene; numerical analysis must not infer rigid connectivity from that projection. The experimental applied-load solve maps unattached ends to distinct nodes and releases all three rotations at ball connections. End turn commits the legal draft, consumes cards, records the experimental analysis status, and advances play. Supported results remain available in a partially analyzed model, with floating components identified separately. Verified new or worsened issue comparison and the one-point penalty remain pending. Deck and playtest configuration, local storage, and pass-and-play UI do not provide online multiplayer or server-side rules enforcement.
