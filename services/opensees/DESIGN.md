# OpenSees service design: contract v2 and nonlinear analysis

This is the working design for bringing the service in line with the owner's
[solver criteria](../../docs/kb/solver-criteria.md) (IDs such as M04 and A05
below refer to it) and the solver-facing parts of the
[turn criteria](../../docs/kb/turn-criteria.md). It records decisions, not
aspirations. Where the service cannot do something the contract can express,
it must answer `unsupported` and say why.

The contract is `packages/solver-contract/src/index.ts`. Its header comment
states units, axes and the local-axis rule; read it first. The request schema
is `src/dof_opensees/schema.py`.

## Module boundaries

| Module | Responsibility | Imports OpenSees |
| --- | --- | --- |
| `schema.py` | Request shape and value ranges. | no |
| `properties.py` | Default member properties. | no |
| `model.py` | Preparation: references, defaults, connection normalisation, capability checks, relevant-DOF decisions, partition into components. Pure data. | no |
| `stability.py` | Spectrum classification of a stiffness or tangent matrix. | no |
| `tangent.py` | Read the tangent matrix out of the active domain. | yes |
| `builder.py` | Create the OpenSees domain for one component, for one geometry formulation. | yes |
| `nonlinear.py` | Incremental-iterative driver: stepping, stability along the path, recovery, verification. Works on callbacks, knows nothing about the contract. | yes |
| `engine.py` | Orchestrate one request: prepare, loop over components, run linear or nonlinear, read results, classify. | yes |
| `results.py` | Assemble the contract result body and aggregate status. | no |
| `app.py` | HTTP. | no |

OpenSees holds one global model per process. All domain work happens under
the engine's lock. A component is built, analysed and read before the next is
built.

## Preparation (`model.py`)

1. Validate: unique ids, known node references, non-zero member length, at
   most one support per node, size limits. Failures are `error`.
2. Normalise each member end to a six-law connection. `fixed` = all locked,
   `pinned` = `L L L F F F`, `free` = all free. Giving both a shorthand and a
   full connection for the same end is an `error`. An `elastic` axis without a
   positive finite stiffness is an `error`.
3. For `brace` and `cable` members the three rotational laws are ignored: an
   axial member cannot transfer moment whatever its connector says.
4. Resolve properties: the member's own, else the default section. Resolve
   local axes by the contract rule.
5. Check capability (see below). Anything outside it is `unsupported`, naming
   the member and the reason.
6. Partition into components (A06). Two members are in the same component
   when they attach to the same node through a connection that is not all
   free. A member end that is all free does not join its node. Nodes with a
   load or a support but no attached member end form their own component.
   Nodes with nothing at all are left out, with a warning.
   The component id is the lexicographically smallest node id in it.

## Connection capability (M02, M04, M05)

Locks must be exact constraints, never large stiffness. OpenSees gives exact
locks only in these forms, and that defines what the service supports:

| Connection (UX UY UZ RX RY RZ) | Representation |
| --- | --- |
| `L L L L L L` fixed | Member end shares the node. |
| `L L L F F F` ball joint | Duplicate node tied to the joint by `equalDOF` on the three translations. |
| `L L L L F F`, `L L L L L F`, `L L L L F L` hinges with torsion locked | Beam end moment releases in the element (`-releasez`, `-releasey`), exact in the corotated member frame. |
| Translations locked, each rotation `elastic` or `free`, at least one `elastic` | Duplicate node, `equalDOF` on translations, `zeroLength` rotational springs oriented to the member axes on the elastic axes. Real springs with the given stiffness. |
| All six `elastic` or `free`, at least one `elastic` | Duplicate node joined only by oriented `zeroLength` springs. |
| `F F F F F F` unattached | Member end has its own node, not tied to the joint. |
| Any other pattern, on a member whose local axes are each parallel to a global axis | Duplicate node with `equalDOF` on exactly the locked global DOFs, plus springs on elastic axes. Exact for small rotations of the joint; the result carries a warning under nonlinear fidelity. |
| Any other pattern on a skew member | `unsupported`. |

A member whose two ends both leave local RX free would spin about its own
axis. That spin is an irrelevant rotation, not a mechanism (M01, turn
criteria section 3). It is removed exactly: at one such end the torsion is
locked to the joint instead, using the hinge representation. No torque can
develop because the other end is still free in torsion, so this changes no
result. It is the only place the service replaces a requested law, and it
adds no stiffness.

## Relevant degrees of freedom (M01)

- A joint node where no attached member end locks or springs a rotation has
  no rotational stiffness. Its three rotations are removed from the system
  with `fix`, unless a moment load acts on it, in which case they stay and
  appear as a loaded rotational mechanism.
- No soft springs, no diagonal regularisation. The previous "spin spring"
  mechanism is removed.

## Elements (M03, M08)

- `beam`: `elasticBeamColumn`, or another elastic beam-column formulation if
  it meets the gates with fewer degrees of freedom, with member properties
  and local axes from the contract. Under nonlinear fidelity each beam is
  subdivided so member buckling and P-delta are captured (A02).
- `brace`: axial element, two-way.
- `cable`: axial element with a tension-only material; never carries
  compression, at either fidelity. `initialStrain` on braces and cables is
  applied as an initial strain of the material.
- `initialStrain` on a beam is `unsupported`.
- Self-weight (M07), when requested, is `weightPerLength` times length along
  -Z, lumped onto the member's own nodes (segment nodes and member-end nodes,
  not the joint), so nothing is counted twice and an unattached end still
  carries its share.

## Analysis per component

Every component is analysed separately and gets its own verdict (A06).

### Reference state

Build the component. If it has zero free DOFs, nothing can move: it is
`stable` and each support reacts its own load. Otherwise read the tangent at
the reference state (zero external load, initial strains present) and
classify it with `stability.assess`:

- Mechanism present (any null vector, translational or rotational, loaded or
  not): go to recovery under nonlinear fidelity; under linear fidelity the
  component is `unstable`. An unloaded mechanism is never reported stable
  (A03).
- Negative direction at the reference state (possible with compressive
  initial strain): `unstable`, `load_induced_instability`, load factor 0.

Reason code for a mechanism: `unsupported_component` when the component has
no restraint at all; `rigid_body_mechanism` when every null vector is a rigid
motion of the whole component (translations fit `u = a + w x r` over all its
nodes); otherwise `internal_mechanism`.

### Linear fidelity (A01)

One solve with small-displacement geometry. Cables stay tension-only, so the
solve iterates; that is the only nonlinearity. Verify, read results, done.

### Nonlinear fidelity (A02, A04, A05)

Corotational geometry. Loads are applied proportionally from 0 to 1 by an
adaptive incremental-iterative scheme:

1. Take a load step with Newton iterations (with line search or an
   equivalent safeguard). If it does not converge, cut the step and retry,
   down to a minimum step.
2. After each converged step, read the tangent and classify it. If it is
   still positive definite, accept and continue.
3. If the tangent has a negative direction, the equilibrium path has passed
   a critical point (a bifurcation of a perfect structure shows up this way,
   because Newton happily follows the unstable primary path). Bracket the
   critical load factor between the last positive definite state and this
   one, and refine by bisection to 1% of the load factor. The component is
   `unstable`, `load_induced_instability`, `loadFactor` = the critical
   factor, with the buckling shape in `stability.modes`.
4. If steps stop converging before full load and the tangent at the last
   good state is positive definite, that is a limit point or a failure of
   the iteration. Without evidence which, the component is `unknown`,
   `not_converged`, with `loadFactor` = the last verified factor.
5. If the deadline passes: `unknown`, `timeout`.

At full load with a positive definite tangent the component is `stable`
(`marginal` if `near_mechanism` or `excessive_deformation` applies).

### Recovery from a singular reference state (A05)

A singular reference tangent does not prove no equilibrium exists (A04): a
cable with a transverse load, or a flat two-bar toggle, stiffens as it
deflects. So under nonlinear fidelity, when the reference mechanism is
loaded, attempt a bounded recovery:

1. Add temporary springs that hold the mechanism modes.
2. Bring the load to full.
3. Remove the springs in stages, re-equilibrating each time. The last stage
   has no springs at all.
4. Accept only if the final state has converged with no springs, its tangent
   is positive definite, and the largest displacement is at most
   `RECOVERY_DISPLACEMENT_LIMIT` times the shortest member length of the
   component (provisional value 0.1). The component is then `stable` with
   `geometrically_stiffened`.

The displacement bound exists because a collapsed mechanism also has a
far-away equilibrium (a racked frame lying flat). That is not a stable
structure and must not be reported as one; the service does not simulate
collapse.

If recovery is not accepted, or the mechanism is unloaded, the component is
`unstable` with its mechanism reason code. The verified fact is the mechanism
at the reference geometry.

Temporary springs never appear in results: every reported quantity comes
from a state with no artificial stiffness (A07).

### Verification (A07, A08)

Before any component's results are marked valid:

- All numbers are finite. Otherwise `unknown`, `non_finite_result`.
- Global equilibrium of the component: applied loads plus reactions sum to
  zero in force, and in moment about the origin taken at deformed positions
  under nonlinear fidelity. The residual, normalised by the larger of the
  total applied load and total reaction magnitude (moments additionally by
  the component's bounding size), must be at most 1e-5. Otherwise `unknown`,
  `equilibrium_not_verified`.
- Every cable has non-negative axial force, and a slack cable has zero.

`resultsValid` is true only for `stable` and `marginal` components. Results
of other components are omitted, not zeroed.

No exception may escape `engine.analyze` for any schema-valid input. An
unexpected internal failure becomes `unknown` for that component, or an
`error` result if it cannot be attributed to one.

## Result assembly (`results.py`)

- `status`: `unstable` if any component is `unstable`; else `unresolved` if
  any is `unknown`; else `success`. `message` summarises counts by state.
- Top-level `stability` sums the component counts and concatenates
  `unstableNodeIds` and modes (capped; counts are never truncated).
- `staticIndeterminacy` per component = internal force unknowns - free DOFs
  + mechanisms, counted on the linear model without subdivision (so it does
  not depend on mesh): 1 per brace or cable, 6 per beam, minus 1 per freed
  axis at each beam end, plus the same bookkeeping for elastic axes as
  locked ones.
- Member forces are reported per contract member, not per segment: signed
  axial (for a subdivided beam, the value largest in magnitude), largest
  shear and torsion, bending moment at each member end.
- `analysis.solver` is `"OpenSees <version> / dof-opensees <version>"`.

## Defaults and tunables

| Name | Value | Status |
| --- | --- | --- |
| Default fidelity | `nonlinear` | Decision: the owner wants a nonlinear solution. |
| Beam subdivision under nonlinear fidelity | Smallest count that meets the 2% buckling gate | To be fixed by the nonlinear driver work. |
| Default time budget | 2000 ms per request | From criteria section 6. |
| `RECOVERY_DISPLACEMENT_LIMIT` | 0.1 x shortest member | Provisional. |
| `NEAR_MECHANISM` | 1e-8 scaled | Provisional. |
| Equilibrium residual gate | 1e-5 | From criteria section 7. |

## Not in scope here

Capacity checks and utilisation, failure redistribution, turn transactions
and issue comparison, foundation objects distinct from nodes, interior
attachment and subdivision of members by other members, post-buckling path
tracing, sagging cable formulations, surrogates. These are later milestones
or game-engine responsibilities in the criteria.
