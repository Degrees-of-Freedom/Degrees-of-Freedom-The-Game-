---
title: "Visualization Criteria"
last_validated: 2026-11-14
validated_against:
  - "Project owner load-path discussion, 2026-11-14"
  - docs/kb/solver-criteria.md
  - docs/kb/turn-criteria.md
  - docs/kb/3d-viewer.md
  - docs/kb/solver-criteria-gap-analysis.md
owner: project owner
status: needs-review
---

# Visualization Criteria

## 1. Purpose and status

This is a design specification, not a description of completed capabilities. The owner wants to help players understand how the structure responds to loads. The primary view is the **calculated deflected shape under simultaneous loading**, colored by calculated deflection magnitude. All displayed analysis quantities must come from calculated results. A directional graph with arrows, tension-versus-compression coloring, and path thickness representing magnitude were also discussed; how they complement the deflected view remains to be decided. Player-based coloring was considered and dropped. The detailed policies below remain proposals for discussion.

The existing viewer has an experimental force-weighted route display based on approximate voxel analysis. It is illustrative, not an independently verified physical load tracing or scoring system. See [3D viewer](3d-viewer.md) and the [solver gap analysis](solver-criteria-gap-analysis.md). The numerical requirements in [solver criteria](solver-criteria.md) and confirmed game rules in [turn criteria](turn-criteria.md) still apply.

## 2. Physics and interpretation

| ID | Proposed requirement |
| --- | --- |
| LP01 | Evaluate the complete connected structure under the selected analysis state. Forces and foundation reactions follow equilibrium, geometry, stiffness, connection behavior and loads, not ownership or graph distance. |
| LP02 | Transfer actions only through intentional joints, member-end connections, continuous member segments and supports. Coincident or crossing geometry alone does not establish a path. Respect each connector's six-axis laws. |
| LP03 | Make valid member-end forces and moments, connection actions, applied loads and signed foundation reactions available with stable object IDs, axes, units, model version and validity. Distinguish tension, compression, shear, torsion and bending where supported by the result. |
| LP04 | Represent branching and redistribution using verified solver results. A member may carry several force components, and a load can be carried through bending as well as axial action; no single scalar or line thickness fully describes the mechanics. Do not imply a unique route through an indeterminate frame. |
| LP05 | Report signed vertical foundation reactions, including uplift, and separately expose lateral forces and moments. Check global force and moment equilibrium against applied loads using documented tolerances. Do not normalize away missing or invalid reactions. |
| LP06 | Scope results by component and validity. Mark disconnected, unstable, unresolved or unsupported regions and unavailable quantities explicitly; preserve verified results for unrelated components. Never present artificial stabilization forces as physical support reactions. |
| LP07 | Reanalyze the completed shared structure under the turn's recorded analysis policy and persistent loads. A change can redistribute forces throughout the structure, including opponents' members. Previews are provisional and do not change the committed result. |
| LP08 | Preserve the distinction between total response and an individual load's contribution. Linear superposition requires a verified linear analysis with compatible boundary conditions and a defined baseline; nonlinear attribution needs an explicit, validated method and must not be presented as an exact unique physical path by default. |

The solver supplies physical quantities and validity; the viewer derives explanatory displays from those quantities. A graph-based route or flow decomposition can be an illustrative aid only if labeled and if its method and limitations are disclosed. It must not create forces, assign authoritative foundation shares, or suggest connectivity that the analytical model does not have.

The intended view is a **directional graph**: arrows trace explanatory branches from applied loads through connected structure toward foundations, in both combined and individual-load views where supported. Derive direction and magnitude using a documented, validated interpretation of the solver results; a complex frame need not have a unique decomposition. Do not imply that arrows represent a time sequence or a verified individual-load contribution when the attribution method cannot establish one. Show unavailable or ambiguous branches explicitly rather than inventing direction or magnitude.

## 3. Player experience

Proposed interaction requirements:

- **Shared overlays:** Present both the deflected shape and the directional load-path graph as selectable overlays on the same structural view. The original geometry provides a shared reference; ghost it when the deflected shape is displayed. Allow the overlays to be shown independently or together, with distinct legends and controls so their quantities and validity are not confused.
- **Deflected shape:** Show the verified displacement of the whole structure under the simultaneous applied loads. Color the deformed geometry continuously by calculated translational displacement magnitude using a SAP-style contour: dark blue for the least displacement, transitioning through cyan, green, yellow and orange to red for the greatest. Show a numerical legend with units and the range represented. Use solver displacements and documented element interpolation appropriate to its formulation; distinguish unsupported or unavailable intermediate results. Overlay the undeformed reference geometry as faint, ghosted lines, with a toggle to control visibility. Display the deformation scale. Color and inspected values represent calculated magnitudes independent of visual exaggeration. Let players inspect displacement components and rotations with units where valid. A static deflected shape is an equilibrium result, not a sequential animation of load travel.
- **Validity and instability:** Show a deflected equilibrium shape only for valid result scope; clearly distinguish unresolved or unstable regions. An instability mode shape is a separate diagnostic, typically with arbitrary amplitude, and must be labeled rather than presented as the actual loaded deformation. Preserve independently verified component results where available.
- **Whole structure:** Show the current combined response and the applied loads and foundations. Make the analysis state, result validity and whether the view is a preview clear.
- **Member inspection:** Select or hover a member to see its relevant force and moment components, units and sign conventions, with its connection and validity information. Visually distinguish tension and compression where the reported axial force is valid; provide a legend and a non-color cue.
- **Branches:** Highlight participating members and joints and their relative actions for a selected quantity. Explain that displayed magnitudes are member actions, not automatically percentages of a particular load. Filters and thresholds must be visible and must not disguise small but significant paths.
- **Color and thickness:** Distinguish tension from compression with color and non-color cues, and show a legend. Vary path thickness with the magnitude of the displayed, defined quantity; explain the scale and distinguish unavailable values from zero. Preserve arrow direction and do not imply ownership changes the physical response.
- **Foundations:** Identify each foundation and owner, show valid signed reactions, and indicate unavailable results. Foundation ownership identifies the recipient for a future game policy; it does not change the physical calculation.
- **Selection:** Let players focus on a load, member or foundation while retaining enough context to understand branching. If individual-load attribution is unavailable, say so and offer the combined response rather than presenting a guessed trace.
- **Change:** Compare compatible committed states or a clearly labeled preview to show changes in forces and foundation reactions. Explain differences in model or analysis policy and do not compare incompatible or invalid quantities as if verified.
- **Accessibility:** Use readable units and labels, a legend, sufficient contrast and non-color distinctions; selection must not depend exclusively on hover.

Exact line-width scaling, arrow styling, animation and color palettes are presentation choices to prototype. Any scaling, thresholds and sign conventions must be visible or discoverable; zero and unavailable are different states. The viewer should not imply forces travel sequentially in time when displaying a static equilibrium.

## 4. Foundation shares and scoring

Physical reactions and game scoring are separate outputs. A possible display for a fully verified gravity-only state is a foundation's signed vertical reaction divided by a clearly defined total applied downward load. State the denominator and whether self-weight is included. Uplift may produce a negative share, and individual shares can exceed 100%; do not clamp and renormalize them into a misleading total. Zero denominators and incomplete or incompatible scope require an unavailable or explicitly partial result.

This is a proposed display metric, not a confirmed scoring rule. Self-weight, uplift, pretension, multiple components, partial validity, accumulated scoring and player ownership need a game policy. Nonlinear results do not establish a unique share of each individual load without a defined attribution method.

## 5. Acceptance scenarios

These are proposed tests for future implementation, not claims of present coverage.

| Scenario | Required result |
| --- | --- |
| Loaded supported column | Show the applied load, connected member action and signed support reaction; verify equilibrium against an analytical case. |
| Deflected shape / scale | Under simultaneous loads, compare displacements and rotations against verified analytical fixtures; the displayed scale and ghosted reference geometry make visual exaggeration clear. The blue-to-red contour and numerical legend match calculated magnitudes and units, including intermediate positions where supported, and do not change with the visual deformation scale. |
| Combined overlays | Deflection and load-path overlays can each be toggled independently or displayed together on the same structure, with readable separate legends and validity indications. |
| Instability mode | Label diagnostic modes and arbitrary amplitude separately from a valid equilibrium deflection; do not invent a deflected equilibrium for unresolved regions. |
| Symmetric and asymmetric supported beam/frame | Verified reactions and member actions match analytical or independently validated references; show participating branches without assuming equal shares. |
| Parallel members with different stiffnesses | Correct stiffness-dependent distribution and a distinguishable change when stiffness or connectivity changes. |
| Frame carrying bending and shear | Show relevant actions without treating an axial-only route as a complete explanation. |
| Coincident unconnected members / released connection | No invented force transfer or visual continuity through the disconnected or released action. |
| Multiple loads | Show combined response; individual contributions only under a documented valid attribution method, with linear contributions checked against superposition where applicable. |
| Direction, force colors and thickness | Arrows follow the documented interpretation in verified simple fixtures; tension/compression indicators preserve direction and magnitude. Thickness follows the stated scale, and unavailable values are distinct from zero. |
| Shared structure / new connection | Reanalysis reflects redistribution across owners and foundations; preview is labeled and committed results remain unchanged until commit. |
| Uplift / zero applied gravity / incomplete results | Signed reaction retained; denominator and unavailable or partial shares handled explicitly without fabricated 100% totals. |
| Unstable or unresolved component alongside a stable component | Mark unknown scope, preserve independent verified results and avoid a fabricated complete route or score. |
| Rotation, reordering and replay | Equivalent transformed physical results and consistent visualization under coordinate changes, stable IDs and the same model/policy version. |
| Keyboard and non-color use | Selection and interpretation remain possible without hover or color alone; legend and units agree with displayed values. |

Use the numerical tolerances and validation approach in [solver criteria](solver-criteria.md); validate the visualization against the same verified result data rather than treating visual agreement alone as proof of physics.

## 6. Decisions to resolve

1. Should the primary view show the combined response, individual load-card contributions, or both? What should happen when individual attribution is not physically well-defined?
2. Which force components should be visible by default, and what validated method derives branch direction and magnitude for mixed actions without implying a unique physical decomposition?
3. How should foundation shares and game scoring treat uplift, self-weight, pretension, incomplete components and a zero denominator?
4. Which comparison views matter during play: previous turn, provisional move, or both? What level of numerical detail should be optional?
5. What visual thresholds, thickness scaling and accessibility controls best serve playtesting? Should players see values for opponents' structures and foundations at all times?
6. Which force and reaction overlays should accompany the selectable deflection and load-path overlays by default? How should deformation scaling and the undeformed reference be controlled?

Record confirmed answers here and update related criteria when decisions affect turns, scoring, solver outputs or the viewer.
