---
title: "Structural Solver"
last_validated: 2026-11-14
validated_against:
  - docs/kb/game-completion-criteria.md
  - README.md
  - packages/solver-contract/src/index.ts
  - packages/solver-contract/src/analysis.ts
  - packages/solver-contract/README.md
  - crates/dof-solver/README.md
  - crates/dof-solver/src
  - apps/web/src/solver/wasm
  - apps/web/src/solver/unavailable.ts
  - apps/web/src/solver/voxelLoads.ts
  - apps/web/src/game/turnAnalysis.ts
  - apps/web/src/solver/voxel.ts
  - apps/web/src/solver/opensees.ts
  - apps/web/src/solver/index.ts
  - apps/web/src/game/structuralModel.ts
  - apps/web/src/game/analysisModel.ts
  - apps/web/src/game/structuralSummary.ts
  - apps/web/src/game/useStabilityCheck.ts
  - apps/web/src/components/StabilityCheckPanel.tsx
  - apps/web/src/game/analysisModel.test.ts
  - services/opensees/README.md
  - services/opensees/src/dof_opensees
  - services/opensees/tests
  - docs/kb/solver-criteria.md
  - docs/kb/element-representation-criteria.md
  - "Project owner element representation catalogue and follow-up answers, 2026-11-14"
  - docs/kb/turn-criteria.md
  - docs/kb/joint-dof-criteria.md
  - docs/kb/solver-criteria-gap-analysis.md
  - "Tania branch commit de5d5be: docs/kb/structural-solver.md"
  - "Tania branch commit b795342: prototypes/voxel-struct/README.md"
owner: unknown
status: partial
---

# Structural Solver

The game intends to communicate load paths, instability, member or connection failure, and structural complexity. The workspace includes an experimental voxel-specific numerical analysis extracted from the standalone prototype. It uses metres and kN internally, frame and cable elements, multiple load combinations, regularization and simplified stability and design checks. It has not been independently validated and is not suitable for engineering design. It is not a shared `SolverAdapter`.

Two backends implement the shared contract, and the workspace uses one of them for a structural check that runs beside the voxel analysis. `useStabilityCheck` picks the contract by what the solver implements: the detailed contract through `toAnalysisModel` when the solver offers it (the Rust solver), and the original contract through `toStructuralModel` otherwise (the OpenSees service):

- A Rust solver in `crates/dof-solver`, compiled to WebAssembly and run in the browser through `createWasmSolver`. It is the default in development and production builds, because it needs no service. See [Rust solver](rust-solver.md).
- An OpenSees service in `services/opensees`, reached through `createOpenSeesSolver`. `VITE_OPENSEES_URL` selects a service by address, and `VITE_SOLVER=opensees` selects the local one on `http://localhost:8000`.

The placeholder adapter, which returns `unsupported`, is used only where WebAssembly is unavailable. `resolveSolver` in `apps/web/src/solver/index.ts` makes the choice, and the stability panel names the solver that produced the check.

## Target requirements and implementation status

The owner-supplied [solver criteria](solver-criteria.md) are the proposed implementation requirements. They specify intentional member-end connectivity, six-axis connection laws, exact rigid constraints, verified linear and nonlinear physics, component-scoped stability and validity, signed reactions, and deterministic turn analysis. Their gameplay defaults, numerical gates, and performance targets remain proposals. The [gap analysis and milestones](solver-criteria-gap-analysis.md) compare them with current code and tests; no milestone is accepted as complete. The Rust solver was written against the criteria, and its [coverage table and evidence](rust-solver.md#coverage-of-the-criteria) are the most complete implementation of them in the repository.

The [turn criteria](turn-criteria.md) now define the confirmed two-deck draw/play limits and per-end connection-card model. The criteria call for comparing the complete structure with the prior committed state. The Shared table currently runs an experimental applied-load solve before committing the draft. The solver preserves member-end identity in fixed and ball connections, releases three rotations at ball connections, and gives unattached ends distinct node IDs even when they coincide with a joint. End turn records stable, unstable, partial or unresolved. Verified before-and-after issue matching and penalties remain pending.

## Member and connection direction from Tania's branch

Tania's `tania` branch records design discussion in commit `de5d5be` and a separate standalone prototype in `b795342`. The branch has not been merged into this baseline. Its discussion records the owner's wish for beams and all combinations of the six independent connection restraints; it also records team interest in tension-only cables and springs with a limited set of stiffnesses, and no compression-only struts. Spring stiffness values, directions, units and behavior remain undefined. Truss bars were discussed there without explicit confirmation. Surface elements were outside the proposed hackathon scope. These are design inputs, not evidence of implemented physics or a finalized deck.

The newer [solver criteria](solver-criteria.md#2-core-model-requirements) propose beam-column elements, axial braces and tension-only cables. The [turn criteria](turn-criteria.md#2-match-setup-and-deck-1) list the current voxel SHS, glulam, IPE, HEB and cable as examples, not finalized cards. An axial brace in those criteria is not a decision to add a compression-only strut; its exact section and allowed force behavior still need definition. The later [element representation decision](element-representation-criteria.md) confirms a standalone axial spring shown as a helical coil, planar two-chord truss assemblies and triangular three-chord assemblies as required visual families. One planar/trichord assembly card per element play and one connection card per external attachment are now confirmed in [placement criteria](placement-criteria.md). Exact deck balance, assembly analytical models and spring constitutive law remain to define; an elastic joint connection is not automatically a standalone spring. The visual catalogue does not silently settle numerical implementation or add compression-only struts.

Tania's six independently restrained/released axes yield 64 binary combinations; the newer [connection proposal](turn-criteria.md#3-deck-2-six-dof-connection-design) extends each axis to free, locked or elastic behavior and describes example presets. Those presets are proposals, not a finalized deck or proof that all combinations are implemented. One confirmed connection card attaches one member end to a shared joint; distinct attachment IDs, compatible common freedoms at each shared joint, physical-axis transforms, exact locks and per-card stiffness/capacity remain necessary under the later [joint DOF decision](joint-dof-criteria.md). Different end releases at one shared joint are no longer an allowed game rule; matching enforcement is not yet implemented. The current voxel node-wide joint flag and OpenSees fixed/pinned end choices do not cover them.

Tania's standalone branch prototype exposes one beam/column and one cable, displays springs as planned but not placeable, and retains legacy section data; its solver uses provisional fixed properties and pinned/moment behavior. This is a separate prototype, not the merged web app's catalog and not a change to the current state schema.

## Required element catalogue and geometry direction

The owner requires structural elements to have recognizable lightweight geometry rather than generic straight lines. **These are new representation requirements, not implemented geometry or newly verified solver capabilities.** Detailed generation, scaling, LOD and acceptance requirements are in [element representation criteria](element-representation-criteria.md).

| Required family | Representation requirement | Solver/model boundary |
| --- | --- | --- |
| Columns | Extrude the actual selected section along the member, preserving physical endpoints and roll. | Column is a role of a beam-column, not a separate arbitrary stiffness or a universal section. |
| Springs | Axial helical coil with short end leads between two explicit endpoints. | Define axial stiffness/law, rest state and attachment semantics; rendered coil geometry alone does not establish stiffness. Distinct from elastic joint laws. |
| Trusses | Planar two-chord assemblies with explicit diagonal/vertical web pattern and open panels. | Not one axial truss bar. Define internal joints, sections, loads, parent identity and analytical expansion/equivalent formulation before analysis. |
| Trichord truss | Three longitudinal chords in a triangular cross-section, joined by face webs. | Define triangle orientation, panels, interfaces and supported assembly formulation; visual webs do not automatically create analytical connectivity. |
| Wide flanges | Open I/H section with two flanges, a web and correct strong/weak-axis roll. | Section properties and material come from the definition/catalogue, not display triangles. |
| HSS | Hollow square/rectangular section with wall thickness and visible inner openings/rims at exposed ends. | Define width, depth, wall thickness and corner convention; do not replace it with a solid bar or infer missing properties. |
| HSS round | Hollow circular section with annular ends, distinct from a cable/solid rod. | Define outside diameter and wall thickness, plus physical properties. |
| Cables | Slender round tube following supported reference/result geometry; optional lightweight strand shading. | Tension-only behavior, rest length/strain and valid sag/deformation require compatible physics. Do not invent a catenary from a visual curve. |

The owner confirmed planar two-chord and triangular three-chord assemblies, axial helical springs, and **slightly enlarged sections by default with a true-scale inspection mode**. Enlargement is a renderer preference only: keep physical endpoints, section data, loads, topology and solver results unchanged. Column role, section family, assembly topology and analytical formulation are distinct concepts. Retain existing working glulam and other families while extending the catalogue.

Use deterministic procedural profiles, indexed meshes, shared materials/geometries, instancing for repeated chord/web members and screen-size-driven LOD. Preserve hollow/open silhouettes, section roll and intentional joint identities. Fine welds, bolts and individual cable strands are not required. True-scale inspection must disclose approximate/missing dimensions rather than certify schematic geometry. Performance budgets are proposals requiring measured evidence, not proof of support.

Current `structureMeshes.ts` primarily substitutes capsules or boxes by presentation style rather than generating these physical section families. Existing `voxelSections.ts` properties do not define every needed wall/flange/coil/assembly dimension. OpenSees still uses its single hard-coded steel section and does not implement standalone springs, these truss assemblies or cable physics. Schema, solver capability, card/connection rules and result mapping need deliberate future integration; generating a mesh must not silently enable analysis. See the [element criteria](element-representation-criteria.md#8-acceptance-criteria-and-delivery-order) for future validation.

## Model and interface today

The shared TypeScript contract defines nodes with 3D positions, members joining node IDs, nodal supports and loads, and an asynchronous `SolverAdapter`. Units are SI base units: metres, newtons, newton-metres, and radians. Supports contain six restraint flags; loads contain force and moment vectors. Each member end may be `fixed` or `pinned`, defaulting to `fixed`.

A result has one of four statuses. `success` contains six displacement values per node and warnings, and may contain support reactions, member forces, and a stability report. `unstable` contains a stability report and no displacements. `unsupported` and `error` contain a message. Member axial force is signed with tension positive; shear, torsion, and end moments are magnitudes. The stability report holds the free DOF count, the number of translational and rotational mechanisms, the degree of static indeterminacy, the nodes involved, and mechanism mode shapes. The interface accepts an optional abort signal. The OpenSees adapter rejects with the `AbortError` from `fetch` when aborted; the contract itself does not specify cancellation behavior.

The project owner decided that a node has six potential degrees of freedom, in global translation X, Y, Z then rotation X, Y, Z order. Constraints may restrain them; this does not mean every element resists all six. The original contract does not define element properties, per-axis or elastic connection behavior, tension-only members, load cases, or failure criteria, and it falls well short of the result contract proposed in the criteria.

A second, detailed contract in `packages/solver-contract/src/analysis.ts` does define them: sections with properties and capacities, beam, brace and cable members, six connection laws per member end, foundations and loads with ids, analysis options, and a result with per-component status, validity, reason codes, modes, signed reactions, member and connection forces, utilisation and explicit `null` for unavailable values. Only the Rust solver implements it, and the workspace now produces it with `toAnalysisModel` in `apps/web/src/game/analysisModel.ts`; see [Game integration](rust-solver.md#game-integration) for what that translation carries and omits. It is a proposal that follows the criteria, not an agreed final interface.

## Rust solver

`crates/dof-solver` is a dependency-free Rust crate. Its [README](../../crates/dof-solver/README.md) is the detailed reference, and the [Rust solver page](rust-solver.md) records its standing against the criteria. In summary:

- It analyses beam-columns, braces and tension-only cables with linear or geometrically nonlinear statics, member self-weight, and six independent connection laws per member end, applied as exact constraints.
- Each connected part of the structure is analysed separately and gets its own status: `stable`, `marginal`, `unstable` or `unknown`. A result is marked valid only after the residual and the global force and moment balance pass a gate.
- Mechanisms are found from null pivots of the scaled stiffness, and load-induced instability from negative pivots of the tangent at the solution. Nothing is stabilised with artificial springs.
- In the workspace it receives the detailed model, with card sections, tension-only cables, self-weight and nonlinear analysis, but with gravity loads only: no wind and no load combinations. The 3D viewer does not use its result yet.
- Through the original contract it makes the same modelling choices as the OpenSees service (one steel section, linear analysis, pinned ends release all rotations), so the two can be compared. A test does that when the service is running, and they agree.

The differences that matter when reading a result from the original contract: the Rust solver counts free DOFs and spin modes over its own internal variables, so `freeDofs` and `rotationalMechanisms` can differ from the OpenSees numbers for the same model, while `translationalMechanisms`, `staticIndeterminacy`, displacements, reactions and member forces agree.

## OpenSees service

`services/opensees` is a Python FastAPI service using OpenSeesPy. It exposes `GET /health`, `GET /capabilities`, and `POST /analyze`. Its [README](../../services/opensees/README.md) is the detailed reference for modelling, the API, configuration, and measured timings. In summary:

- It runs a linear elastic static analysis of the nodal loads in the request. Self-weight, member loads, load combinations, nonlinearity, buckling, cables, and capacity checks are not modelled.
- Every member uses one fixed steel section with equal second moments of area, so results do not depend on member roll.
- Members pinned at both ends are truss elements. Other members are beam-column elements, with a duplicate node tied in translation by an exact constraint to release rotations at a pinned end. A node with no fixed member end has no rotational degrees of freedom.
- Stability is assessed from the free-DOF stiffness matrix read from OpenSees and scaled to a unit diagonal. A Cholesky factorisation confirms a stable model; otherwise an eigendecomposition gives the mechanisms, split into translational and rotational.
- A model is reported `unstable` when it has a translational mechanism, loaded or not, or a rotational mechanism that a load acts on. Unloaded rotational mechanisms, such as a straight rigid run spinning about its own axis, are reported in the stability report and held by very soft springs so the analysis can proceed. The spring forces are not reported as reactions.
- Static indeterminacy is computed as internal force unknowns minus free DOFs plus mechanisms.
- The whole model is one system: an unstable part makes the whole result `unstable`. Components are not isolated.

The workspace reaches the service through the original contract, using `toStructuralModel` in `apps/web/src/game/structuralModel.ts`. That translation follows the voxel rules for connectivity: a member end is rigid where its node has a moment connection and pinned elsewhere, cables are pinned, and foundations restrain all six DOFs. It carries placed point loads but not sections, self-weight, wind, or generated tower and bridge loads, and it sends cables as two-way ties because the contract has no tension-only member. The check therefore reports kinematic stability and determinacy only, and the panel says so.

The OpenSees work predates the [solver criteria](solver-criteria.md) and was not designed against them. The single steel section, the `fixed` default for an unspecified member end, the absence of self-weight, and the tolerance of unloaded spin mechanisms are implementation choices, not owner decisions. The [gap analysis](solver-criteria-gap-analysis.md#opensees-service-addendum) records how the service compares with the criteria.

## Modularity and candidate frameworks

The shared contract is the intended boundary between the game and interchangeable solver adapters. Adapters translate the common model to their backend and must explicitly report unsupported input; an adapter must not silently claim an analysis for features it cannot represent. The OpenSees service rejects unknown request fields for this reason, and its `GET /capabilities` describes what it models, but the contract itself provides no capability discovery or detailed validation schema, so those remain design work.

The OpenSees service and the Rust solver are implemented as described above. Neither has been selected by the project owner as the game solver; the Rust one is the default in the app because it runs without a service. A shared-contract TypeScript solver remains an intended experiment. The voxel TypeScript analysis is a separate game-specific experiment. Deployment of the OpenSees service and the feature set each candidate must support remain open. The Rust solver's runtime is settled as WebAssembly in the browser. Compare candidates against the same agreed model semantics and reference cases before treating their results as interchangeable. Record unsupported features and numerical limitations for each adapter.

Before numerical implementation, decide exact units and coordinate/sign conventions; element and material properties; connectivity and releases; support and constraint semantics; load cases and combinations; analysis type; result quantities and conventions; stability diagnostics; and failure criteria. Establish how invalid models, unsupported features, solver errors, cancellation, and version or capability differences are communicated. The current types alone do not enforce these rules.

## Testing options to work through

[Criteria section 7](solver-criteria.md#7-acceptance-tests) now supplies the proposed benchmark suite and gates: at most 0.1% relative error for nonzero linear analytical quantities, 1% for nonlinear reference quantities, 2% for mesh-converged buckling loads, and normalized equilibrium residual at most 1e-5. Absolute tolerances for expected zeros and characteristic force/moment scales still need specification. These are targets, not demonstrated solver accuracy.

Current web tests cover selected voxel examples, an axial displacement reference, matrix operations, force balance, load-path behavior, the OpenSees adapter, and the game-to-contract translation. The OpenSees service has its own pytest suite, run with `npm run test:opensees`: closed-form cases for an axial bar, a cantilever in four orientations, torsion, a pinned tripod, a simply supported beam and a propped cantilever at a relative tolerance of `1e-6` (`1e-5` where soft springs hold a spin mode); mechanisms and determinacy counts; global equilibrium of reactions; validation errors; and the HTTP layer. The Rust solver has its own suite, run with `npm run test:solver`, with a test for each row of the criteria's acceptance table; the [Rust solver page](rust-solver.md#acceptance-evidence) lists them with measured errors. None of this establishes owner-accepted compliance with the complete criteria, and the nonlinear results have no independent program to compare with. See the [gap analysis](solver-criteria-gap-analysis.md) for requirement coverage and the [development and testing page](development-and-testing.md) for commands and validation evidence.

For each implementation milestone, add analytical or independently trusted reference fixtures, regression tests, and pass/fail evidence. Verify adapter translation, result validity, unsupported inputs, cancellation, and any service integration separately. Compare nonlinear cases under identical physical assumptions and load paths; agreement between implementations alone does not establish correctness.

## Joint freedoms and visualization boundary

The owner’s later [joint DOF decision](joint-dof-criteria.md) requires matching freedoms for all end attachments at the same intentional shared joint. Current Shared table and adapter records still store profiles per end and do not enforce that rule. Future compatibility must account for physical direction, not just matching local flags; different elastic stiffness values are now explicitly allowed for matching freedoms/axes; canonical-frame tolerances and migration remain open. Fully fixed foundations are the confirmed default, with ground restraint kept separate from relative connection freedom. The permissions overlay reads definitions, and the distinct instability overlay reads versioned solver evidence; neither may infer physics from glyphs.

## Quarter ports, assembly plays and retained structures

The later [completion criteria](game-completion-criteria.md) require original-reference quarter-point attachments on every family, including springs/cables, and authorize one assembly card per element play with a connector card for each external attachment. [Placement criteria](placement-criteria.md) require physical clash checks and continuity/rest-state/load/mass-preserving quarter interfaces. A simple two-terminal spring or an equivalent assembly beam does not by itself support arbitrary interior loads. The standard game retains geometry without automatic destructive failure and reports verified repair. These are new targets, not current solver support or numerical validation.

## Automatic game-owned correction versus numerical solving

The owner requires the game to retain a move and apply recorded game-owned repairs for instability/overload, explained by Timburr. The game policy generates a new explicit physical model; the solver verifies its equilibrium/capacities and returns honest validity. A numerical stabilization spring, load deletion or invented reaction is not a physical repair. Shared-joint elastic values may differ with matching freedoms/axes. Final fallback awards attraction from verified components only against total gravity, retaining unavailable force scope; see [repair](failure-repair-criteria.md) and [scoring](scoring-match-criteria.md).


## Permanent neutral local repairs

The latest owner decision allows neutral system scaffolding/ground anchors that stay for the rest of the match. This is a system-only exception to setup-only player foundations. Restrict direct player-object intervention to the affected element/connection, but reanalyze real global redistribution and every relevant capacity. Neutral reactions count in equilibrium and earn no player points; retain total applied gravity as denominator. See [local intervention and lifetime](failure-repair-criteria.md#7-permanent-neutral-repairs-with-local-intervention). Exact geometry, local envelopes and validated repair catalogue remain future implementation work.
