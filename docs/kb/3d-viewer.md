---
title: "3D Viewer"
last_validated: 2026-11-14
validated_against:
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

The React workspace uses Three.js for a Z-up voxel scene with terrain, orbit and zoom, build planes, member and node picking, and placement. The viewer consumes the Zustand game model; edit validity is checked by game rules. It can show approximate experimental analysis results using deformed positions, member colours, load and reaction arrows, and a force-weighted load-path view. Load paths are illustrative routes derived from the results, not a separate physical analysis. These visualizations inherit the solver's limitations and are not engineering design evidence. The OpenSees stability check appears only as numbers in the analysis panel; the viewer does not yet draw its mechanism shapes or moving nodes.

The scene manages the renderer and lifecycle. Separate modules handle picking, input, mesh construction, result overlays, and particle animation.

The full-screen workspace follows the layouts and palettes of Grow, Grow Dusk, Levels, Blocks and Kit from the environment prototype branch. The [unified runtime](unified-runtime.md#environment-mapping) records the mapping and remaining interaction differences. The shared scene renders computed deformation, utilization, load arrows and reaction labels when the current simulation provides those results. Grow Dusk labels applied loads in kN and positions weights above or below joints according to neighboring members. Shared table shows explicit end connections and reads solver positions for loose endpoints. Graph reachability remains available independently of numerical results.

## Animation and sound requirements

See [animation and sound criteria](animation-criteria.md) for the owner-confirmed magical arena direction, all-action coverage and coordinated sound. The specification includes configurable structural glow/pulse, reduced-motion alternatives, and a distinction between reference geometry, verified deformation and illustrative instability modes. Breaking/removal effects require a matching committed game transition. This is a presentation specification, not a claim that these effects or controls exist.

## Deferred Timburr companion

[Avatar criteria](avatar-criteria.md) define a compact Timburr companion across screens and a proposed temporary Conkeldurr reaction. Live models, pose approval and fallback behavior remain future implementation work. The [prototype handoff](../../prototypes/timburr-companion/README.md) preserves candidate assets and unfinished code in an unapplied patch; it is not part of the current viewer. The available desktop browser could not create a WebGL context, so live character rendering has not been visually validated.

## Joint DOF visualization requirements

[Joint DOF criteria](joint-dof-criteria.md) specify a Selected joint / All joints / Off permissions overlay, global axes by default with a selectable local view, still translation/rotation glyphs with brief demonstrations, and a separate solver-instability overlay. All attached ends at a shared joint must use matching freedoms; foundations are fully fixed by default. These are new criteria, not current viewer or game-rule enforcement. Connection locks describe relative motion, not absolute stability. The current viewer does not establish compliance with this specification.
