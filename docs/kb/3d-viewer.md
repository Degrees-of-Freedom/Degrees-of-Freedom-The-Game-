---
title: "3D Viewer"
last_validated: 2026-11-14
validated_against:
  - README.md
owner: unknown
status: partial
---

# 3D Viewer

## Purpose

Record the intended visual interface and its relationship to the game and solver.

## Documented intent

The game is envisioned on a 3D grid and aims to make structural behavior visible and understandable, including load paths, instability, and failures. Visual presentation and interaction details are not yet specified.

The project owner has identified WebGL as the intended rendering platform. Three.js and React Three Fiber are under consideration for the viewer; their selection is not yet settled or implemented.

## Open questions

- What viewer libraries, coordinate conventions, camera controls, and accessibility features will be used?
- How will players select and place members, connections, supports, and loads?
- How will analysis results and uncertainty be displayed without implying unsupported precision?
- What data and update events will the viewer receive from the game and solver?
