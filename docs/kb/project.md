---
title: "Project"
last_validated: 2026-11-14
validated_against:
  - README.md
  - package.json
  - apps/web/package.json
  - apps/web/src
  - prototypes/voxel-struct/index.html
owner: unknown
status: partial
---

# Project

Degrees of Freedom is conceived as a turn-based structural engineering game on a 3D grid. Players are intended to build and test structures to explore force paths and stability. Goal-based and failure-based modes are concepts, not implemented rules.

An early TypeScript web scaffold now exists, with React, a Zustand store, React Router, and a Three.js viewer. Gameplay, building tools, and structural analysis remain to be implemented in that scaffold. See [architecture](architecture.md) and [development and testing](development-and-testing.md).

Ownership, solver details, distribution, and precise game rules remain open.

Separately, a standalone single-file prototype in `prototypes/voxel-struct` implements a playable build-and-analyse loop: limited-supply structural items on a voxel grid, corner-to-corner unit members, tower, bridge, "pick up the floating weights" and "flip the force" challenges, a linear 3D frame analysis with stability and member design checks, and a load-path view. It is not integrated with the scaffold or the solver contract, and whether its rules or solver approach carry over is undecided. See [its README](../../prototypes/voxel-struct/README.md).
