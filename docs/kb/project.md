---
title: "Project"
last_validated: 2026-11-14
validated_against:
  - README.md
  - package.json
  - apps/web/package.json
  - apps/web/src
  - prototypes/voxel-struct/README.md
owner: unknown
status: partial
---

# Project

Degrees of Freedom is conceived as a turn-based structural engineering game on a 3D grid. Players are intended to build and test structures to explore force paths and stability. Goal-based and failure-based modes are concepts, not implemented rules.

An early TypeScript web scaffold now exists, with React, a Zustand store, React Router, and a Three.js viewer. The workspace now includes experimental voxel building tools, challenge rules, and approximate analysis. A turn system and final game rules remain to be implemented. See [architecture](architecture.md) and [development and testing](development-and-testing.md).

Ownership, solver details, distribution, and precise game rules remain open.

The [original Voxel Struct prototype](../../prototypes/voxel-struct/README.md) is archived in Git history. The maintained implementation is in the workspace; its experimental analysis does not implement the shared solver contract. The last archived revision of that prototype also has corner-to-corner unit members, a "flip the force" mode and a six-degree-of-freedom node view, which the workspace does not implement yet.
