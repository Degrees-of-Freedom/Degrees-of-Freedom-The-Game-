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

## Challenge and runtime audit (2026-11-15)

The challenge selector includes Tower I and II, Bridge I and II, Pick-up I and II, and a random pick-up layout. Only Tower I, Bridge I and Pick-up I currently have reference models in `game/examples.ts`. `game/examples.test.ts` checks that those three satisfy the objectives through `analyzeGame`. The remaining challenges do not yet have verified solutions. A random-layout example must retain the current saved targets instead of generating a different layout.

Editor and challenge simulation uses the Rust-backed structure evaluator through `analyzeGame` and a validated editor snapshot; browser editor saves use the versioned `dof-voxel-save` envelope. The release match uses a separate versioned event/session model and Rust turn solver; older turn engines deliberately retain the legacy voxel path for replay. These models share infrastructure but are not one interchangeable state format. The editor's optional stability check uses the configured solver, separately from its Rust simulation. Do not silently migrate historical matches or claim solver parity without verifying their rules and results.

The release board has the newer view-mode panel, including displacement shadow, diagrams and instability; the secondary workspace has its own analysis controls and does not yet expose that full panel. Unifying those controls requires adapting them to the editor response and its selected load combination, and validating each overlay's availability and freshness.

## Environment mapping

| Environment | Current adaptation | Source behavior or detail that differs |
| --- | --- | --- |
| Grow | Cream quay, pale water, role-colored members, reachable-point bloom and chained placement in an orbitable 3D scene. | Uses the unified placement rules, shared lattice, and member sections. The original model discovers joints where supported lattice points lie along intersecting members and splits them for solver output. Voxel analysis uses shared endpoints. |
| Grow Dusk | Grow interaction with a dark dock, evening sky, colored water and warm accents, laid out and operated as the prototype is. See [Grow Dusk and its prototype](#grow-dusk-and-its-prototype). | Shares the same model and the same Grow geometry limitations. |
| Levels | Isometric board, active working level, quarter turns, relief guide and working-level controls. | The source floor interaction is adapted to the shared picker and member rules. The editor’s board and constraints follow the active game mode. |
| Blocks | Bay placement and shared-edge deduplication, with brace and eraser controls in a quay scene. | Bay placement is an atomic structural edit. The source keeps separate bay and panel plans, accounts for shared faces, and remembers erased segments for restoration. The adaptation does not reproduce the entire plan-and-mask model. |
| Kit | Evening turntable, player strips, card tray, local handoff and member-end placement. | The original exact-length sticks, direct joint and foundation tokens, free take-backs, and three-action budget describe a prototype sandbox. The Shared table uses printed maximum lengths and confirmed card rules. |

Some visual feedback and input details differ across the reference and the unified renderer, including arrangement at small viewport sizes and how occluded picks resolve. Treat the source screenshots as visual references rather than evidence that every interaction or frame matches.

## Grow Dusk and its prototype

The Grow Dusk workspace follows `prototypes/game-environment/grow-dusk/index.html` for where controls sit and how modelling feels. This section records what matches and what deliberately differs. The parity change was written without a local Node toolchain: it was not compiled, tested or viewed in a browser when it was made, so treat the list as intent until the CI run and a browser check confirm it.

Matching the prototype:

- **Layout.** Brand and turn chips top left; one action bar top right in the prototype's order (undo, redo, Load example, Clear, analysis, Solver input, sound, help, Menu); hint, load pad and tools in a bottom-centre dock; axes disc and statistics bottom left; controls panel bottom right. `environment-grow-dusk-parity.css` restores the dusk panels where the shared runtime stylesheet had applied cream defaults, and drops the corners to the bottom edge from 1280 px wide.
- **Three tools.** Member (1), Connection (2) and Load (3), in `GrowthTools.tsx`. Changing tool lets go of the selection.
- **Member tool.** `viewer/growthBloom.ts` draws the reachable points as the prototype does: points on the 26 principal directions stay more prominent on spokes, off-angle points appear near the pointer, the chosen point swells, and a drop line with a deck ring shows its height. A label beside the ghost member gives length, role, coordinates and the overlap count. Rings mark the hovered point, the armed start and the selected joint.
- **Connection tool.** The joint card (`JointCard.tsx`) has the prototype's support presets, six degree-of-freedom tiles and joint type, and sits beside the selected joint. `viewer/dofGizmo.ts` draws the six components around the joint in a second render pass.
- **Load tool.** The pad above the tools picks direction and amount, with arrows that turn with the camera. Selecting a loaded joint switches the pad to editing, with Remove.
- **Removing.** Right-click, Alt+click, or point and press Delete.
- **Camera.** 30 degree field of view, the prototype's three-quarter opening view, and limits that keep the camera above the quay.

Deliberate differences:

- **Rules come from the app.** Editor reach is the section's `maxCells`, not the prototype's four steps. The editor's endpoint joins are separate from Shared table's explicit original-quarter targets and v2 fixed source collars. Shared table validates the full printed Euclidean span and original interface identity; see [placement criteria](placement-criteria.md) and [cantilever placement](cantilever-placement.md).
- **Run simulation replaces Feedback preview.** The prototype tinted members with mock numbers; the app runs its experimental analysis. A utilization legend appears bottom right when design checks apply.
- **Erase and Inspect buttons.** Two compact buttons sit beside the three tools. The [controls criteria](controls-camera-criteria.md) ask that no action depend on right-click or hover alone.
- **Camera buttons.** Fit and quarter turns stay on screen for the same reason. Editor working-level buttons are hidden in the growth styles (Page Up and Page Down still work). Shared table's element targeting has explicit Horizontal, Vertical XZ and Vertical YZ build planes that remain stable while orbiting.
- **Joint glyphs rest.** The gizmo and the card tiles move only for a brief demonstration after a joint is selected or a lock changes, and not at all under reduced motion, as the [joint DOF criteria](joint-dof-criteria.md) confirm. The prototype swayed them continuously. The card labels the support as relative to the ground and keeps it apart from the joint type. The Selected joint / All joints / Off display control from those criteria is not built; the gizmo shows the selected joint only.
- **Support edits are Creative only.** The store rejects them elsewhere, so other modes show the card read-only.
- **Shared table.** The card tray takes the dock in place of the tools, because cards drive a turn. The turn chip shows the round out of the fixed total and the 1 member / 1 load / 2 connections allowances from the [turn criteria](turn-criteria.md). Setup and How to play list the confirmed [completion decisions](game-completion-criteria.md#2-owner-confirmed-decision-register) and say which ones the playtest does not apply yet.
- **Extras.** Build options, Structure library and Turn details sit in one chip, bottom right.

Not carried over: the prototype's sky and water shaders (sun glow, warm path on the water), the grow-in and pop animations of new pieces, the bobbing and dashed drawing of unsupported pieces, the load ghost under the pointer, wheel-to-step a load, click-again to step a joint's type, and the Finish summary in the pause menu.

## Model and analysis semantics

A standard workspace member has two lattice endpoints. Creative can author six DOF restraints at a support and choose among signed X, Y and Z point-load directions. The editor persists those values, and its Rust-backed evaluator applies their declared restraints and loads. Reachability follows shared editor endpoints or explicit Shared table attachments, including original quarter source collars in v2. Reachability indicates a graph path to a support; stability, stiffness, and capacity require analysis. Load totals count explicit point loads, separate from generated solver loads.

**Run simulation** analyzes the workspace model or draft and opens the results drawer. **Results** reopens the available analysis for the unchanged model. Ordinary editor/playtest applied previews can include point loads and member self-weight; scored release v1/v2 turns use card gravity with self-weight off. Engineering challenges and Load in space use the active level's design combinations and objective checks. The Rust-backed evaluator reports verified actions, displacement and applicable game capacity checks, preserving unavailable scopes explicitly. The legacy voxel kernel is retained only for saved playtest replay. These game checks are not engineering-design acceptance. See [structural solver](structural-solver.md), [voxel retirement](voxel-retirement.md) and [solver criteria](solver-criteria.md).

Grow and Grow Dusk support drag-to-place and clicking the active anchor to cancel a chain. Levels starts a populated board at level two and supports Shift-click to place a column one level down. Blocks cycles a panel through either diagonal, cross-bracing and no brace, as one undoable edit; the starting orientation is canonical rather than aim-dependent. These operations use the shared store and placement rules.

## Shared table playtest

The [versioned turn rules](turn-criteria.md#1-status-and-confirmed-rules) keep two players, eight rounds and retained hands. Normal Play chooses any four draws from three decks, permits held-card plays without the earlier 1/1/2 caps, and assesses at recorded checkpoints. The cantilever catalogue additionally permits a declared frame source quarter or midpoint with one explicit Fixed connector. Cancellation, Undo and provisional edits preserve recorded draws and validate dependencies. Original committed attachments remain immutable; revised system corrections are separate. Historical presets retain their own draw, play and assessment policies.

Available connector profiles depend on the selected catalogue. End profiles keep their existing laws; interior source collars are fixed-only in v2. Members may meet geometrically without being attached. A render projection maps the explicit board into the common scene; numerical analysis must not infer connectivity from that projection. Unattached ends retain distinct analytical nodes. End turn validates the complete draft, assesses verified issues, applies at most one historical deduction and records any accepted neutral physical repair before advancing play. Supported results remain available beside unavailable scopes. New matches use Rust; older saved playtests replay on their recorded engine. This is local hot-seat play, without online multiplayer or server-side rules enforcement. See [release runtime](grow-dusk-runtime.md) for the current save and assessment path.
