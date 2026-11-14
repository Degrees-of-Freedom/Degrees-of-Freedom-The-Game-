---
title: "3D Viewer"
last_validated: 2026-11-14
validated_against:
  - README.md
  - prototypes/voxel-struct/index.html
  - prototypes/voxel-struct/README.md
owner: unknown
status: partial
---

# 3D Viewer

## Purpose

Record the intended visual interface and its relationship to the game and solver.

## Documented intent

The game is envisioned on a 3D grid and aims to make structural behavior visible and understandable, including load paths, instability, and failures. The owner wants a visual feel inspired by Townscaper and an all-steel structural palette; the specific art direction and interaction details are not yet specified.

The project owner has identified WebGL as the intended rendering platform. Three.js and React Three Fiber are under consideration for the eventual viewer; their selection for the game is not yet settled.

The separate Voxel Struct prototype uses Three.js for an interactive 3D grid and groups editing tools and items into provisional libraries. New beam choices are steel, cables have their own group, and a disabled spring entry indicates planned work. Legacy saved models and examples can still contain timber. Six independent connection restraints are not implemented. Its catalog is not the final game element selection; see its README for the prototype's capabilities and limitations.

## Open questions

- What viewer libraries, coordinate conventions, camera controls, and accessibility features will be used?
- How will players select and place members, connections, supports, and loads?
- How will analysis results and uncertainty be displayed without implying unsupported precision?
- What data and update events will the viewer receive from the game and solver?
