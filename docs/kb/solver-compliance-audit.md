---
title: "Solver Compliance Audit: OpenSees Nonlinear Service"
last_validated: 2026-11-14
validated_against:
  - docs/kb/README.md
  - docs/kb/solver-criteria.md
  - docs/kb/turn-criteria.md
  - docs/kb/joint-dof-criteria.md
  - docs/kb/element-representation-criteria.md
  - docs/kb/failure-repair-criteria.md
  - docs/kb/placement-criteria.md
  - docs/kb/scoring-match-criteria.md
  - docs/kb/structural-state.md
  - docs/kb/structural-solver.md
  - docs/kb/solver-criteria-gap-analysis.md
  - docs/kb/code-standards.md
  - AGENTS.md
  - packages/solver-contract/src/index.ts
  - services/opensees/DESIGN.md
  - services/opensees/src/dof_opensees/schema.py
  - services/opensees/src/dof_opensees/properties.py
  - services/opensees/src/dof_opensees/model.py
  - services/opensees/src/dof_opensees/builder.py
  - services/opensees/src/dof_opensees/engine.py
  - services/opensees/src/dof_opensees/nonlinear.py
  - services/opensees/src/dof_opensees/stability.py
  - services/opensees/src/dof_opensees/tangent.py
  - services/opensees/src/dof_opensees/results.py
  - services/opensees/src/dof_opensees/app.py
  - services/opensees/tests/test_engine.py
  - services/opensees/tests/acceptance/test_linear_reference.py
  - services/opensees/tests/acceptance/test_nonlinear_reference.py
  - services/opensees/tests/acceptance/test_connection_laws.py
  - services/opensees/tests/acceptance/test_component_isolation.py
  - services/opensees/tests/acceptance/test_invariance.py
  - services/opensees/tests/acceptance/test_generated_states.py
  - services/opensees/tests/acceptance/accept_linear_models.py
  - services/opensees/tests/acceptance/accept_nonlinear_models.py
  - services/opensees/tests/acceptance/accept_generators.py
  - services/opensees/benchmarks/README.md
  - services/opensees/benchmarks/run_benchmarks.py
  - apps/web/src/solver/opensees.ts
  - apps/web/src/evaluator/sections.ts
  - apps/web/src/game/structuralModel.ts
  - apps/web/src/game/solvers.ts
  - apps/web/src/pages/Workspace.tsx
owner: unknown
status: needs-review
---

# Solver Compliance Audit: OpenSees Nonlinear Service

This is an independent audit of the geometrically nonlinear OpenSees service on branch `feature/nonlinear-solver`. It compares the service against the [solver criteria](solver-criteria.md) and the solver-facing parts of the other criteria pages. It records findings; it changes no requirement and claims no fix.

**State audited.** Committed `HEAD` was `174d9bf`. The working tree also held uncommitted edits by another session: `nonlinear.py` gained a prestress equilibration stage, and the test generator was changed. These edits appeared while the audit was running. Probes D1 to D3 were rerun on both versions. D1 was also run against a clean export of `HEAD` and gave the same result. The full test run happened while the edit was in progress, so the code it exercised may be either version.

**Evidence.**
- The full service suite was run with `uv run pytest -p no:cacheprovider tests`: 444 passed and 4 skipped, in 263 s. Generated states were left at the default count of 300.
- Probe scripts called `dof_opensees.engine.analyze` directly. The scripts are outside the repository, so they are described here in enough detail to repeat.
- The benchmark harness ran once with `--states 40 --stress-runs 3`.

## 1. Verdict

**The service is not yet built to spec.**

**Met, with tests:**
- The small-displacement linear baseline: closed-form fixtures pass at a relative error of 1e-4 or better.
- Component isolation.
- Geometric separation of coincident members.
- The result contract's rule that unavailable means absent.
- Signed six-component reactions.
- Exception containment.
- Determinism.
- The nonlinear references the tests do exercise: column buckling, P-Delta and elastica.

**Not met:**
- The default fidelity is nonlinear. At that fidelity, every beam end joined through a duplicate node fails to reach a verified result: ball (pinned) joints, semi-rigid joints, elastic couplers, and partial releases on axis-aligned members.
- At nonlinear fidelity, ordinary cable-braced structures that start at zero cable strain also return `unresolved`.
- A mechanism held only by a slack cable is reported `stable`.
- Self-weight produces wrong member forces and reaction moments.
- The time budget is not honoured.
- Capacities, utilisation and limit states are absent.
- Stable IDs for ends, ports, loads and foundations are absent.
- Quarter-point attachment, springs and assemblies are absent.
- The 10,000-state gate is not met.

**Cannot be judged:**
- Surrogate requirements, because there is no surrogate.
- Performance on documented hardware, because the machine was shared and noisy.

The service fails in the safe direction in most cases: it says `unresolved`. Exceptions are D3 and D6, where it fabricates a classification, and D4 and D8, where it reports wrong numbers or reason codes.

The game does not yet use this service for turns. `Workspace.tsx` sets `contractCompatible` false in multiplayer, so Shared-table turns never reach the service.

## 2. Requirement-by-requirement status

"Met" means code that does it and a test that would fail if it did not. Where only one of the two exists, the row says so.

### Core model (M01 to M09)

| Requirement | Status | Evidence | Missing or wrong |
| --- | --- | --- | --- |
| M01 six DOFs per node, only relevant DOFs active, genuine mechanisms kept | Partly met | `model._relevant_rotations`, `model._anchor_twist`. Tests: `test_component_isolation.py::test_unbraced_pin_jointed_frame_has_one_inplane_mechanism` and `::test_two_pinned_bars_in_a_plane_have_the_out_of_plane_mechanism`; tripod and tetrahedron in `test_linear_reference.py` | Collinear chains of beams spin about their own axis, and this is reported as a mechanism (D6). Skew joints hold rotation about some axes only and are refused (D7). A moment load on a brace-only joint keeps all three rotations, which inflates the mechanism count to 3 (D11). |
| M02 coincidence is not connectivity; each end independently connectable | Met | `model._partition`. Tests: `test_two_cantilevers_with_coincident_tips_share_nothing`, `test_member_touching_another_member_without_a_shared_node_transfers_nothing`, `test_unattached_member_end_at_a_shared_node_stays_out_of_the_component` | — |
| M03 3D beam-column, axial brace, tension-only cable; beams and columns share a formulation | Partly met | `builder.add_beam` (`elasticBeamColumn`), `builder._add_axial` (`Truss`/`corotTruss`, cable material `Elastic(E,0,0)`) | Under nonlinear fidelity a beam with a ball or elastic end does not solve (D1). |
| M04 per-axis free/rigid/elastic laws; matching freedoms; transforms and rotation conventions explicit | Partly met | `model._representation`, `builder._end_node`. Tests: `test_connection_laws.py`, linear fidelity only | Torsion release with bending locked (`LLLFLL`) and other partial patterns are `unsupported` on skew members. Every non-shared representation fails at nonlinear fidelity (D1). The large-rotation convention for elastic springs is undefined and gives no warning (D10). There is no joint-owned canonical frame in the contract. |
| M05 exact constraints, not large stiffness; detect redundant or incompatible constraints | Partly met | Exact constraints come from `equalDOF`, element releases and `fix` (`builder.py`). Recovery springs are removed before results (`nonlinear._Springs.remove`) | Redundant or incompatible constraint detection is limited to "at most one support per node" (`model.prepare`). There is no diagnosis of redundant constraints. |
| M06 foundations fully fixed by default; six reactions with foundation IDs; neutral repair support class | Partly met | The web translation defaults supports to six restraints (`structuralModel.ts`). Reactions come from `engine._read`, keyed by node | The contract has no foundation ID, owner or neutral/system support class. The default is a property of the web translation, not of the contract or service, where `restrained` is required. |
| M07 persistent nodal forces and moments; optional self-weight without double counting | Partly met | Nodal loads in `builder.build`. Self-weight is lumped half and half per element. Tests: `test_self_weight_*` in `test_linear_reference.py` | Lumping drops fixed-end forces, so a fixed-fixed beam reports zero end moment, zero shear and zero reaction moment (D4). The tests check only cases where lumping happens to be exact. |
| M08 card properties (E, G, A, Iy, Iz, J, capacities, rest length or initial strain); one unit, axis and sign convention | Partly met | `MemberProperties` in the contract and schema. Conventions are in the contract header. Inertia mapping is verified (section 3) | There are no capacities. Cable state is initial strain only, with no rest length. |
| M09 stable IDs for members, assemblies, parts, ends, ports, loads, foundations; quarter-point attachment | Not met | Node and member IDs only | Ends, ports, loads, foundations and assemblies have no IDs. There are no quarter ports. The richer `structural-state` snapshot in the contract package has some of these, but the service does not consume it. |

### Analysis and stability (A01 to A08)

| Requirement | Status | Evidence | Missing or wrong |
| --- | --- | --- | --- |
| A01 verified linear baseline and fast preview | Met | `engine._analyse_linear`. `test_linear_reference.py`, `test_engine.py` (closed forms, rel 1e-4 to 1e-6) | Preview p95 is measured only on small states (section 4). |
| A02 large displacement and rotation, P-Delta, member P-delta, cable activation and slackening, member discretisation | Partly met | Corotational transformation; `builder.required_segments`; `engine._analyse_nonlinear` refinement. Tests: `test_nonlinear_reference.py` (Euler, bowed column, sway, elastica, arc) | D1 and D2 make common topologies unanalysable. Cable activation from zero strain fails the branch check (D2). |
| A03 distinguish unused DOFs, disconnected, rigid-body, internal, near-mechanism, load-induced, excessive deformation, strength; unloaded mechanism never stable | Partly met | `engine._mechanism_reason`, `stability.assess`, `nonlinear._Driver.run` (an unloaded mechanism is unstable) | A slack-cable mechanism is reported `stable` (D3). False mechanisms in D6 and D8. Strength exceedance is absent. Excessive deformation is flagged only if the caller gives a limit. |
| A04 constrained, scaled tangent; unilateral states; stress stiffening; localised modes; singular reference is not proof | Partly met | `stability._scaled`, `tangent.extract_tangent`; the reference uses a coarse corotational build with initial strain | A cable at exactly zero strain counts as active, with full E, in the tangent (`builder.py` docstring), so unilateral states are not accounted for (D3). The Cholesky test on the load path cannot detect exact singularity (`tangent.is_positive_definite` docstring). |
| A05 bounded recovery; incremental and adaptive; `unresolved` when unverified | Partly met | `nonlinear._Driver.load_path`, `.recover`, `.bracket`. Tests: `test_unpretensioned_cable_pair_is_recovered_from_singular_reference`, `test_exhausted_time_budget_is_unresolved_not_success` | Outcomes are honest but over-conservative: stable structures come back `unresolved` (D1, D2). |
| A06 components analysed separately; unrelated results preserved | Met | `engine._guarded` per component. Tests: `test_stable_component_is_unaffected_by_an_unstable_neighbour`, `test_mechanism_does_not_invalidate_independent_stable_component` | — |
| A07 verify equilibrium, compatibility, cable and connection laws; no artificial reactions | Partly met | `engine._finish`, `engine._equilibrium_residual` (global resultant ≤ 1e-5); cable compression check | Only the component's global force and moment resultant is checked, not nodal equilibrium (D9). Convergence is a displacement-increment test only (`nonlinear.Settings.displacement_tolerance`). The artificial-reaction rule is met: recovery springs are removed, and removed rotations are masked out of reactions so any force they carried would show up as residual. |
| A08 no escaping exceptions, NaN or fabricated equilibria; extreme stiffness ratios; timeouts | Partly met | `engine.analyze` try/except; `nonlinear.solve`; `_finish` finiteness check. Generated-state test (300 states) | Linear fidelity ignores the time budget, and nonlinear overruns it (D5). A stiffness ratio of about 5e8 gives a fabricated `internal_mechanism` (linear) or `geometrically_stiffened` (nonlinear) (D8). |

### Section 4: turn resolution and failure

| Requirement | Status | Evidence | Missing or wrong |
| --- | --- | --- | --- |
| Reapply persistent loads from reference geometry; preserve damage and initial strain | Not applicable to the solver (game engine) | The solver accepts explicit initial strain | Damage descriptors are not in `StructuralModel`. |
| Placement transaction; previews do not mutate | Not applicable to the solver | `analyze` is a pure function of the request | — |
| Authoritative analysis with model version; repeatable results and classifications | Met | `analysis.modelVersion` echoed; `test_repeated_analysis_is_identical`; every tenth generated seed rerun | Only same-process repeats are tested. |
| Capacity comparison, including axial-flexural interaction; strength kept separate from instability | Not met | None | There are no capacities in the contract and no checks in the service. |
| Failed object, governing limit state, utilisation; bounded failure policy if enabled | Not met | None | Permanent failure is outside the standard mode, but limit state and utilisation are still required. |
| Retain unstable structures; report regions and modes; no reaction score without equilibrium | Met | `unstableNodeIds` and `modes` (`engine._instability`); results only for valid components (`results.assemble`) | — |

### Section 5: reactions and result contract

| Requirement | Status | Evidence | Missing or wrong |
| --- | --- | --- | --- |
| Reactions from equilibrium; signed vertical and lateral reactions and moments | Partly met | `engine._read`; linear reaction tests including uplift (`test_shared_beam_frame_reactions_follow_stiffness`) | Reaction moments are wrong under self-weight (D4). |
| Gravity-only reactions balance applied weight | Met | Residual gate in `_finish`; translational balance check in `test_generated_states.py` | Moment balance is not checked in generated states. |
| API independent of UI, cards and turns | Met | `schema.py`, `app.py` | — |
| Analysis: version, fidelity, validity, residuals, runtime, reason codes | Met | `results.assemble` | The effective options actually used (segment counts, timeout) are not recorded. |
| Components: state, flags, valid scope | Met | `ComponentResult` | — |
| Nodes: displacement and rotation; instability modes | Met | `displacements`; `modes` | — |
| Members and connections: local forces and moments, relative motion, utilisation, slack/active, failures | Partly met | `MemberForces` (signed axial; magnitudes for the rest); cable state | There are no connection results, relative motion, utilisation or failures. Forces are magnitudes, not local components. |
| Foundations: signed six-component reactions and validity | Partly met | Reactions per supported node; validity through the component | There is no foundation ID or owner class. |
| Unavailable results marked, never zero | Partly met | `results.assemble` omits invalid components. Spot-checked by the generated-state invariants | Valid-looking zeros for beam forces under self-weight (D4). |

### Section 6: speed and surrogate

| Requirement | Status | Evidence | Missing or wrong |
| --- | --- | --- | --- |
| Common interface for a future surrogate | Partly met | `SolverAdapter` in the contract; registry in `solvers.ts` | There is no surrogate or out-of-distribution fallback. That is milestone 6, deferred. |
| Preview p95 ≤ 50 ms | Cannot judge | 41 ms p95 on 40 small generated states (section 4) | Not run on representative game states or documented hardware. |
| Ordinary nonlinear turn ≤ 250 ms | Not met | 2.3 s p95 on 40 generated states | — |
| Difficult ≤ 2 s or explicit `unresolved` | Not met | Stress frame: linear 4.0 to 8.1 s returning `success`; nonlinear 2.5 to 3.2 s before `unresolved` | D5. |
| Benchmark representative set and ~500-member stress suite | Partly met | `benchmarks/run_benchmarks.py` (490 members, 2100 DOFs) | No recorded results file in the repository. |

### Section 7: acceptance tests

| Row or gate | Status | Evidence | Missing or wrong |
| --- | --- | --- | --- |
| Axial bar, cantilever, simply supported beam, torsion | Met | `test_linear_reference.py::test_axial_beam_bar`, `::test_cantilever_tip_load`, `::test_simply_supported_beam_midspan_load`, `::test_torsion_of_cantilever`; closed forms at rel 1e-4 | Shear and moment are magnitudes, so their signs are untested. |
| Parallel springs; symmetric and asymmetric shared frame, 2 to 4 supports | Met | `test_linear_reference.py` lines 281 to 519 | Linear fidelity only. |
| Moment, pin, partial release, semi-rigid; orientation independence | Partly met | `test_connection_laws.py` (aligned and skew frames) | Linear fidelity only; at nonlinear fidelity these fail (D1). `LLLFLL` on skew members is skipped. |
| Unconnected coincident members; disconnected loaded and unloaded components | Met | `test_component_isolation.py` | — |
| 3D triangulated truss; unbraced pin-jointed mechanism; no false singularity from inactive rotations | Partly met | Tripod and tetrahedron; mechanism tests | A false rotational singularity on collinear chains (D6). |
| Compressed imperfect column; sway frame; verified buckling; mesh convergence | Partly met | `test_column_above_euler_load_is_unstable_at_critical_factor` (perfect columns, 2% gate), `test_bowed_column_midspan_amplification`, `test_sway_cantilever_second_order` | No imperfect-column limit load, no sway-frame buckling load, no refinement study (only 1 versus 3 members). |
| Slack and taut cable; pretension; large-deflection cable | Partly met | `test_taut_cable_carries_tension`, `test_compressed_cable_goes_slack_and_beam_carries_load`, cable-pair tests | A cable-braced truss fails (D2); a slack-cable mechanism is called stable (D3). The largest deflection is a two-bar pair sagging about 5% of span. |
| Overloaded connection or member; redundant member removal | Not met | None | No capacity model. |
| Symmetry, reordering, rigid rotation | Met | `test_invariance.py` | Metamorphic only: a consistently wrong solver would pass. |
| Preview, turn commit, replay, random legal and invalid configurations | Partly met | Determinism test; `test_generated_states.py`; `test_invalid_models_return_error` | Preview and commit are game-side. Random states: see the gates below. |
| Gate: ≤ 0.1% linear analytical error | Met (for fixtures present) | `accept_linear_models.REL = 1e-4` | — |
| Gate: ≤ 1% nonlinear reference error | Met (for fixtures present) | `test_nonlinear_reference.NONLINEAR_GATE = 0.01`; independent references in `accept_nonlinear_models.py` | — |
| Gate: ≤ 2% mesh-converged buckling | Partly met | `BUCKLING_GATE = 0.02` | Perfect columns only; convergence is not demonstrated. |
| Gate: equilibrium residual ≤ 1e-5 | Partly met | `engine.EQUILIBRIUM_TOLERANCE`; `check_equilibrium` in the nonlinear tests | Global resultant only (D9). |
| Gate: documented absolute zero tolerances | Met | `check_zero`, `near_zero` (1e-6 × named scale) | — |
| Gate: correct classifications on all prescribed fixtures | Not met | Probes D3, D6, D8 | — |
| Gate: zero unhandled failures in ≥ 10,000 seeded states | Not met | Default is 300 (`test_generated_states.py:41`). Only exceptions escaping `analyze` count as failures: internal failures become `solver_error`/`error` and pass. Line 332 asserts something that is always true | Classification correctness is not checked. Pinned-beam nonlinear states (D1) are generated and pass as `unresolved`. |
| Gate: surrogate reaction error ≤ 1 percentage point | Not applicable to the solver | No surrogate exists | — |

### Sections 8, 10 and 11

| Requirement | Status | Evidence | Missing or wrong |
| --- | --- | --- | --- |
| §8 milestone order; regression tests; pass/fail evidence; knowledge base updated | Partly met | Milestones 1 to 3 in progress, with tests | `structural-solver.md` still says the service is linear, without cables or self-weight, and holds spin modes with soft springs. `solver-criteria-gap-analysis.md` still lists A02 as "Nothing". No pass/fail evidence is recorded in the knowledge base. This contradicts AGENTS.md. |
| §8 no gameplay rules in solver; no claim of unsupported capability | Partly met | No game rules in the service. `/capabilities` lists patterns honestly | `DESIGN.md` says twist anchoring is the only replaced law, which is false (D11). `/capabilities` presents ball and semi-rigid as supported at both fidelities (D1). |
| §10 axial springs, planar and trichord assemblies: define laws, validate, report unsupported | Not met | `MemberKind` is `beam`, `brace` or `cable` only | A spring or assembly cannot be expressed. The schema rejects unknown kinds as a 422 `error`, not `unsupported`. |
| §11 neutral repair: verify explicit corrected models; neutral reactions in equilibrium; no stabilisation counted as support | Partly met | Explicit added members and supports are analysed like any other. Recovery springs never reach results | There is no support-owner class to separate neutral reactions. That separation could be done by the game through node IDs, but the contract does not carry it. |

### Solver-facing requirements from other pages

| Requirement (source) | Status | Evidence | Missing or wrong |
| --- | --- | --- | --- |
| Six-axis `L`/`F`/`E` profile per attachment (turn §3) | Partly met | Contract `MemberEndConnection` | See M04. |
| Matching freedoms in physical axes at a shared joint via a canonical joint frame (turn §3, joint-DOF §3) | Not met | Laws are in member local axes; no joint frame | Enforcing the match is the game's job. Transforming laws from a joint frame is the contract's and solver's job, and it is missing. |
| Large-rotation relative-motion and spring conventions defined and validated before nonlinear use (turn §3) | Not met | `zeroLength` springs keep their reference orientation (`builder._end_node`); only `ALIGNED` ends warn (`engine._analyse`) | D1, D10. |
| Unattached end transfers nothing (turn §3) | Met | `UNATTACHED` representation; isolation tests | — |
| Rigid connector gives no bending to an axial member (turn §3) | Met | `model._member`; `test_rotational_laws_on_axial_members_are_ignored` | — |
| Irrelevant rotations neither stiffened nor taken as mechanisms (turn §3, joint-DOF §2) | Partly met | Rotation removal and twist anchoring add no stiffness | D6, D11. |
| Different elastic stiffness per attachment, retained individually (turn §3) | Met (code) | Per-end `stiffness` | No test with differing stiffnesses at one joint. |
| Whole structure with independent components; unrelated results preserved (turn §5) | Met | See A06 | — |
| Strength exceedance separate from instability (turn §5, failure §2) | Not met | None | — |
| Unresolved is distinct and never a physical classification (turn §7, failure §2) | Met | The `unknown` state has `resultsValid` false | — |
| Regularised solve never yields a valid force field (failure §2, joint-DOF §7) | Met | Recovery springs are removed before results; `test_unpretensioned_cable_pair_is_recovered_from_singular_reference` | — |
| Unloaded mechanism can still be unstable (failure §2) | Partly met | Unloaded mechanisms are `unstable` | Exception: a slack-cable mechanism (D3). |
| Quarter ports on every family; segmented cables (placement §3) | Not met | None | — |
| Spring and assembly formulations, or explicit unsupported (element-representation §4) | Not met | None | — |
| Unavailable not zero; neutral reactions in equilibrium (scoring §2, §3) | Partly met | See §5 | D4. |
| Adapter preserves IDs, records solver version and effective options, rejects unsupported (structural-state) | Partly met | `analysis.solver`; `unsupported` messages | Effective options are not recorded. No adapter consumes the `StructuralSnapshot` format. |
| Web translation matches voxel meaning (code-standards: adapters must not change meaning) | Partly met | `structuralModel.ts` | 3D diagonals become `unsupported` (D7). Every cable gets the prototype's 25 kN pretension (D12). Shared-table games are not routed to the service. |

## 3. Defects

Ranked by severity. Unless stated otherwise, each was confirmed by a probe that calls `analyze(StructuralModel.model_validate(...))`.

**D1 (critical; confidence high).** At nonlinear fidelity, which is the default, a beam end joined through a duplicate node never yields a verified result.

- **Smallest scenario:** one default-section beam `a`–`b` of 3 m, `startFixity: pinned`, `endFixity: pinned`. `a` is restrained in translation and `b` in UY and UZ. A 1 kN axial load is applied at `b`.
  - Linear fidelity: `success` with an axial force of 1000 N.
  - Nonlinear fidelity: `unresolved` with `not_converged`.
- **Propped cantilever:** fixed at `a`, roller at `b`, 20 kN at midspan. Linear gives R_b = 6250 N, which is 5P/16. At nonlinear fidelity:
  - `LLLFFF` (ball), `LLLEEE` (semi-rigid, 1e6 N·m/rad) and `LLLFLL` (aligned partial) all return `unresolved`.
  - `LLLLFF` (element-release hinge) returns 6250 N.
- **Common factor:** the duplicate node tied by `equalDOF` (representations `BALL`, `SPRING_TIED`, `SPRING`, `ALIGNED` in `model.py`). A fixed/pinned beam also fails.
- **Where it fails:**
  - With the branch check on, each forward step's reverse step returns a zero correction, and `_Driver.step` rejects the step as `_JUMPED`.
  - With `verify_branch=False`, the converged state fails `equilibrium_not_verified`.
  - So the corotational solution with `equalDOF` duplicates is wrong or misread. The verification layer correctly refuses to report it.
- **Reproduced:** on a clean export of `HEAD` `174d9bf` and on the working tree.
- **Why the tests miss it:**
  - `test_connection_laws.py` runs at linear fidelity only.
  - The nonlinear fixtures use fixed members, supports and braces only.
  - Generated states with pinned beams return `unresolved`, which the generated-state test accepts.

**D2 (high; confidence high).** The branch-reversibility check (`nonlinear._Driver.step`) rejects steps of structures whose stiffness at zero load depends on a cable at zero strain.

- **Scenario:** a pin-jointed portal of braces, with columns `a`–`c` and `b`–`d` (3 m) and top chord `c`–`d` (4 m). Bases are restrained in translation, tops in UY. One cable `a`–`d` (E = 160 GPa, A = 4.5e-4 m²) has zero initial strain. A load of +1 kN UX at `c` puts the cable in tension.
  - Statics gives a cable force of 1250 N.
  - Result: `unresolved`, `not_converged`. The same holds with 100 kN gravity added.
  - With `verify_branch=False` the result is `success`, with cable force 1250.02 N (1271 N with gravity). So the physics converges and the branch check causes the failure.
- **Likely mechanism:** the reverse step returns the cable to zero strain, where its tangent is discontinuous, so Newton fails and the step is classed as a jump.

**D3 (high; confidence high).** A mechanism held only by a slack or zero-strain cable is reported `stable`.

- **Unloaded case:** the D2 portal with no load gives `success`, component `stable`, `cable_slack`, 0 mechanisms, at both fidelities. Physically the frame sways freely in the direction that shortens the cable.
- **Linear, pretensioned case:** with initial strain 1e-4 and 100 kN gravity, linear fidelity gives `stable` with the cable reported slack, axial 0.
- **Cause:** `builder.py` notes that `Elastic(E, 0, 0)` has full modulus at exactly zero strain. The reference and final assessments therefore count a cable as stiff, while `_read` reports it slack (axial ≤ 1e-12 EA).
- **Spec breached:** A03 and A04 (unilateral states). The verdict could also mask a real instability in game play.

**D4 (high; confidence high).** Self-weight is lumped onto nodes without fixed-end forces (`builder.build`).

- **Scenario:** a 6 m default-section beam fixed at both ends, with `selfWeight: true` (w = 577 N/m).
- **Result:** `success` at both fidelities with:
  - reaction at `a` = [0, 0, 1731, 0, 0, 0];
  - member `shear` = 0;
  - `momentStart` = `momentEnd` = 0.
- **Correct values:** shear wL/2 = 1731 N, end moment and reaction moment wL²/12 = 1731 N·m.
- **Spec breached:** M07 and section 5 (wrong values presented as valid). The existing self-weight tests use cantilevers and simple spans, where lumping happens to be statically exact.

**D5 (medium-high; confidence high on code, medium on magnitude given machine load).** The time budget is not enforced.

- `engine._analyse_linear` never consults the budget.
- The benchmark stress frame (490 members, 2100 DOFs, default 2000 ms budget) returned `success` in 4.0 to 8.1 s at linear fidelity.
- At nonlinear fidelity it returned `unresolved` only after 2.5 to 3.2 s. The dense reference classification and the linear preview are not interruptible.
- **Spec breached:** A08 and section 6 ("≤ 2 s or explicit unresolved").

**D6 (medium; confidence high on behaviour, medium on interpretation).** A collinear chain of beams that spins about its own axis is reported as a mechanism.

- **Scenario:** two collinear beams `a`–`m`–`b`, fixed to each other at `m`. The ends at `a` and `b` are `LLLLFF` (the web translation's default end) or `pinned`, on supports restrained in translation only. A vertical load acts at `m`.
- **Result:** `unstable`, `rigid_body_mechanism`, one rotation mode about the beam axis, at both fidelities.
- **Inconsistency:** a single member in the same position has its spin removed by `_anchor_twist` and is reported stable. `_relevant_rotations` keeps the axis-aligned held rotation and never applies the single-attachment reduction it uses for skew axes.
- **Spec question:** turn §3 and joint-DOF §2 say irrelevant rotations must not be taken as mechanisms. A genuine torsional rigid-body spin is arguably real. The owner should rule (section 5), but the current behaviour is inconsistent either way.

**D7 (medium; confidence high).** 3D diagonals sent by the web translation are refused.

- **Scenario:** a column `a`–`c` and a diagonal `c`–`b` along (1,1,0) plus a vertical offset, all ends `LLLLFF`.
- **Result:** `unsupported`, with the message "Node 'c': members 'col', 'diag' hold its rotation about some skew axes only". Cause: `model._relevant_rotations`.
- Any voxel model with a non-moment joint where a 3D diagonal meets a member not lying on that diagonal's global planes is unanalysable.

**D8 (medium; confidence high).** Extreme stiffness ratios produce fabricated classifications.

- **Scenario:** a cantilever of two 3 m beams, the second with E scaled by r.
  - r ≈ 5e6: `marginal`, `near_mechanism`.
  - r ≈ 5e8: linear gives `unstable`, `internal_mechanism` (2 modes); nonlinear gives `success` with `geometrically_stiffened`.
- Neither verdict is true, because the structure is a stable cantilever. The zero threshold in `stability.ZERO_EIGENVALUE` is relative to the unit-diagonal scaling. A08 asks for explicit diagnostics instead.

**D9 (medium; confidence high on code, not demonstrated as a false pass).** Equilibrium verification checks only the summed force and moment of each component (`engine._equilibrium_residual`), not per-node residuals.

- Newton convergence is a displacement-increment norm (`NormDispIncr`, 1e-10 × model size).
- Nodal residuals that cancel globally would pass.
- A07 asks to verify equilibrium and compatibility.

**D10 (medium; confidence high on code).** Elastic connection springs are `zeroLength` elements oriented on the reference member axes. Their relative rotation is the componentwise difference of nodal rotations.

- Under corotational analysis these neither rotate with the member nor measure a proper relative rotation.
- `engine._analyse` warns only for `ALIGNED` ends.
- Turn §3 requires the convention to be defined and validated before nonlinear use. The defect is currently hidden behind D1.

**D11 (low-medium; confidence high).** The design note and the code disagree.

- `DESIGN.md` says twist anchoring "is the only place the service replaces a requested law". However, `model._relevant_rotations` lines 423 to 426 also set to free the rotational laws of a single rotational attachment on a skew axis. The replacement is statically exact, but it is undisclosed.
- A moment load at a joint whose held rotations span nothing keeps all three rotations: a brace-only joint loaded about Z reports 3 rotational mechanisms instead of 1. `test_moment_on_a_brace_only_joint_cannot_be_carried` asserts only `status == "unstable"`.

**D12 (low; confidence high).** `structuralModel.ts` `translateMember` sets `initialStrain = P0/(EA)` with P0 = 25 kN for every cable. The turn criteria §2 table, a proposal, says not to apply the prototype's 25 kN to every cable. The translation notes do not mention it.

**D13 (low; confidence high).** The knowledge base is stale against the code.

- `structural-solver.md` lines 86 and 90 say no nonlinearity, cables or self-weight, and soft spin springs.
- `solver-criteria-gap-analysis.md` lists A02 as "Nothing".
- `DESIGN.md` is not cited by any knowledge-base page.

**D14 (low; confidence high).** `test_generated_states.py` has weaknesses:
- It runs 300 states by default.
- It accepts `solver_error` and `error`, so internal failures pass.
- It skips the residual check when `residual` is absent.
- It checks no classification correctness.
- Line 332 asserts something that is always true.

`test_invariance.py` reorder and rename tests never assert that the base case succeeded.

**D15 (low; confidence high; documented).** At linear fidelity, a mechanism whose only brace is a cable in compression returns `unknown`, `not_converged`, not `unstable`. Example: the D2 portal with −1 kN UX. This is documented in DESIGN.md and is weaker than A03 asks, but safe.

**Checks that passed:**
- **Inertia and local axes.** A 4 m cantilever along X with Iy = 8.356e-5 and Iz = 6.04e-6, under a −1 kN UZ tip load:
  - with `orientation` (0,1,0), which the web sends for horizontal members, gives uz = −PL³/(3EIy) exactly;
  - with no orientation (local Y = global Z) gives −PL³/(3EIz) exactly.

  `builder.add_beam` passes `A, E, G, J, Iy, Iz` in OpenSees order, with `vecxz` = contract local Z. So the contract rule, the builder and the web mapping agree: catalogue Iy is the strong axis for gravity on horizontal members.
- **Units.** The kN to N conversion in `structuralModel.ts` is correct.

## 4. Performance against section 6

**Conditions.**
- Measured by this audit with `uv run python benchmarks/run_benchmarks.py --states 40 --stress-runs 3`.
- Windows 11 (10.0.26200), Intel64 Family 6 Model 189, Python 3.12.14, OpenSeesPy 3.8.0.
- The machine was shared with other work, so timings are noisy and not on documented hardware.

**Results.**
- **Ordinary linear** (40 generated states, timeouts removed): p50 14.6 ms, p95 41.0 ms, max 104.7 ms. Statuses: 24 unstable, 15 success, 1 unsupported.
- **Ordinary nonlinear** (same 40 states): p50 118 ms, p95 2321 ms, max 2664 ms. Statuses: 20 unstable, 15 success, 4 unresolved, 1 unsupported. The target is ≤ 250 ms.
- **Stress nonlinear** (490 members, 2100 DOFs, 3 runs): 2538 to 3166 ms, all `unresolved`. This is above the 2 s budget.
- **Stress linear** (same frame): 3963 to 8077 ms, all `success`, despite the 2000 ms default budget.

**Not measured.**
- Representative game states.
- Repeat runs on quiet hardware.
- A preview path, because the game does not call the service for turns.
- Concurrency with several workers.
- Surrogate metrics.

No benchmark results are recorded in the repository.

## 5. Open decisions for the owner

1. **Spin of collinear beam chains** about their own axis when no support restrains torsion: is it a genuine mechanism to report, and penalise, or an irrelevant rotation to remove (D6)? The same question applies to the voxel default end `LLLLFF`.
2. **Large-rotation convention** for elastic connection laws, and whether relative rotation is measured in the joint frame or the member-end frame (turn §3; D10). Until this is decided, elastic connections cannot be claimed under nonlinear fidelity.
3. **Unilateral stability at zero cable strain:** should a structure that relies on an unstressed cable be classed as stable, marginal or unstable, and what pretension threshold makes a cable count (D3)?
4. **Unresolved results:** whether an `unresolved` result on a structure a simpler model shows is stable is acceptable as the authoritative turn result, given that unresolved earns no reaction score (D1, D2).
5. **Capacity model:** names, interaction formula and utilisation definitions, so that strength exceedance can be implemented (section 4, M08).
6. **Contract scope:** whether the service must consume the `StructuralSnapshot` format, which carries end, connection, load and foundation IDs, before compliance can be claimed against M06 and M09. The same decision covers a joint-owned canonical frame and a neutral support-owner class.
7. **Self-weight policy** for the scored preset: proposed off. Whether member loads must carry fixed-end forces when it is on (D4).
8. **Budget semantics:** whether the 2 s figure is a hard wall-clock limit including preparation and the dense reference classification (D5).
9. **Excessive deformation:** a default displacement limit. Currently there is none, so the flag never fires unless the caller gives one.
10. **Generated-state gate:** confirmation that it runs at 10,000 states and counts `solver_error` and `error` on legal inputs as failures.
