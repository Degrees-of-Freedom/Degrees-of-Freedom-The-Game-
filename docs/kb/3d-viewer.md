---
title: "3D Viewer"
last_validated: 2026-11-14
validated_against:
  - docs/kb/multiplayer-refresh-criteria.md
  - docs/kb/game-completion-criteria.md
  - docs/kb/element-representation-criteria.md
  - docs/kb/joint-dof-criteria.md
  - docs/kb/avatar-criteria.md
  - prototypes/timburr-companion/README.md
  - docs/kb/animation-criteria.md
  - apps/web/src/viewer
  - apps/web/src/pages/Workspace.tsx
owner: unknown
status: partial
---

# 3D Viewer

> **Current target revision:** [Multiplayer simplification](multiplayer-refresh-criteria.md) supersedes conflicting older scope/rules on this page. Multiplayer is the only target; four source-selectable draws and unlimited held-card plays replace 2/2 draws and 1/1/2 caps. Structural work runs at configurable three-turn checkpoints plus match end. Only the standard axial/bending member, cable and two k₀ springs are playable; connectors control 1/2/3 rotational restraints. Minimum local safety constraints replace scaffold columns/extra foundations. Existing-code descriptions below remain implementation history, not proof this revision is shipped.


The [structure library](structure-library.md) adds 20 selectable specimens with PNG previews and previous/next loading. Loading fits the camera to the specimen's bounds; these previews show undeformed geometry, while the interactive scene uses the usual analysis controls.

The React workspace uses Three.js for a Z-up voxel scene with terrain, orbit and zoom, build planes, member and node picking, and placement. The viewer consumes the Zustand game model; edit validity is checked by game rules. It can show approximate experimental analysis results using deformed positions, member colours, load and reaction arrows, and a force-weighted load-path view. Load paths are illustrative routes derived from the results, not a separate physical analysis. These visualizations inherit the solver's limitations and are not engineering design evidence. The OpenSees stability check appears only as numbers in the analysis panel; the viewer does not yet draw its mechanism shapes or moving nodes.

The scene manages the renderer and lifecycle. Separate modules handle picking, input, mesh construction, result overlays, and particle animation.

The full-screen workspace follows the layouts and palettes of Grow, Grow Dusk, Levels, Blocks and Kit from the environment prototype branch. The [unified runtime](unified-runtime.md#environment-mapping) records the mapping and remaining interaction differences. The shared scene renders computed deformation, utilization, load arrows and reaction labels when the current simulation provides those results. Grow Dusk labels applied loads in kN and positions weights above or below joints according to neighboring members. Shared table shows explicit end connections and reads solver positions for loose endpoints. Graph reachability remains available independently of numerical results.

## Animation and sound requirements

See [animation and sound criteria](animation-criteria.md) for the owner-confirmed magical arena direction, all-action coverage and coordinated sound. The specification includes configurable structural glow/pulse, reduced-motion alternatives, and a distinction between reference geometry, verified deformation and illustrative instability modes. Breaking/removal effects require a matching committed game transition. This is a presentation specification, not a claim that these effects or controls exist.

## Deferred Timburr companion

[Avatar criteria](avatar-criteria.md) define a compact Timburr companion across screens and a proposed temporary Conkeldurr reaction. Live models, pose approval and fallback behavior remain future implementation work. The [prototype handoff](../../prototypes/timburr-companion/README.md) preserves candidate assets and unfinished code in an unapplied patch; it is not part of the current viewer. The available desktop browser could not create a WebGL context, so live character rendering has not been visually validated.

## Joint DOF visualization requirements

Grow Dusk's **Build options → Joint permissions** controls Selected joint / All joints / Off and remembers the mode across reload. It draws an individual compass for each displayed intentional joint, with straight translation marks, rotational arcs, locked stops, free arrowheads and elastic zigzags. A separate striped base identifies ground restraints. The native selector exposes all joint identities, local-frame coordinates and six-axis tables, including world-axis coupling and different attached-end spring stiffnesses. The meanings, physical scope and verification are recorded in [current Joint DOF criteria](joint-dof-criteria.md) and the [implementation ledger](criteria-ledger.md).

## Structural element geometry requirements

[Element representation criteria](element-representation-criteria.md) specify recognizable column/section geometry, axial helical springs, planar two-chord and triangular three-chord trusses, wide flanges, square/rectangular HSS, round HSS and cables. Default sections are slightly enlarged for readability with true-scale inspection. The current renderer primarily uses capsules/boxes with style-dependent widths; it does not meet the full profile/assembly criteria. Procedural shared meshes, LOD, section roll, exposed hollow ends, assembly identity and truthful deformation are future requirements, not shipped behavior.

## Controls, physical clashes and repair feedback

[Controls/camera criteria](controls-camera-criteria.md) define input parity, target disambiguation, reference-grid/quarter selection, safe navigation and accessible inspection. [Placement](placement-criteria.md) distinguishes physical reference clash geometry from enlarged meshes and intentional port contacts. [Failure/repair](failure-repair-criteria.md) requires clear resolved/improved/persistent/unknown markers while retained structures continue in play. The viewer must not infer these rules or claim physical validity from mesh contact.

## Current target interaction and geometry

The latest target is the multiplayer workspace only, with a 15×15 field, 5/7/10 maximum lengths drawn shorter, near-pointer bold/far-faded snap targets and a persistent element inspector. Connections appear only at nodes as rotational DOFs; the two spring variants have two simple endpoint coils. Avatar movement is active screen-space roaming with safe zones. Checkpoint result freshness and tension-outward/compression-inward axial vectors must be explicit. These are new criteria, not assertions about the existing viewer.
