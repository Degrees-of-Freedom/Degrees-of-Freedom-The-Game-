---
title: "Project"
last_validated: 2026-11-14
validated_against:
  - docs/kb/turn-criteria.md
  - README.md
  - package.json
  - apps/web/package.json
  - apps/web/src
  - prototypes/voxel-struct/README.md
owner: unknown
status: partial
---

# Project

Degrees of Freedom is conceived as a turn-based structural engineering game on a 3D grid. Players are intended to build and test structures to explore force paths and stability. The prototype includes local goal-based modes and a card playtest as documented in the [unified runtime](unified-runtime.md).

An early TypeScript web scaffold now exists, with React, a Zustand store, React Router, and a Three.js viewer. The workspace now includes experimental voxel building tools, challenge rules, and approximate analysis. The [turn criteria](turn-criteria.md) record confirmed core rules, proposed connection profiles and remaining decisions. The turn system remains unimplemented. See [architecture](architecture.md) and [development and testing](development-and-testing.md).

Ownership, solver details, distribution, and precise game rules remain open.

The [original Voxel Struct prototype](../../prototypes/voxel-struct/README.md) is archived in Git history. The maintained implementation is in the workspace; its experimental analysis does not implement the shared solver contract.
