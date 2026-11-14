---
title: "Solver Criteria"
last_validated: 2026-11-14
validated_against:
  - docs/kb/turn-criteria.md
  - "Project owner supplied Solver Criteria, 2026-11-14"
owner: project owner
status: needs-review
---

# Degrees of Freedom — Solver Criteria

**Status:** Proposed implementation requirements. Review against the current repository before starting work. The confirmed model uses a 3D grid and six potential degrees of freedom per node. Other gameplay defaults below are proposals, not established rules.

> **Later gameplay decisions — 2026-11-14:** Read [turn criteria](turn-criteria.md#1-status-and-confirmed-rules) for confirmed draw/play limits, per-end connections, shared access, immutable placed connectors, setup-only foundations, gravity-only persistent loads and the 1-point per-turn issue penalty. These later decisions supersede earlier gameplay proposals in this supplied document. Its numerical requirements remain proposed; this note does not claim implementation.

## 1. Objective

Build a fast, deterministic structural solver for a turn-based game in which 2–4 players each start with a foundation and column, add members and up to two connections per turn, and compete to attract load to their foundations. The structure is shared. Incomplete, unstable and nonlinear configurations are normal gameplay states, not software errors.

The solver evaluates physics; the game engine determines legal moves, scoring and penalties. Do not build a general-purpose commercial FEA package.

## 2. Core model requirements

| ID | Requirement |
|---|---|
| M01 | Use 3D geometry and six potential DOFs per node (UX, UY, UZ, RX, RY, RZ). Activate only physically relevant DOFs; preserve genuine mechanisms. |
| M02 | Separate geometric coincidence from connectivity. Members transfer forces only through intentional connections or explicitly continuous member segments. Each member end has an independently connectable interface. |
| M03 | Support 3D beam-column elements (axial, shear, biaxial bending, torsion), axial braces and tension-only cables. Beams and columns share a formulation. |
| M04 | Represent connection behavior independently in each of six local DOFs: free, rigid or elastic. Include pinned, moment, partial-release and semi-rigid connections as parameter combinations, not separate solvers. Define connection axes and rotation conventions explicitly. |
| M05 | Apply exact rigid constraints rather than artificially large stiffness. Detect redundant or incompatible constraints. |
| M06 | Support configurable restraints at foundations; return all six reaction components with foundation IDs. |
| M07 | Support persistent nodal forces/moments and optional member self-weight. Convert loads consistently without double-counting. |
| M08 | Use card-defined properties (geometry, E, G, A, Iy, Iz, J, relevant capacities, cable rest length or initial strain). Use one documented unit system, coordinate convention and force sign convention. |
| M09 | Use stable IDs for members, connection interfaces, loads and foundations. If interior member attachment is allowed, subdivide the analytical member while preserving continuity, properties, loads and parent card identity. |

## 3. Analysis and stability

| ID | Requirement |
|---|---|
| A01 | Provide a verified small-displacement linear elastic solution as a baseline and fast preview where valid. |
| A02 | Support geometrically nonlinear static analysis: large displacements/rotations with small elastic strains, global P-Delta, member P-delta and tension-only cable activation/slackening. Include sufficient beam-column discretization for member buckling. |
| A03 | Distinguish unused DOFs, disconnected components, rigid-body motions, internal mechanisms, near-mechanisms, load-induced instability, excessive deformation and strength exceedance. Do not classify an unloaded mechanism as stable merely because its residual is zero. |
| A04 | Assess stability using the constrained, appropriately scaled stiffness/tangent stiffness; account for unilateral element states and stress stiffening. Detect and localize relevant modes. A singular initial tangent alone does not prove that no stable nonlinear equilibrium exists. |
| A05 | Attempt bounded nonlinear recovery when appropriate. Use incremental loading, adaptive increments and robust equilibrium iterations. If no verified physical conclusion is possible, return `unresolved`, not `collapsed` or `stable`. |
| A06 | Analyze independent structural components separately. An unsupported or unstable component must not invalidate verified results for unrelated stable components. |
| A07 | Verify equilibrium, compatibility and active cable/connection laws before accepting results. Check forces and moments with documented scaling and tolerances. Never count artificial stabilization reactions as physical foundation reactions. |
| A08 | Handle invalid inputs, singular systems, extreme stiffness ratios and timeouts without exceptions escaping the solver, NaN results or fabricated equilibria. Report explicit diagnostics. |

Preferred implementation: sparse assembly, corotational frame and axial elements, consistent tangent stiffness, Newton iterations with line search/adaptive stepping. Equivalent validated formulations are acceptable. A straight tension-only axial element is the initial cable model; sagged cables with distributed weight require appropriate subdivision or a separate validated cable formulation.

## 4. Turn resolution and failure

Proposed base-game policy: reapply persistent loads to the current topology from the original reference geometry at each completed turn. Preserve committed damage and explicit initial strain. This intentionally allows a new member to attract existing loads; it is not real staged construction.

- Treat the member and connection placements as one transaction. Previews may be incomplete and must not trigger penalties or mutate committed state.
- Run authoritative analysis on every completed turn, using a stable model/version ID. Repeated runs of the same state and analysis policy must produce equivalent results and the same game-relevant classifications.
- Compare member and connection demands against card-defined capacities, including axial-flexural interaction where applicable. Keep strength exceedance separate from instability.
- Return the failed object, governing limit state and utilization. If permanent failure is enabled, apply the defined release/removal and reanalyze with a bounded, deterministic event policy. Do not silently remove members or claim to simulate dynamic collapse.
- Retain unstable structures on the reference grid and report affected regions/modes until gameplay rules determine penalties, removal or repair. No verified equilibrium means no new authoritative reaction score for that component.

## 5. Reactions and result contract

Foundation load attraction comes from equilibrium, geometry, relative stiffness and connectivity—not ownership, graph distance or heuristic load splitting. Return signed vertical reactions, including uplift, and lateral reactions/moments separately. Under gravity alone, valid reactions across all supports must balance the applied weight. Do not normalize missing reactions into a full 100% load share. A separate game policy must decide how uplift, self-weight, pretension, unresolved components and cumulative scoring are treated. Nonlinear load attribution cannot assume superposition.

Expose a solver API independent of UI, cards, player turns and scoring. It receives an immutable analytical model and analysis options; it returns:

- **Analysis:** model version, fidelity, convergence/validity, residuals, runtime and reason codes.
- **Components:** stable, marginal, unstable or unknown; disconnected/unsupported and mechanism flags; valid-result scope.
- **Nodes:** displacement/rotation and participating instability modes, where available.
- **Members/connections:** local forces/moments, relative motion, utilization, slack/active state and failures, where valid.
- **Foundations:** signed six-component reactions and reaction validity.

Unavailable or unverified results must be explicitly marked unavailable, not returned as zero. The viewer should be able to highlight unstable regions, display deformation modes, color demand/capacity and show foundation load shares without reconstructing the physics.

## 6. Speed and surrogate acceleration

Start with the numerical reference solver. Keep a common interface for future graph-based surrogate inference. Use the surrogate for preview and/or nonlinear warm starts; verify authoritative scoring and failure with the reference solver. Detect out-of-distribution inputs and fall back when confidence or physics checks fail. Train and test against diverse topologies, releases, cables, mechanisms and failures; split evaluation by topology families rather than just random states.

Provisional benchmark targets on documented hardware: p95 preview <= 50 ms; ordinary nonlinear turn resolution <= 250 ms; difficult states <= 2 s or explicit unresolved result. Benchmark a representative set of game states and a larger stress suite (e.g., 500 members, 500 connections, roughly 2,000 active DOFs). These are targets to validate, not proven performance. Do not trade correctness for speed silently.

## 7. Acceptance tests

| Benchmark | Required result |
|---|---|
| Axial bar, cantilever, simply supported beam, torsion | Analytical displacements, internal forces and reactions. |
| Parallel springs under a common constrained displacement; symmetric/asymmetric shared frame | Correct stiffness-dependent reaction distribution, including unequal 2–4 player support reactions. |
| Moment, pin, partial release, semi-rigid joint | Correct transmitted/released force and moment components; orientation independence. |
| Unconnected coincident members; disconnected unloaded/loaded components | No accidental connectivity; localized diagnostics; unrelated stable results preserved. |
| 3D triangulated truss and unbraced pin-jointed mechanism | No false singularity from inactive rotations; genuine in-plane/out-of-plane mechanisms detected. |
| Compressed imperfect column; sway frame | Verified critical buckling load and second-order response; mesh convergence. |
| Slack and taut cable; pretensioned cable system; large-deflection cable | No cable compression; correct activation, geometric stiffness and nonlinear equilibrium. |
| Overloaded connection/member and redundant member removal | Correct governing limit state and deterministic redistribution if failure is enabled. |
| Symmetry, node/element reordering, rigid coordinate rotation | Equivalent transformed physical results and classifications. |
| Preview, turn commit, replay, random legal/invalid configurations | No preview mutation; repeatable outcomes; no crashes, NaNs or false valid scores. |

Proposed gates: <= 0.1% relative error on nonzero linear analytical quantities, <= 1% on nonlinear reference quantities, <= 2% on mesh-converged buckling loads, normalized equilibrium residual <= 1e-5 for valid equilibria. Use documented absolute tolerances for expected zeros and characteristic force/moment scales. Require correct classifications on all prescribed fixtures and zero unhandled failures across at least 10,000 seeded generated states. Compare nonlinear cases using identical physical assumptions and load paths. Surrogate preview target: mean absolute foundation reaction error <= 1 percentage point of total applied gravity load on valid held-out cases; additionally report worst/95th percentile error and instability false negatives.

## 8. Implementation order and scope control

1. Model and connection contract; linear kernel and analytical tests.
2. Stability classification and component isolation.
3. Nonlinear frame/cable response and buckling validation.
4. Turn integration, signed reactions, capacity checks and deterministic replay.
5. Optional failure redistribution and additional connection behaviors.
6. Surrogate dataset, inference and validated acceleration.

Defer detailed plasticity, general contact/collision, dynamic collapse, post-buckling path tracing, real staged construction and complex cable formulations unless expressly required. Do not add gameplay rules to the solver. Do not substitute a surrogate for unimplemented reference physics.

Before implementation, read AGENTS.md and docs/kb/README.md, inspect current code/tests and record gaps against these criteria. Preserve existing working features. For each milestone, add regression tests, report pass/fail evidence and update the relevant knowledge base. Do not claim an unsupported capability is complete.

## 9. Gameplay decisions to confirm

Defaults unless the project owner directs otherwise: fixed foundations; cross-player connections allowed; persistent gravity loads; full reanalysis; unstable geometry remains on grid; no automatic collapse. Confirm interior attachment rules, self-weight and uplift scoring, instability penalties, permanent failure/repair, and whether deformed geometry can become permanent. Keep these options outside the physics kernel; document unresolved choices rather than silently inventing final rules.
