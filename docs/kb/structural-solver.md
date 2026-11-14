---
title: "Structural Solver"
last_validated: 2026-11-14
validated_against:
  - README.md
owner: unknown
status: partial
---

# Structural Solver

## Purpose

Record the intended structural analysis behavior and decisions as they are made.

## Documented intent

The game aims to communicate load paths, instability, member or connection failure, and structural complexity. Players are intended to change members, connections, supports, and loads. The README does not specify an analysis method or claim a solver exists.

## Design decision: node degrees of freedom

The project owner decided that the structural model will use six degrees of freedom per node: translation along the global X, Y, and Z axes, and rotation about those axes. These are potential movements; supports, connections, and other constraints may restrict them. The choice does not imply that every member or connection resists all six movements, or that a solver is implemented.

## Open questions

- What structural idealization, member and connection types, units, and material properties will be supported?
- How will loads, boundary conditions, stability, and failure be defined and reported?
- What numerical methods, accuracy limits, and reference cases will be used?
- What inputs and results will form the contract with the game and viewer?
