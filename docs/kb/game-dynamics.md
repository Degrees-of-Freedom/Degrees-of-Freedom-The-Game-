---
title: "Game Architecture and Turn Dynamics"
last_validated: 2026-11-14
validated_against:
  - README.md
owner: unknown
status: partial
---

# Game Architecture and Turn Dynamics

## Purpose

Record the intended gameplay and the decisions governing game state and turns.

## Documented intent

The project owner wants turn-based play. Players are envisioned placing structural members and connections, applying loads, and developing a structure over time. The README proposes goal-based challenges and a mode that continues until instability or failure. The sequence and rules of turns, scoring, and additional modes remain open.

Each player starts by placing a foundation and a column on that foundation. The column is fully fixed at its foundation connection. Foundation and column dimensions, placement constraints, and the sequence of these initial placements remain open.

The owner wants NPCs in the game. Their roles, behavior, and relationship to turns and structures remain to be designed.

Zustand is under consideration for client state management; it has not been selected or implemented.

## Open questions

- What actions are legal on a turn, and when are they validated or committed?
- When does analysis run, and how do results affect subsequent turns and victory or failure?
- How are players, game state, history, persistence, and any multiplayer behavior represented?
- What are the precise objectives, scoring, and constraints for each mode?
- What do NPCs do, and how do they interact with players and structures?
