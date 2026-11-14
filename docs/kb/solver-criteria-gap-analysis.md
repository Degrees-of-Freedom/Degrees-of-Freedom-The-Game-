---
title: "Solver Criteria Gap Analysis and Milestones"
last_validated: 2026-11-14
validated_against:
  - docs/kb/element-representation-criteria.md
  - docs/kb/joint-dof-criteria.md
  - docs/kb/turn-criteria.md
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
  - services/opensees/README.md
  - services/opensees/src/dof_opensees
  - services/opensees/tests
owner: unknown
status: partial
---

# Solver Criteria Gap Analysis and Milestones

## Baseline and interpretation

This review compares the owner's [proposed solver criteria](solver-criteria.md) with main at `b01a30edd262ad7718220889d30f897450c6c33b`. The criteria retain their proposed status; recording them does not approve unresolved gameplay rules or demonstrate numerical compliance. This documentation change preserves the working voxel experiment and preliminary shared contract. No criteria milestone is complete.

There are two distinct interfaces: `packages/solver-contract/src/index.ts` is a preliminary shared contract whose placeholder returns `unsupported`; `apps/web/src/solver/voxel.ts` implements experimental game-specific analysis through `voxelInput.ts`. Its existing capabilities are useful starting points, not evidence of a verified reference solver. The standalone prototype is context; this review evaluates the workspace implementation.

## Later confirmed turn decisions

The coverage table below is a historical review against the stated `b01a30e` baseline, not a fresh audit of later refactoring. Since that review, the owner confirmed the [turn rules](turn-criteria.md#1-status-and-confirmed-rules): two draws per deck, optional 1-element/1-load/2-connection plays, per-end attachments, shared access without editing placed connections, starting foundations only, persistent gravity loads and a 1-point deduction once per turn for verified new/worsened issues. Unchanged issues and unresolved results do not trigger deductions. These decisions supersede the earlier statement that all other gameplay defaults are unconfirmed; they do not complete any solver milestone.

See [open turn decisions](turn-criteria.md#9-questions-still-to-resolve) for remaining policy choices and [structural solver](structural-solver.md) for current implementation context.

## OpenSees service addendum

The coverage table below was written against the baseline above, before the OpenSees service in `services/opensees` and the extended shared contract were merged. Where the table says the shared contract has only displacements and a placeholder, read it together with this addendum. The service was built before the criteria were recorded and was not designed against them. It does not complete any milestone.

| Criteria | What the OpenSees service provides | What is still missing or differs |
| --- | --- | --- |
| M01 | Six DOFs per node; rotations of pure pin joints are left out of the system; genuine mechanisms are kept and reported. | Activation follows member end fixity only. |
| M02, M04 | Each member end is independently `fixed` or `pinned`. | No separation of coincidence from connectivity, no per-axis free, rigid or elastic laws, no semi-rigid or partial releases, no connection axes. |
| M03 | Beam-column and axial truss elements. | No tension-only cable; the game translation sends cables as two-way ties. |
| M05 | Pinned beam ends use exact equal-displacement constraints, not large stiffness. | No detection of redundant or incompatible constraints. Unloaded spin modes are held by soft artificial springs. |
| M06 | Six signed reaction components per supported node id. | No foundation objects distinct from nodes. |
| M07, M08 | Nodal forces and moments in SI units. | No self-weight. One hard-coded steel section instead of card-defined properties. |
| A01 | Linear elastic solution with closed-form tests for axial, bending, torsion, truss and propped-beam cases. | Parallel-spring, shared-frame, reordering and rotation-invariance fixtures are not written. |
| A02 | Nothing. | All nonlinear analysis, P-Delta, buckling and cable activation. |
| A03, A04 | Mechanisms found from the constrained, diagonally scaled stiffness matrix, with mode shapes and the nodes involved; translational mechanisms are unstable whether loaded or not. | Unloaded pure-rotation mechanisms are reported but tolerated, which may not satisfy A03 as written. No near-mechanism grading, no distinction between disconnected components and internal mechanisms, no stress stiffening. |
| A06 | Nothing. | One unstable component makes the whole result `unstable`. |
| A07 | A test checks global force and moment balance of reactions; spring forces are excluded from reported reactions. | No runtime residual check or validity flag in the result. |
| A08 | Semantic errors, schema rejection and size limits return explicit results. | No timeout, no reason codes; an unexpected solver exception returns HTTP 500, which the web adapter reports as an error result. |
| Section 5 | Displacements, reactions, member force magnitudes, stability counts and modes. | Model version, fidelity, residuals, runtime, component scope, utilization, connection forces, and explicit unavailable markers. |
| Section 6 | Single timings in the service README: about 70 ms at 600 free DOFs and 1.7 s at 2,688. | Not a benchmark; dense matrix extraction scales with the cube of the DOF count and misses the proposed stress target. |

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

## Later shared-joint freedoms and overlay decision

The later [joint DOF criteria](joint-dof-criteria.md) supersede any earlier interpretation that permits differing end-release profiles at one shared joint. Attachments remain per end, while their freedoms must match in physical axes; foundations are fully fixed by default. Historical coverage tables above remain historical evidence. Current per-end fixed/ball records and the preliminary contract do not enforce the common-profile rule or define canonical joint-frame/elastic matching and legacy migration. Permission glyphs and separately scoped solver mode visualization remain implementation gaps. The decision revises M04/game semantics and does not complete a milestone.

## Later element representation catalogue

[Element representation criteria](element-representation-criteria.md) add a required visual catalogue and lightweight generation/LOD/true-scale requirements. The historical table remains a baseline review, not evidence of these capabilities. Current style-dependent capsule/box meshes do not provide full profile/assembly fidelity; the preliminary contract and service also lack standalone spring/assembly definitions and per-section properties. Numerical integration, identity mapping, card rules, geometry fixtures and performance evidence remain future work.
