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
   Nodes with nothing at all are left out, with a warning. A support that
   restrains nothing and a load of zero count as nothing.
   The component id is the lexicographically smallest node id in it. A
   member attached at neither end is a component with no nodes; its id is
   `member:<member id>`.

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
- When attached ends hold the joint's rotation about some global axes only,
  the remaining global axes are removed the same way. When a single member
  end is the joint's only rotational attachment, with no rotational support
  restraint and no moment load, it can transmit no moment: its rotational
  laws are treated as free and the joint rotations removed. A joint held
  about skew directions only is `unsupported`.
- Twist anchoring prefers the end whose joint cannot rotate about the member
  axis, so the spin is not simply moved into the joint. A member attached to
  nothing is not anchored: its spin is part of its rigid-body motion.
- No soft springs, no diagonal regularisation. The previous "spin spring"
  mechanism is removed.

## Elements (M03, M08)

- `beam`: `elasticBeamColumn` with member properties and local axes from
  the contract. Under nonlinear fidelity beams are subdivided so member
  buckling and P-delta are captured (A02); see "Beam subdivision".
- `brace`: axial element, two-way.
- `cable`: axial element with a tension-only material; never carries
  compression, at either fidelity. `initialStrain` on braces and cables is
  applied as an initial strain of the material.
- `initialStrain` on a beam is `unsupported`.
- Self-weight (M07), when requested, is `weightPerLength` times length along
  -Z, lumped onto the member's own nodes (segment nodes and member-end nodes,
  not the joint), so nothing is counted twice and an unattached end still
  carries its share.

## Beam subdivision (A02)

Measured on this formulation (`elasticBeamColumn` with the corotational
transformation): the critical load of a member is overestimated by about
`0.83 * rho / n^2`, where `n` is the number of segments and
`rho = N L^2 / (pi^2 E I)` is the member's compression relative to its own
pin-ended Euler load. A fixed-fixed member buckles at `rho = 4`, so it needs
16 segments for 1.3% and more for margin. Other elastic formulations in
OpenSeesPy 3.8 give the same numbers, except `forceBeamColumnCBDI`, which is
accurate with two segments but crashes the process under line search and has
no end releases. It is not used.

A second effect needs subdivision too. One corotational element treats
deformation relative to its chord as small, so a member that bends through a
large rotation is inaccurate with one element. On a cantilever elastica with
`P L^2 / EI = 2` the tip error was 1.77%, 0.40% and 0.10% with 2, 4 and 8
elements. In terms of the end rotation relative to the chord, `theta`, that
is about `0.16 * theta^2 / n^2`.

Subdividing every beam finely is unaffordable, and unnecessary: only members
in significant compression or bending through a large rotation need it. So:

1. The linear solve of the component runs first. Each beam gets the larger
   of two counts, each clamped to 1..32:
   - `ceil(29 * sqrt(rho))` from its largest compressive axial force at full
     load, and 1 if it is in tension. The constant 29 makes
     `0.83 * rho / n^2 <= 0.1%`. That is tighter than the 2% buckling gate
     because deflections near a critical load are amplified by
     `1 / (1 - P/Pcr)`, so a 0.3% error in `Pcr` already costs more than 1%
     at three quarters of the critical load.
   - `ceil(12.5 * theta)` from its largest chord-relative end rotation in
     radians, which makes `0.16 * theta^2 / n^2 <= 0.1%`. Below 0.08 rad
     this is 1, so ordinary structures are not refined. Only one load level
     was measured; the `theta^2` scaling is assumed. An independent elastica
     test at `P L^2 / EI = 1` passes its 1% gate on the tip pull-in with
     about a third of the gate to spare, so this constant has little margin.
2. With no linear result to go on, every beam gets 4 segments.
3. After a stable nonlinear solve the counts are recomputed from the actual
   axial forces. If a beam needed more than it had, the component is rebuilt
   and solved once more. If it is still short, the result stands with a
   warning naming the members.

Braces and cables are always single elements.

## Analysis per component

Every component is analysed separately and gets its own verdict (A06).

### Reference state

Build the component. If it has zero free DOFs, nothing can move: it is
`stable` and each support reacts its own load. Otherwise read the tangent at
the reference state (zero external load, initial strains present) and
classify it with `stability.assess`. The reference classification always
uses one element per beam: mechanisms are a kinematic property that
subdivision does not change, and taking `near_mechanism` from the coarse
model keeps it independent of the engine's own mesh.

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
2. After each converged step, test the tangent. If it is still positive
   definite, accept and continue. Along the load path this uses a banded
   Cholesky factorisation (`tangent.is_positive_definite`), which fails
   exactly when a direction of negative stiffness has appeared and costs
   tens of milliseconds where a dense read costs seconds. The dense spectrum
   is read once, at the first unstable state, to report the buckling shape,
   and only when the system is small enough; otherwise the result carries a
   warning that the shape was not computed.
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
   Load control can also jump across a limit point to a far-away
   equilibrium (a shallow truss snapping through to its inverted shape) and
   report convergence. Every step is therefore checked for reversibility:
   it is undone by the same increment and must return to where it started.
   A step that does not is rejected and the load path replayed with smaller
   steps, which ends in `not_converged` just below the limit load.
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
  zero in force, and in moment about the component centroid taken at
  deformed positions under nonlinear fidelity. The residual, normalised by
  the largest of the total applied load, total reaction and member force
  magnitudes (moments additionally by the component's bounding size), must
  be at most 1e-5. Otherwise `unknown`, `equilibrium_not_verified`. The
  member force scale is there so that a self-equilibrated prestressed
  component, with no load and no reaction, is not judged against rounding
  noise.
- Every cable has non-negative axial force, and a slack cable has zero.

`resultsValid` is true only for `stable` and `marginal` components. Results
of other components are omitted, not zeroed.

No exception may escape `engine.analyze` for any schema-valid input. An
unexpected internal failure becomes `unknown` with `solver_error` for that
component, or an `error` result if it cannot be attributed to one.

A cable that is pushed instead of pulled leaves its node with no stiffness.
Under linear fidelity the iteration then fails and the component is
`unknown`, `not_converged`: there is no verified conclusion to report.

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
| Beam subdivision under nonlinear fidelity | Larger of `ceil(29 * sqrt(rho))` and `ceil(12.5 * theta)`, clamped to 1..32; 4 without a linear result | Measured; see "Beam subdivision". |
| Default time budget | 2000 ms per request | From criteria section 6. |
| `RECOVERY_DISPLACEMENT_LIMIT` | 0.1 x shortest member | Provisional. |
| `NEAR_MECHANISM` | 1e-8 scaled | Provisional. |
| Equilibrium residual gate | 1e-5 | From criteria section 7. |

## What the nonlinear solve finds that a linear one cannot

Run on the game's twenty library fixtures, the nonlinear solve disagrees
with the linear solve and with the in-browser voxel analysis on two
structures that both of those call stable. Both disagreements are correct
physics, checked by hand:

- The slender column fixture is a 20 m fixed-free column with an Euler load
  of `pi^2 E I / (2 L)^2` = 4.1 kN carrying 10 kN. The solve reports
  `load_induced_instability` at a load factor of 0.416; the hand value is
  0.415.
- The bent cantilever fixture has an 8 m IPE 300 arm with a 20 kN tip load
  and no lateral restraint. The classical lateral-torsional buckling load of
  a tip-loaded cantilever, `4.01 * sqrt(E Iz * G J) / L^2`, is about 9 kN, a
  factor of 0.45; the solve reports 0.49. The elastic beam element has no
  warping stiffness, which a real I-section has, so the true section would
  buckle somewhat later.

## Not in scope here

Capacity checks and utilisation, failure redistribution, turn transactions
and issue comparison, foundation objects distinct from nodes, interior
attachment and subdivision of members by other members, post-buckling path
tracing, sagging cable formulations, surrogates. These are later milestones
or game-engine responsibilities in the criteria.
