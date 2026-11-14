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

The full-screen workspace follows the layouts and palettes of Grow, Grow Dusk, Levels, Blocks and Kit from the environment prototype branch. The [unified runtime](unified-runtime.md#environment-mapping) records the mapping and remaining interaction differences. Solver overlays apply to supported voxel inputs. Shared table displays explicit end connections and graph reachability while numerical turn results are unresolved.
