---
title: "Solver Criteria Gap Analysis and Milestones"
last_validated: 2026-11-14
validated_against:
  - docs/kb/solver-criteria.md
  - packages/solver-contract/src/index.ts
  - apps/web/src/solver/unavailable.ts
  - apps/web/src/solver/voxelInput.ts
  - apps/web/src/solver/voxel.ts
  - apps/web/src/solver/frameMath.ts
  - apps/web/src/solver/loadPath.ts
  - apps/web/src/solver/voxel.test.ts
  - apps/web/src/solver/frameMath.test.ts
  - apps/web/src/solver/loadPath.test.ts
  - apps/web/src/game/analysis.ts
  - apps/web/src/game/analysis.test.ts
  - apps/web/src/game/store.ts
owner: unknown
status: partial
---

# Solver Criteria Gap Analysis and Milestones

## Baseline and interpretation

This review compares the owner's [proposed solver criteria](solver-criteria.md) with main at `b01a30edd262ad7718220889d30f897450c6c33b`. The criteria retain their proposed status; recording them does not approve unresolved gameplay rules or demonstrate numerical compliance. This documentation change preserves the working voxel experiment and preliminary shared contract. No criteria milestone is complete.

There are two distinct interfaces: `packages/solver-contract/src/index.ts` is a preliminary shared contract whose placeholder returns `unsupported`; `apps/web/src/solver/voxel.ts` implements experimental game-specific analysis through `voxelInput.ts`. Its existing capabilities are useful starting points, not evidence of a verified reference solver. The standalone prototype is context; this review evaluates the workspace implementation.

## Requirement coverage

“Partial” means related code exists, with outstanding semantics or verification. It does not mean an acceptance gate has passed. “Missing” means the reviewed code does not demonstrate the required behavior.

| Criteria | Current evidence | Gap / required work |
| --- | --- | --- |
| M01 — 3D / relevant DOFs | Partial: shared nodes have 3D positions; voxel assembly assigns six DOFs to each free node. | Select physically relevant DOFs without masking genuine mechanisms; verify truss inactive rotations and 3D mechanism fixtures. |
| M02 — intentional connectivity | Missing: voxel endpoints share nodes by coordinate key. | Separate coincidence from connection and give each member end an independently connectable interface. |
| M03 — element families | Partial: `frameK`, `trussK`, frame sections and cable active-set checks exist. | Verify axial, shear, biaxial bending and torsion; expose axial braces and document formulation assumptions. |
| M04 — connection laws | Partial: node `joint` flags select rigid/pinned bending releases in `makeElement`. | Independent six-local-DOF free/rigid/elastic laws, partial release, semi-rigidity, axes and rotation conventions are missing. |
| M05 — exact rigid constraints | Partial: fixed support DOFs are eliminated. | General rigid connection constraints and redundant/incompatible constraint diagnostics are missing. Assembly adds diagonal regularization; this is not proof of physical stability. |
| M06 — foundation restraints | Partial: voxel foundations are fixed and reactions contain six entries. | Configurable restraints, stable foundation IDs and explicit per-reaction validity in the shared contract are missing. |
| M07 — loads / self-weight | Partial: shared nodal forces/moments; voxel generated loads and section self-weight. | Specify persistent load identities, optional self-weight and consistent conversion without double-counting. |
| M08 — properties / conventions | Partial: hard-coded voxel sections contain E, G, A, Iy, Iz, J and simplified capacities; voxel uses metres and kN. | Define card-driven properties, cable rest length/initial strain and complete units/coordinate/sign conventions. Shared `SI` is insufficient. |
| M09 — stable IDs / subdivision | Partial: shared node/member IDs and voxel numeric member IDs exist. | Connection-interface, load and foundation IDs, and any interior subdivision/parent continuity semantics are missing. Interior attachment remains an owner decision. |
| A01 — linear baseline | Partial: linear frame matrices and an axial displacement test exist. | Complete the verified analytical suite, result quantities, conventions and proposed accuracy gates. |
| A02 — nonlinear response | Missing: cable activation iterations, an `alphaCr` estimate and demand amplification are approximations. | They do not implement large-rotation equilibrium with global P-Delta, member P-delta, adaptive stepping and mesh-converged buckling. |
| A03 — classifications | Partial: `floating`, `mechanism`, displacement thresholds and utilization checks exist. | Distinguish unused DOFs, rigid-body/internal modes, near-mechanisms, load-induced instability, excessive deformation and strength exceedance; detect unloaded mechanisms. |
| A04 — tangent stability / modes | Partial: `alphaCr` tests positive definiteness using a geometric stiffness estimate. | Constrained scaled tangent assessment with unilateral states, stress stiffening, localized modes and nonlinear equilibrium interpretation is unverified. |
| A05 — bounded recovery | Missing: cable activity is iterated at most ten times, without a verified nonlinear recovery protocol. | Adaptive load increments, robust equilibrium iterations and explicit `unresolved` results are required. |
| A06 — component isolation | Partial: unsupported nodes are excluded; a test preserves a supported member beside a floating part. | All supported components are assembled together; isolate unstable supported components so unrelated verified results survive. |
| A07 — physical validity | Partial: tower/bridge tests check force balance on three axes. | Runtime force/moment residuals with scaling, compatibility and active-law verification are missing; exclude artificial stabilization from physical accounting. |
| A08 — robust diagnostics | Partial: empty/no-foundation/size errors and failed matrix solves are handled. | Demonstrate malformed-input, extreme-ratio, timeout, cancellation and non-finite handling with explicit reason codes and no escaping failures or fabricated equilibria. |
| Section 4 — turn / failure policy | Missing: store supports voxel edits, undo and persistence, not completed-turn transactions. | Versioned immutable analysis input, non-mutating previews, deterministic replay, scoped authoritative reactions, capacity reporting and optional bounded failure events remain. Existing simplified checks do not establish these policies. |
| Section 5 — result / reactions | Partial: voxel results expose member checks, combination reactions, flags and runtime. | Shared result only has displacements/warnings or unsupported/error. Add fidelity, versions, validity/residuals, reason codes, component scope, modes, connection forces/motions, failures and unavailable values. |
| Section 5 — load attraction | Partial: voxel reactions are recovered from element forces. `loadPath.ts` derives visual routes and shares. | Display shares currently clamp uplift to zero and normalize positive reactions. They are not the proposed signed, applied-load-based authoritative score. Graph routes are visualization, not physics or ownership-based scoring. |
| Section 6 — acceleration / speed | Missing: no surrogate or representative benchmark harness exists. | Establish the numerical reference first, documented hardware and p95 timings, ordinary/difficult workloads, stress suite and timeout validity. Future surrogates need topology-family holdouts, confidence/OOD fallback and reference verification of authoritative results. |
| Section 7 — acceptance suite | Partial: matrix tests, axial displacement, example force balance and load-path/game tests exist. | Full linear/nonlinear/buckling references, connections, mechanisms, transformations, replay and at least 10,000 seeded states are absent. Existing examples do not establish the proposed gates. |

## Implementation milestones and evidence required

Follow [criteria section 8](solver-criteria.md#8-implementation-order-and-scope-control). Keep gameplay and scoring outside the numerical kernel. Do not replace the working experiment with unsupported claims; migrate only capabilities backed by regression evidence.

| Milestone | Deliverable and acceptance evidence | Status |
| --- | --- | --- |
| 1. Contract and linear kernel | Immutable/versioned analytical input; explicit units, axes, connections, constraints, properties and result validity; axial bar, cantilever, simply supported beam, torsion and unequal support reaction fixtures. Report errors against analytical solutions and documented zero tolerances. | Not complete; preliminary types and limited linear evidence only. |
| 2. Stability and isolation | Relevant DOF selection, exact constraint diagnostics, scaled stiffness modes and component-scoped results. Test unloaded/loaded mechanisms, coincident unconnected members, trusses, disconnected parts and unrelated stable components. | Not complete. |
| 3. Nonlinear frame/cable physics | Validated large-displacement frame/axial formulation, consistent tangent, adaptive increments/recovery and unresolved handling. Report column/sway/cable reference errors, force/moment residuals and buckling mesh convergence. | Not complete. |
| 4. Turns, reactions and capacities | Completed-turn transaction with persistent-load policy and stable model ID; signed six-component reactions and unavailable scopes; card limit states/utilization; deterministic replay and preview-mutation tests. | Not complete. |
| 5. Optional failures / connection behaviors | Owner-defined permanent failure policy, bounded deterministic release/removal events and redistribution; overloaded member/connection and redundant-member-removal fixtures. | Not complete; policy requires confirmation before enabling. |
| 6. Optional surrogate | Reference-generated diverse dataset, topology-family evaluation, preview error distribution and instability false negatives; OOD/confidence fallback and physics verification. | Not started. |

For each milestone, record commands, fixtures, physical assumptions/load paths, measured errors, classifications, runtime/hardware and pass/fail evidence in this knowledge base. Proposed gates are <= 0.1% nonzero linear relative error, <= 1% nonlinear reference error, <= 2% mesh-converged buckling error and <= 1e-5 normalized equilibrium residual. Define characteristic force/moment scales and absolute zero tolerances before claiming a pass. Correct prescribed classifications and zero unhandled failures in at least 10,000 seeded generated states are also required. Performance targets and surrogate metrics are specified in the criteria; none are validated by this documentation update.

## Open decisions and deferred work

The six potential DOFs and 3D geometry are confirmed. All other defaults in the supplied criteria retain their proposed status. See [game dynamics](game-dynamics.md#proposed-solver-facing-turn-policy) for turn-policy proposals and owner decisions on interior attachment, scoring, penalties, damage/repair and permanent geometry. Exact units/sign conventions, zero tolerances, characteristic scales, reference sources and the first supported subset must be documented during milestone 1.

Detailed plasticity, general contact/collision, dynamic collapse, post-buckling path tracing, real staged construction and complex cable formulations remain deferred unless expressly required. A surrogate cannot stand in for missing reference physics.
