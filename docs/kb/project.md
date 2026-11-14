---
title: "Project"
last_validated: 2026-11-14
validated_against:
  - README.md
  - package.json
  - apps/web/package.json
  - apps/web/src
  - services/opensees/README.md
  - prototypes/voxel-struct/index.html
owner: unknown
status: partial
---

# Project

Degrees of Freedom is conceived as a turn-based structural engineering game on a 3D grid. Players are intended to build and test structures to explore force paths and stability. Goal-based and failure-based modes are concepts, not implemented rules.

An early TypeScript web scaffold now exists, with React, a Zustand store, React Router, and a Three.js viewer. Gameplay and building tools remain to be implemented in that scaffold. An OpenSees-backed analysis service exists, and the workspace can analyse three built-in example structures with it and show stability, degree-of-freedom counts, and member forces. See [architecture](architecture.md), [structural solver](structural-solver.md), and [development and testing](development-and-testing.md).

Ownership, distribution, precise game rules, and several solver modelling choices remain open.

Separately, a standalone single-file prototype in `prototypes/voxel-struct` implements a playable build-and-analyse loop: limited-supply structural items on a voxel grid, tower and bridge challenges, and a linear 3D frame analysis with stability and member design checks. It is not integrated with the scaffold or the solver contract, and whether its rules or solver approach carry over is undecided. See [its README](../../prototypes/voxel-struct/README.md).
