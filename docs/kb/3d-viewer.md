---
title: "3D Viewer"
last_validated: 2026-11-15
validated_against:
  - docs/kb/game-completion-criteria.md
  - docs/kb/element-representation-criteria.md
  - docs/kb/joint-dof-criteria.md
  - docs/kb/avatar-criteria.md
  - prototypes/timburr-companion/README.md
  - docs/kb/animation-criteria.md
  - apps/web/src/viewer
  - apps/web/src/viewer/growthBloom.ts
  - apps/web/src/viewer/dofGizmo.ts
  - apps/web/src/pages/Workspace.tsx
  - apps/web/src/viewer/viewModes.ts
  - apps/web/src/viewer/viewPalette.ts
  - apps/web/src/viewer/displacementShadow.ts
owner: unknown
status: partial
---

# 3D Viewer

The [structure library](structure-library.md) adds 30 selectable specimens with PNG previews and previous/next loading. Loading fits the camera to the specimen's bounds; these previews show undeformed geometry, while the interactive scene uses the usual analysis controls.

The React workspace uses Three.js for a Z-up structural scene with terrain, orbit and zoom, build planes, member and node picking, and placement. The viewer consumes the Zustand game model; edit validity is checked by game rules. Shared table renders verified Rust/WASM checkpoint response with deflection, signed gravity-transfer arrows, shear/moment diagrams and support reactions. Its separate instability diagnostic draws returned normalized solver modes with explicit scope and scale limitations. Legacy experimental views retain their own result interpretation. These educational visualizations are not engineering design evidence; the separate OpenSees panel does not supply the Shared table animation.

The scene manages the renderer and lifecycle. Separate modules handle picking, input, mesh construction, result overlays, and particle animation.

`sceneUpdates.ts` classifies store changes. Physical model/turn changes, inspected selections and environment/work-plane changes rebuild the structure. Card, tool, connector-profile, chain and load-brush changes clear previews and refresh targeting guides while retaining member meshes, shaders and label textures. Persistence/worker-status acknowledgements allocate no geometry; React and picking read their current values independently. Overlay changes still use the separate result-driven refresh path. This avoids retiring the entire calculated scene on every card selection.

The Grow Dusk match adds [view modes and legends](grow-dusk-runtime.md#view-modes-and-legends). Pure modules own the mode state (`viewModes.ts`), legend content (`viewLegends.ts`), display number formatting (`viewFormat.ts`) and the overlay palette and displacement contour (`viewPalette.ts`, `contourRamp.ts`). `displacementShadow.ts` builds the deflected ghost. `SceneView.shadow` and `SceneView.labels` switch it and every scene text label; other workspaces leave both unset and keep their labels.

The full-screen workspace follows the layouts and palettes of Grow, Grow Dusk, Levels, Blocks and Kit from the environment prototype branch. The [unified runtime](unified-runtime.md#environment-mapping) records the mapping and remaining interaction differences. The shared scene renders computed deformation, utilization, load arrows and reaction labels when the current simulation provides those results. Grow Dusk labels applied loads in kN and positions weights above or below joints according to neighboring members. Shared table shows explicit end connections and reads solver positions for loose endpoints. Graph reachability remains available independently of numerical results.

In the growth styles the scene also draws the reachable-point bloom and height guide (`growthBloom.ts`), the selected joint's six ground-restraint components (`dofGizmo.ts`, rendered as a second pass over the structure), and screen-space rings and labels that the render loop positions each frame. The picker publishes what the pointer is over (`SceneHover` in `sceneView.ts`) so these follow the same target the click will use. The gizmo shows the selected joint only and what the model stores; it is not the full permissions overlay of the joint DOF criteria below and does not report stability. See [Grow Dusk and its prototype](unified-runtime.md#grow-dusk-and-its-prototype); that work was not compiled or viewed in a browser when written.

## Animation and sound requirements

See [animation and sound criteria](animation-criteria.md) for the owner-confirmed magical arena direction, all-action coverage and coordinated sound. The specification includes configurable structural glow/pulse, reduced-motion alternatives, and a distinction between reference geometry, verified deformation and illustrative instability modes. Breaking/removal effects require a matching committed game transition. This is a presentation specification, not a claim that these effects or controls exist.

## Timburr companion

[Avatar criteria](avatar-criteria.md) document the implemented attributed models, procedural motion library and matching portrait fallback. The board actor stands on an islet and shares sampled poses with its screen control. Exact character identity, hidden/offscreen behavior and decoder cleanup are independent of structural picking. A public third verified deduction for one player can trigger the temporary Conkeldurr reaction. Both normal and reduced-motion scenarios passed on the merged build; physical-device and subjective art approval remain separately scoped in the [ledger](criteria-ledger.md).

## Joint DOF visualization requirements

Selected joint / All joints / Off is persisted. Revised Shared table uses its separate `releaseJointDisplay` preference, default All; its eye menu and inspector synchronize that preference. Older workspaces retain `jointDisplay`. The render loop lays out the glyphs every frame. An individual compass shows each intentional joint's straight translation marks, rotational arcs, locked stops, free arrowheads and elastic zigzags. A separate striped base identifies ground restraints. Inspection exposes original identities, member-local coordinates and six-axis tables, including world-axis coupling and distinct attached-end laws. Permission glyphs are separate from the solver-mode diagnostic. See [Joint DOF criteria §10](joint-dof-criteria.md#10-open-decisions-and-current-gaps).

## Structural element geometry requirements

[Element representation criteria](element-representation-criteria.md) cover the supported section and assembly families. Procedural meshes now include open wide flanges, finite-wall SHS/RHS/CHS, helical springs and distinct planar/trichord pieces, using section axes. Readable transverse enlargement is separate from authored metre dimensions and true-scale inspection. End-on section previews expose the bore and wall dimensions. New Shared table decks still contain exactly four mechanical variants; broader historical catalogue geometry does not add extra player cards. The [ledger](criteria-ledger.md) distinguishes implemented profile tests from remaining full-device and representation acceptance.

## Controls, physical clashes and repair feedback

[Controls/camera criteria](controls-camera-criteria.md) define input parity, target disambiguation, reference-grid/quarter selection, safe navigation and accessible inspection. [Placement](placement-criteria.md) distinguishes physical reference clash geometry from enlarged meshes and intentional port contacts. [Failure/repair](failure-repair-criteria.md) requires clear resolved/improved/persistent/unknown markers while retained structures continue in play. The viewer must not infer these rules or claim physical validity from mesh contact.


## Creative view modes

Creative and the Library workspace expose the Shared table view-mode panel (side eye button or V): load path, deflected shape or displacement shadow, joint freedoms, loads and reactions, shear and bending diagrams, and witnessed instability. Run simulation to produce results; changing the model invalidates them. The Results drawer selects the load case used for the overlays. Visualizations are experimental and show only available solver response.
