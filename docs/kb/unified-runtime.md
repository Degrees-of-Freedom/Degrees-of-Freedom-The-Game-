---
title: "Unified Game Runtime"
last_validated: 2026-11-15
validated_against:
  - docs/kb/grow-dusk-runtime.md
  - docs/kb/cantilever-placement.md
  - docs/kb/voxel-retirement.md
  - "origin/ftroshani at 93851e99692255cd64c2f9f23a64da417e82c782, prototypes/game-environment"
  - "Owner direction to use the prototype branch for visual layouts, styles, and graphics"
  - apps/web/src/pages/Home.tsx
  - apps/web/src/pages/ModeSetup.tsx
  - apps/web/src/components/PauseMenu.tsx
  - apps/web/src/pages/MainMenu.tsx
  - apps/web/src/pages/Workspace.tsx
  - apps/web/src/components/environment
  - apps/web/src/styles
  - apps/web/src/viewer
  - apps/web/src/game
  - apps/web/src/solver/voxel/analyze.ts
  - prototypes/game-environment/grow-dusk/index.html
  - apps/web/src/components/environment/GrowthTools.tsx
  - apps/web/src/components/environment/JointCard.tsx
  - apps/web/src/viewer/growthBloom.ts
  - apps/web/src/viewer/dofGizmo.ts
  - apps/web/src/styles/environment-grow-dusk-parity.css
owner: unknown
status: partial
---

# Unified Game Runtime

The normal title-screen Play action enters the [Grow Dusk release match](grow-dusk-runtime.md). Fresh games combine catalogue grow-dusk-release-2 with rulesRevision grow-dusk-play-2: [fixed interior frame collars](cantilever-placement.md) plus the later three-deck, local-frame, unlimited held-play and checkpoint rules. Older matches retain their recorded combination. More modes preserves secondary workspaces and historical catalogues, including the frame-and-cable and cantilever presets. New analysis uses the Rust-backed evaluator; older saved playtests retain their replay engine.

The visual references are the five standalone environments from the [prototype branch at the captured revision](https://github.com/Degrees-of-Freedom/Degrees-of-Freedom-The-Game-/tree/93851e99692255cd64c2f9f23a64da417e82c782/prototypes/game-environment). The original launcher described four environments; Grow Dusk was present separately and is included here. Launcher images in `apps/web/public/environments` are captures of those original WebGL environments. The full-screen workspace ports their arrangements, palettes, and control groups into React and Three.js. The reference pages and their shared JavaScript model do not run in the app.

## Entry points and boundaries

Grow Dusk Creative exposes **Foundation** on the building toolbar (keyboard 0). Clicking solid ground places a fully fixed foundation. Selecting it again opens its six-restraint inspector and preserves the support. Build options → Precise placement → Foundation at start uses the same action. Placement is undoable and saved with the model. Shared table retains its preset player foundations. [Pointer acceptance fixture](../evidence/foundations/check.mjs)

- The title screen links Play to `/match`, where a new or existing Shared table game opens behind a handoff cover. More modes links to `/modes`. Its five secondary workspaces use `/setup/:mode` and `/play`. Historical catalogue IDs and secondary storage are preserved; fresh Shared table setup defaults to **Shared table · cantilevers**, while Continue retains the saved catalogue.
- The workspace has a Menu button and the `P` key (and `Esc` when nothing else uses it) for a pause overlay: Resume, Restart (`reset`, or `newMatch` once a Shared table match has finished), How to play, Settings and Quit to menu. While it is open the app root is inert and keys are not passed to the scene.
- Grow Dusk is the only environment offered. Grow, Levels, Blocks, Kit and Engineering styles, their CSS, the store's style support and the old launcher (`pages/MainMenu.tsx`, no longer routed) stay in the codebase but cannot be reached from the UI. Grow Dusk shows the Shared table card tray itself (`environment-grow-dusk-hand.css`).
- Growing a member offers every lattice point within the section's per-axis `maxCells`. Targets that overlap on screen are chosen nearest the camera first; the wheel or `[` and `]` step through them (`viewer/growthStack.ts`). `viewer/growthBloom.ts` draws those targets.
- A game mode defines a rules context; an environment changes presentation and placement interaction. Switching the environment preserves the structure. Engineering challenges use tower, bridge, and pickup levels; Creative permits open editing; Forensics starts from a prepared repair fixture; Load in space starts with a suspended load target; Shared table uses cards. In the Grow and Grow Dusk scenes a small islet (`viewer/companionIslet.ts`) stands in the water off the board's far-left corner, in view when the board is fitted, on the Workspace and on the Shared table match board alike; it is scenery outside the grid and cannot be built on. The companion's model (`viewer/companionFigure.ts`) stands on the islet as part of the scene, lit and shadowed with it and turned toward the camera, so it cannot trail the view while orbiting. It is a second view of the companion control's animation: the control's animator publishes each sampled pose through `companion/boardPose.ts`, and the islet figure applies the same channels about its feet, so every scenario clip, idle fidget and Conkeldurr's entrance from the [avatar criteria](avatar-criteria.md#scenario-motion-implemented-2026-11-15) plays on the islet too, and it adds a small lean toward the viewer under the pointer and while its cloud is open. Its HTML button stays as an invisible click and focus target over the model, kept inside the view when the camera turns the islet away, and its help opens as one speech cloud above it, or beside it, level with its head, while the islet is in the upper part of the view; the cloud grows to fit its text, never scrolls, and closes from a small x in its corner. If a character's model file cannot be loaded, the HTML figure is drawn at that position instead; the other character is never substituted. Other environments, and a view without WebGL, fall back to a drawn islet at the left screen edge. This places a permanent character in the board scene by owner decision of 2026-11-15, which the avatar criteria had left out of first scope.
- `store.ts` coordinates editor state, history, and persistence. `turns.ts` owns the Shared table rules. `session.ts` validates and reconstructs a turn session from versioned deterministic events. `connectivity.ts` reports foundation reachability independently of numerical analysis.
- In non-multiplayer environments, select **Foundation** and click solid ground to place or remove a foundation, subject to the level's supply and locked supports. The presentation environments also support the **B** shortcut; Kit offers the foundation in its piece tray. Shared table player foundations remain setup-only.
- `Scene.tsx` and its viewer modules share one renderer, with camera, guides, geometry, picking, and palette selected by the environment. `components/environment` and the scoped `environment-*.css` files provide the chrome, trays, and controls. Build options exposes precise coordinate entry.
- Structural analysis (the Rust solver through the structure evaluator; the legacy voxel kernel only for replaying older saved playtest matches) remains separate from the viewer. Solver input in the workspace drawer presents a versioned editor model or the Shared table state. It differs from the branch prototype’s draft split-element JSON and from the preliminary shared solver contract.

Transient structure and save checks show a compact spinner with an accessible status label; errors remain visible. The spinner respects the system reduced-motion preference.

In Grow Dusk Shared table, after choosing an element start, the same reachable-point bloom and overlap cycling used by the editor show destinations accepted by the current card and turn placement rules. Board boundaries, card reach and clashes can restrict the fan.

## Challenge and runtime audit (2026-11-15)

The challenge selector includes Tower I and II, Bridge I and II, Pick-up I and II, and a random pick-up layout. Each has a reference model in `game/examples.ts`; `game/examples.test.ts` checks the objectives through `analyzeGame`. Loading the random pick-up example replaces the current random weights with a reproducible three-weight layout that meets the random generator's bounds and spacing; it does not solve the current arbitrary layout.
