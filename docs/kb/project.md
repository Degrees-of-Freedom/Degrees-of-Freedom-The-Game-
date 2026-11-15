---
title: "Project"
last_validated: 2026-11-14
validated_against:
  - docs/kb/multiplayer-refresh-criteria.md
  - docs/kb/turn-criteria.md
  - docs/kb/game-completion-criteria.md
  - README.md
  - package.json
  - apps/web/package.json
  - apps/web/src
  - services/opensees/README.md
  - prototypes/voxel-struct/README.md
owner: unknown
status: partial
---

# Project

> **Current target revision:** [Multiplayer simplification](multiplayer-refresh-criteria.md) supersedes conflicting older scope/rules on this page. Multiplayer is the only target; four source-selectable draws and unlimited held-card plays replace 2/2 draws and 1/1/2 caps. Structural work runs at configurable three-turn checkpoints plus match end. Only the standard axial/bending member, cable and two k₀ springs are playable; connectors control 1/2/3 rotational restraints. Minimum local safety constraints replace scaffold columns/extra foundations. Existing-code descriptions below remain implementation history, not proof this revision is shipped.


Degrees of Freedom is conceived as a turn-based structural engineering game on a 3D grid. Players are intended to build and test structures to explore force paths and stability. The prototype includes local goal-based modes and a card playtest as documented in the [unified runtime](unified-runtime.md).

An early TypeScript web scaffold now exists, with React, a Zustand store, React Router, and a Three.js viewer. The workspace now includes experimental voxel building tools, challenge rules, and approximate analysis. An OpenSees-backed service provides a second, independent check of stability and degrees of freedom through the shared solver contract. The [turn criteria](turn-criteria.md) record confirmed core rules, proposed connection profiles and remaining decisions. The local Shared table implements draws, staging and commits with experimental analysis; verified penalty comparison, complete final scoring and automatic repair remain future work. See [architecture](architecture.md), [structural solver](structural-solver.md), and [development and testing](development-and-testing.md).

The [core game decision register](game-completion-criteria.md#2-owner-confirmed-decision-register) records confirmed ownership/access, fixed-round final scoring, quarter attachments, assembly plays and permanent neutral local repairs. Exact numerical/catalogue parameters, remaining balance choices, solver selection/deployment and distribution remain open; these target criteria are not implementation claims.

The [original Voxel Struct prototype](../../prototypes/voxel-struct/README.md) is archived in Git history. The maintained implementation is in the workspace; its experimental analysis does not implement the shared solver contract.
