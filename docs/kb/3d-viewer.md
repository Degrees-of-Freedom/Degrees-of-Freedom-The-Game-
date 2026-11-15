---
title: "3D Viewer"
last_validated: 2026-11-14
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
owner: unknown
status: partial
---

# 3D Viewer

The [structure library](structure-library.md) adds 20 selectable specimens with PNG previews and previous/next loading. Loading fits the camera to the specimen's bounds; these previews show undeformed geometry, while the interactive scene uses the usual analysis controls.

The React workspace uses Three.js for a Z-up voxel scene with terrain, orbit and zoom, build planes, member and node picking, and placement. The viewer consumes the Zustand game model; edit validity is checked by game rules. It can show approximate experimental analysis results using deformed positions, member colours, load and reaction arrows, and a force-weighted load-path view. Load paths are illustrative routes derived from the results, not a separate physical analysis. These visualizations inherit the solver's limitations and are not engineering design evidence. The OpenSees stability check appears only as numbers in the analysis panel; the viewer does not yet draw its mechanism shapes or moving nodes.

The scene manages the renderer and lifecycle. Separate modules handle picking, input, mesh construction, result overlays, and particle animation.

The full-screen workspace follows the layouts and palettes of Grow, Grow Dusk, Levels, Blocks and Kit from the environment prototype branch. The [unified runtime](unified-runtime.md#environment-mapping) records the mapping and remaining interaction differences. The shared scene renders computed deformation, utilization, load arrows and reaction labels when the current simulation provides those results. Grow Dusk labels applied loads in kN and positions weights above or below joints according to neighboring members. Shared table shows explicit end connections and reads solver positions for loose endpoints. Graph reachability remains available independently of numerical results.

In the growth styles the scene also draws the reachable-point bloom and height guide (`growthBloom.ts`), the selected joint's six ground-restraint components (`dofGizmo.ts`, rendered as a second pass over the structure), and screen-space rings and labels that the render loop positions each frame. The picker publishes what the pointer is over (`SceneHover` in `sceneView.ts`) so these follow the same target the click will use. The gizmo shows the selected joint only and what the model stores; it is not the full permissions overlay of the joint DOF criteria below and does not report stability. See [Grow Dusk and its prototype](unified-runtime.md#grow-dusk-and-its-prototype); that work was not compiled or viewed in a browser when written.

## Animation and sound requirements

See [animation and sound criteria](animation-criteria.md) for the owner-confirmed magical arena direction, all-action coverage and coordinated sound. The specification includes configurable structural glow/pulse, reduced-motion alternatives, and a distinction between reference geometry, verified deformation and illustrative instability modes. Breaking/removal effects require a matching committed game transition. This is a presentation specification, not a claim that these effects or controls exist.

## Deferred Timburr companion

[Avatar criteria](avatar-criteria.md) define a compact Timburr companion across screens and a proposed temporary Conkeldurr reaction. Live models, pose approval and fallback behavior remain future implementation work. The [prototype handoff](../../prototypes/timburr-companion/README.md) preserves candidate assets and unfinished code in an unapplied patch; it is not part of the current viewer. The available desktop browser could not create a WebGL context, so live character rendering has not been visually validated.

## Joint DOF visualization requirements

Grow Dusk's **Build options → Joint permissions** controls Selected joint / All joints / Off and remembers the mode across reload. It draws an individual compass for each displayed intentional joint, with straight translation marks, rotational arcs, locked stops, free arrowheads and elastic zigzags. A separate striped base identifies ground restraints. The native selector exposes all joint identities, local-frame coordinates and six-axis tables, including world-axis coupling and different attached-end spring stiffnesses. The meanings, physical scope and verification are recorded in [Joint DOF criteria §10](joint-dof-criteria.md#10-open-decisions-and-current-gaps).

## Structural element geometry requirements

[Element representation criteria](element-representation-criteria.md) specify recognizable column/section geometry, axial helical springs, planar two-chord and triangular three-chord trusses, wide flanges, square/rectangular HSS, round HSS and cables. Default sections are slightly enlarged for readability with true-scale inspection. The current renderer primarily uses capsules/boxes with style-dependent widths; it does not meet the full profile/assembly criteria. Procedural shared meshes, LOD, section roll, exposed hollow ends, assembly identity and truthful deformation are future requirements, not shipped behavior.

## Controls, physical clashes and repair feedback

[Controls/camera criteria](controls-camera-criteria.md) define input parity, target disambiguation, reference-grid/quarter selection, safe navigation and accessible inspection. [Placement](placement-criteria.md) distinguishes physical reference clash geometry from enlarged meshes and intentional port contacts. [Failure/repair](failure-repair-criteria.md) requires clear resolved/improved/persistent/unknown markers while retained structures continue in play. The viewer must not infer these rules or claim physical validity from mesh contact.
