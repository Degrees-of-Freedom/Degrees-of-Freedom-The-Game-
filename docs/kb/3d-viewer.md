---
title: "3D Viewer"
last_validated: 2026-11-14
validated_against:
  - apps/web/src/viewer/Scene.tsx
  - apps/web/src/pages/Workspace.tsx
owner: unknown
status: partial
---

# 3D Viewer

The React workspace uses Three.js for a Z-up voxel scene with terrain, orbit and zoom, build planes, member and node picking, and placement. The viewer consumes the Zustand game model; edit validity is checked by game rules. It can show approximate experimental analysis results using deformed positions, member colours, and load and reaction arrows. These visualizations inherit the solver's limitations and are not engineering design evidence.

The viewer simplifies member shapes and colours compared with the standalone prototype. Accessibility and further presentation details remain open.
