---
title: "3D Viewer"
last_validated: 2026-11-14
validated_against:
  - apps/web/src/viewer
  - apps/web/src/pages/Workspace.tsx
owner: unknown
status: partial
---

# 3D Viewer

The React workspace uses Three.js for a Z-up voxel scene with terrain, orbit and zoom, build planes, member and node picking, and placement. The viewer consumes the Zustand game model; edit validity is checked by game rules. It can show approximate experimental analysis results using deformed positions, member colours, load and reaction arrows, and a force-weighted load-path view. Load paths are illustrative routes derived from the results, not a separate physical analysis. These visualizations inherit the solver's limitations and are not engineering design evidence.

The scene manages the renderer and lifecycle. Separate modules handle picking, input, mesh construction, result overlays, and particle animation.

The full-screen workspace follows the layouts and palettes of Grow, Grow Dusk, Levels, Blocks and Kit from the environment prototype branch. The [unified runtime](unified-runtime.md#environment-mapping) records the mapping and remaining interaction differences. The shared scene renders computed deformation, utilization, load arrows and reaction labels when the current simulation provides those results. Grow Dusk labels applied loads in kN and positions weights above or below joints according to neighboring members. Shared table shows explicit end connections and reads solver positions for loose endpoints. Graph reachability remains available independently of numerical results.
