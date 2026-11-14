---
title: "Structural Solver"
last_validated: 2026-11-14
validated_against:
  - README.md
  - packages/solver-contract/src/index.ts
  - packages/solver-contract/README.md
  - apps/web/src/solver/unavailable.ts
  - apps/web/src/solver/opensees.ts
  - apps/web/src/solver/opensees.test.ts
  - apps/web/src/solver/index.ts
  - services/opensees/README.md
  - services/opensees/src/dof_opensees
  - services/opensees/tests
owner: unknown
status: partial
---

# Structural Solver

The game intends to communicate load paths, instability, member or connection failure, and structural complexity. One solver backend exists: an OpenSees service in `services/opensees` with a client adapter in the web app. The workspace Run analysis button sends the current model to it and shows the result. A development build calls the service on `http://localhost:8000`; `VITE_OPENSEES_URL` overrides that address; a production build without it falls back to the `unavailable` placeholder adapter, because no deployed service exists.

## Model and interface today

The shared TypeScript contract defines nodes with 3D positions, members joining node IDs, nodal supports and loads, and an asynchronous `SolverAdapter`. Units are SI base units: metres, newtons, newton-metres, and radians. Supports contain six restraint flags; loads contain force and moment vectors. Each member end may be `fixed` or `pinned`, defaulting to `fixed`.

A result has one of four statuses. `success` contains six displacement values per node and warnings, and may contain support reactions, member forces, and a stability report. `unstable` contains a stability report and no displacements. `unsupported` and `error` contain a message. Member axial force is signed with tension positive; shear, torsion, and end moments are magnitudes. The stability report holds the free DOF count, the number of translational and rotational mechanisms, the degree of static indeterminacy, the nodes involved, and mechanism mode shapes.

The project owner decided that a node has six potential degrees of freedom, in global translation X, Y, Z then rotation X, Y, Z order. Constraints may restrain them; this does not mean every element resists all six. The project owner also stated that everything is steel and members are not sized.

The contract does not define element properties, load cases, or failure criteria. The interface accepts an optional abort signal. The OpenSees adapter rejects with the `AbortError` from `fetch` when aborted; the contract itself does not yet specify cancellation behavior.

## OpenSees service

`services/opensees` is a Python FastAPI service using OpenSeesPy. It exposes `GET /health`, `GET /capabilities`, and `POST /analyze`. Its [README](../../services/opensees/README.md) is the detailed reference for modelling, the API, configuration, and measured timings. In summary:

- It runs a linear elastic static analysis of the nodal loads in the request. Self-weight, member loads, load combinations, buckling, and capacity checks are not modelled.
- Every member uses one fixed steel section with equal second moments of area, so results do not depend on member roll.
- Members pinned at both ends are truss elements. Other members are beam-column elements, with a duplicate node releasing rotations at a pinned end. A node with no fixed member end has no rotational degrees of freedom.
- Stability is assessed from the free-DOF stiffness matrix read from OpenSees. A Cholesky factorisation confirms a stable model; otherwise an eigendecomposition gives the mechanisms, split into translational and rotational.
- A model is reported `unstable` when it has a translational mechanism or a rotational mechanism that a load acts on. Unloaded rotational mechanisms, such as a straight rigid run spinning about its own axis, are reported in the stability report and held by very soft springs so the analysis can proceed.
- Static indeterminacy is computed as internal force unknowns minus free DOFs plus mechanisms.

The web adapter `createOpenSeesSolver` in `apps/web/src/solver/opensees.ts` posts a model to the service and returns the result. It converts network failures and unexpected responses to `error` results. `resolveSolver` in `apps/web/src/solver/index.ts` picks the adapter from build-time configuration. With no configured origins, the service accepts browser requests from any port on localhost.

These modelling choices were made to produce a working backend. The default end fixity, the section properties, and the absence of self-weight have not been confirmed as game rules by the project owner.

## Modularity and other candidates

The shared contract is the boundary between the game and interchangeable solver adapters. Adapters translate the common model to their backend and must explicitly report unsupported input; an adapter must not silently claim an analysis for features it cannot represent. The OpenSees service rejects unknown request fields for this reason. `GET /capabilities` describes the service, but the contract itself has no capability discovery.

A custom Rust solver and a TypeScript solver remain intended experiments, not implemented or selected solutions. The standalone prototype in `prototypes/voxel-struct` contains its own in-browser frame solver with different semantics (several materials and sections, design checks, load combinations); it does not use the contract. Compare candidates against the same agreed model semantics and reference cases before treating their results as interchangeable. Record unsupported features and numerical limitations for each adapter.

Still to decide: whether pinned or fixed is the default connection in the game; whether self-weight applies; load cases and combinations; failure criteria; how near-mechanisms and second-order instability are treated; how the game requests analysis each turn; and where the service is deployed.

## Testing

The OpenSees service has automated tests, run with `npm run test:opensees`:

1. Closed-form reference cases: axial bar in tension and compression, cantilever tip load in four orientations, cantilever torsion, a pinned tripod, a simply supported beam, and a propped cantilever. Displacements, reactions, and member forces are compared with hand formulas at a relative tolerance of `1e-6`, or `1e-5` where soft springs hold a spin mode.
2. Mechanisms and determinacy: out-of-plane folding of two bars, sway of a pinned portal and its braced and rigid variants, rigid-body motion of an unsupported structure, a moment on a pin joint, a loaded node with no members, and redundancy counts.
3. Global equilibrium of reactions against applied loads on a 27-node frame.
4. Validation errors, unused nodes, a fully restrained model, and an empty model.
5. The HTTP layer, including schema rejection and CORS.

The web adapter has Vitest tests with a stubbed `fetch`. When `VITE_OPENSEES_URL` is set, two further tests call a running service: a cantilever, and the three example structures, which must come back stable and determinate, unstable with four mechanisms, and stable.

Not yet covered: comparison with an independently trusted benchmark beyond hand formulas, a second adapter run on the same cases, and the Docker image. See [development and testing](development-and-testing.md) for commands.
