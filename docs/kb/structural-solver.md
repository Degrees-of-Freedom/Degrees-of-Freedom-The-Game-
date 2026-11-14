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

## Design decision: connection restraints

The project owner wants all combinations of the six degrees of freedom available for connections. Treating each relative translation and rotation as independently restrained or released gives 2^6 = 64 connection restraint configurations, including fully released and fully restrained. The reference axes, implementation of these restraints, and any limits on where configurations can be used remain to be decided. This is a design decision, not implemented solver behavior.

## Intended starting elements

The project owner wants beams in the game. The team also wants cables and springs, with a limited set of spring stiffnesses, and no compression-only struts. The discussion proposed truss bars alongside beams and columns; their inclusion has not been explicitly confirmed. These are intended elements, not implemented solver behavior.

- **Beam/column:** a frame element that can resist bending and shear as well as axial force. Its exact three-dimensional formulation and properties remain open.
- **Cable:** a tension-only element; its treatment when slack remains to be designed.
- **Spring:** an elastic element with a selection of stiffness values. The values, units, directions, and supported spring behaviors remain open.

The interaction of elements with connection restraints also remains open. Surface elements such as slabs and membranes were discussed as outside the proposed hackathon scope.

## Open questions

- What structural idealization, member types, units, and material properties will be supported? How will connection restraints be oriented and applied?
- How will loads, boundary conditions, stability, and failure be defined and reported?
- What numerical methods, accuracy limits, and reference cases will be used?
- What inputs and results will form the contract with the game and viewer?
