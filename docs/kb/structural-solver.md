---
title: "Structural Solver"
last_validated: 2026-11-14
validated_against:
  - README.md
  - packages/solver-contract/src/index.ts
  - packages/solver-contract/README.md
  - apps/web/src/solver/unavailable.ts
  - apps/web/src/solver/voxel.ts
  - apps/web/src/solver/opensees.ts
  - apps/web/src/solver/index.ts
  - apps/web/src/game/structuralModel.ts
  - services/opensees/README.md
  - services/opensees/src/dof_opensees
  - services/opensees/tests
  - docs/kb/solver-criteria.md
  - docs/kb/solver-criteria-gap-analysis.md
owner: unknown
status: partial
---

# Structural Solver

The game intends to communicate load paths, instability, member or connection failure, and structural complexity. The workspace includes an experimental voxel-specific numerical analysis extracted from the standalone prototype. It uses metres and kN internally, frame and cable elements, multiple load combinations, regularization and simplified stability and design checks. It has not been independently validated and is not suitable for engineering design. It is not a shared `SolverAdapter`.

One backend does implement the shared contract: an OpenSees service in `services/opensees`, reached through `createOpenSeesSolver` in the web app. The workspace uses it for a stability and degree-of-freedom check that runs beside the voxel analysis. A development build calls the service on `http://localhost:8000`; `VITE_OPENSEES_URL` overrides that address; a production build without it falls back to the placeholder adapter, which returns `unsupported`, because no deployed service exists.

## Target requirements and implementation status

The owner-supplied [solver criteria](solver-criteria.md) are the proposed implementation requirements. They specify intentional member-end connectivity, six-axis connection laws, exact rigid constraints, verified linear and nonlinear physics, component-scoped stability and validity, signed reactions, and deterministic turn analysis. Their gameplay defaults, numerical gates, and performance targets remain proposals. The [gap analysis and milestones](solver-criteria-gap-analysis.md) compare them with current code and tests; no milestone is accepted as complete.

## Model and interface today

The shared TypeScript contract defines nodes with 3D positions, members joining node IDs, nodal supports and loads, and an asynchronous `SolverAdapter`. Units are SI base units: metres, newtons, newton-metres, and radians. Supports contain six restraint flags; loads contain force and moment vectors. Each member end may be `fixed` or `pinned`, defaulting to `fixed`.

A result has one of four statuses. `success` contains six displacement values per node and warnings, and may contain support reactions, member forces, and a stability report. `unstable` contains a stability report and no displacements. `unsupported` and `error` contain a message. Member axial force is signed with tension positive; shear, torsion, and end moments are magnitudes. The stability report holds the free DOF count, the number of translational and rotational mechanisms, the degree of static indeterminacy, the nodes involved, and mechanism mode shapes. The interface accepts an optional abort signal. The OpenSees adapter rejects with the `AbortError` from `fetch` when aborted; the contract itself does not specify cancellation behavior.

The project owner decided that a node has six potential degrees of freedom, in global translation X, Y, Z then rotation X, Y, Z order. Constraints may restrain them; this does not mean every element resists all six. The contract does not yet define element properties, per-axis or elastic connection behavior, tension-only members, load cases, or failure criteria, and it falls well short of the result contract proposed in the criteria.

## OpenSees service

`services/opensees` is a Python FastAPI service using OpenSeesPy. It exposes `GET /health`, `GET /capabilities`, and `POST /analyze`. Its [README](../../services/opensees/README.md) is the detailed reference for modelling, the API, configuration, and measured timings. In summary:

- It runs a linear elastic static analysis of the nodal loads in the request. Self-weight, member loads, load combinations, nonlinearity, buckling, cables, and capacity checks are not modelled.
- Every member uses one fixed steel section with equal second moments of area, so results do not depend on member roll.
- Members pinned at both ends are truss elements. Other members are beam-column elements, with a duplicate node tied in translation by an exact constraint to release rotations at a pinned end. A node with no fixed member end has no rotational degrees of freedom.
- Stability is assessed from the free-DOF stiffness matrix read from OpenSees and scaled to a unit diagonal. A Cholesky factorisation confirms a stable model; otherwise an eigendecomposition gives the mechanisms, split into translational and rotational.
- A model is reported `unstable` when it has a translational mechanism, loaded or not, or a rotational mechanism that a load acts on. Unloaded rotational mechanisms, such as a straight rigid run spinning about its own axis, are reported in the stability report and held by very soft springs so the analysis can proceed. The spring forces are not reported as reactions.
- Static indeterminacy is computed as internal force unknowns minus free DOFs plus mechanisms.
- The whole model is one system: an unstable part makes the whole result `unstable`. Components are not isolated.

The workspace reaches the service through `toStructuralModel` in `apps/web/src/game/structuralModel.ts`. That translation follows the voxel rules for connectivity: a member end is rigid where its node has a moment connection and pinned elsewhere, cables are pinned, and foundations restrain all six DOFs. It carries placed point loads but not sections, self-weight, wind, or generated tower and bridge loads, and it sends cables as two-way ties because the contract has no tension-only member. The check therefore reports kinematic stability and determinacy only, and the panel says so.

The OpenSees work predates the [solver criteria](solver-criteria.md) and was not designed against them. The single steel section, the `fixed` default for an unspecified member end, the absence of self-weight, and the tolerance of unloaded spin mechanisms are implementation choices, not owner decisions. The [gap analysis](solver-criteria-gap-analysis.md#opensees-service-addendum) records how the service compares with the criteria.

## Modularity and candidate frameworks

The shared contract is the intended boundary between the game and interchangeable solver adapters. Adapters translate the common model to their backend and must explicitly report unsupported input; an adapter must not silently claim an analysis for features it cannot represent. The OpenSees service rejects unknown request fields for this reason, and its `GET /capabilities` describes what it models, but the contract itself provides no capability discovery or detailed validation schema, so those remain design work.

The OpenSees service is implemented as described above; it has not been selected as the game solver. A custom Rust solver and a shared-contract TypeScript solver remain intended experiments. The voxel TypeScript analysis is a separate game-specific experiment. Deployment of the OpenSees service, the runtime for a Rust implementation, and the feature set each candidate must support remain open. Compare candidates against the same agreed model semantics and reference cases before treating their results as interchangeable. Record unsupported features and numerical limitations for each adapter.

Before numerical implementation, decide exact units and coordinate/sign conventions; element and material properties; connectivity and releases; support and constraint semantics; load cases and combinations; analysis type; result quantities and conventions; stability diagnostics; and failure criteria. Establish how invalid models, unsupported features, solver errors, cancellation, and version or capability differences are communicated. The current types alone do not enforce these rules.

## Testing options to work through

[Criteria section 7](solver-criteria.md#7-acceptance-tests) now supplies the proposed benchmark suite and gates: at most 0.1% relative error for nonzero linear analytical quantities, 1% for nonlinear reference quantities, 2% for mesh-converged buckling loads, and normalized equilibrium residual at most 1e-5. Absolute tolerances for expected zeros and characteristic force/moment scales still need specification. These are targets, not demonstrated solver accuracy.

Current web tests cover selected voxel examples, an axial displacement reference, matrix operations, force balance, load-path behavior, the OpenSees adapter, and the game-to-contract translation. The OpenSees service has its own pytest suite, run with `npm run test:opensees`: closed-form cases for an axial bar, a cantilever in four orientations, torsion, a pinned tripod, a simply supported beam and a propped cantilever at a relative tolerance of `1e-6` (`1e-5` where soft springs hold a spin mode); mechanisms and determinacy counts; global equilibrium of reactions; validation errors; and the HTTP layer. None of this establishes compliance with the complete criteria. See the [gap analysis](solver-criteria-gap-analysis.md) for requirement coverage and the [development and testing page](development-and-testing.md) for commands and validation evidence.

For each implementation milestone, add analytical or independently trusted reference fixtures, regression tests, and pass/fail evidence. Verify adapter translation, result validity, unsupported inputs, cancellation, and any service integration separately. Compare nonlinear cases under identical physical assumptions and load paths; agreement between implementations alone does not establish correctness.
