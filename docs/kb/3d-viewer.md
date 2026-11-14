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

The web scaffold uses Three.js to display a grid and axes, with orbit and zoom controls. It draws a line for each member whose endpoint nodes exist in the supplied model, a cube at each support, and an arrow for each nodal force. Moment loads and the restraint pattern of a support are not shown. The renderer and camera persist across model and result changes, so the view does not reset.

The viewer also receives the analysis result. For a successful result it colours members by axial force relative to the largest in the model: blue for tension, red for compression, grey near zero. Bending is not visualised, so a member that carries load only in bending looks unstressed. For an unstable result it overlays the first reported mechanism shape in orange and marks the moving nodes. Displaced shapes of stable structures, reactions, and animation are not implemented. Placement and selection are not implemented.

The intended game aims to communicate load paths, instability, and failures. The viewer passes model coordinates straight to Three.js, whose ground grid makes Y the vertical axis; the example structures follow that. This is current behavior, not a recorded decision. Accessibility, presentation, and interaction details remain open.
