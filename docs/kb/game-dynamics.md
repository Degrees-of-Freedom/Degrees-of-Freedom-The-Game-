---
title: "Game Architecture and Turn Dynamics"
last_validated: 2026-11-14
validated_against:
  - README.md
  - Project owner mode decisions, 2026-11-14
  - prototypes/voxel-struct/index.html
owner: unknown
status: partial
---

# Game Architecture and Turn Dynamics

## Purpose

Record the intended gameplay and the decisions governing game state and turns.

## Documented intent

The project owner wants turn-based play. Players are envisioned placing structural members and connections, applying loads, and developing a structure over time. The sequence and rules of turns and scoring remain open.

The owner has named four intended modes:

- **Experimental:** Freely draw a structure and use the solver to explore its load path when stable.
- **Adversarial:** Battle a friend, starting from a foundation and a fixed column. Each player is envisioned placing a foundation and a column fully fixed to it; dimensions, placement constraints, and initial placement sequence remain open.
- **Forensic:** Start with an unstable structure and add or remove pieces until it works.
- **Design:** Start with a set of loads and build a structure to respond to them.

The standalone prototype now has a mode selection screen. Experimental opens its existing free-build sandbox; this is a starting approximation, not a full implementation of the intended mode. The other three choices are unavailable. The README's goal-based and failure-based modes are earlier starting concepts; their relationship to these four modes remains open.

The owner wants NPCs in the game. Their roles, behavior, and relationship to turns and structures remain to be designed.

Zustand is under consideration for client state management; it has not been selected or implemented.

## Open questions

- What actions are legal on a turn, and when are they validated or committed?
- When does analysis run, and how do results affect subsequent turns and victory or failure?
- How are players, game state, history, persistence, and any multiplayer behavior represented?
- What are the precise objectives, scoring, and constraints for each mode?
- What do NPCs do, and how do they interact with players and structures?
