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

This service is the merge of two engines: this v2 redesign and Tal's
extension of the v1 engine on `main` (commits 008cd8a, d8f695e, 614bc25,
c3cec22, 697ac33). The owner's rule: one engine with the v2 architecture and
result model; where the two conflict, Tal's requirement wins; her pure
additions are added. "Merge with Tal's engine" below records every conflict
and how it was resolved.

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
   most one support per node, size limits, analysis options, member laws
   and numeric range (see "Robustness guards"). Failures are `error`.
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
   `member:<member id>`. The nodes left out are listed in the result's
   `inactiveNodeIds`.

## Request vocabulary (merged from Tal's engine)

Her request fields are accepted beside the v2 ones (`schema.py`,
`model._fidelity`, `model._resolve_law`).

### Fidelity

- Nonlinear is opt-in: `analysis.fidelity: 'nonlinear'` or
  `analysis.type: 'corotational'`, which mean the same. With neither, or with
  no `analysis` object at all, the analysis is linear. (Conflict: v2 had
  defaulted to nonlinear; hers wins.)
- `fidelity: 'linear'` together with `type: 'corotational'` is an `error`.
- `analysis.segmentsPerFrame`, an integer 1 to 32, fixes the number of
  elements of every beam and overrides adaptive subdivision ("Beam
  subdivision"); adaptive subdivision applies only when it is absent. It
  means nothing to a linear solve, so giving it without nonlinear fidelity is
  an `error` rather than silently ignored. Her default of 8 does not apply:
  without it subdivision is adaptive. When the fixed count is below what the
  accuracy rule asks for after the solve, the result carries a warning.

### Member laws

`member.law` is `{kind: 'frame', elasticModulus, shearModulus, area, iy, iz,
torsionConstant}` or `{kind: 'cable', elasticModulus, area, restLength}`.

- A frame law is a `beam` with those properties (`iy`, `iz` are `inertiaY`,
  `inertiaZ`).
- A cable law is a tension-only `cable` whose force is exactly
  `E A max(0, l / L0 - 1)`, engineering strain on the rest length `L0` at
  current length `l`. Axial elements measure strain on the reference length
  `L`, so it is built, as in her engine, as a tension-only material of
  modulus `E L / L0` with initial strain `1 - L0 / L` (`InitStrainMaterial`):
  `(E L / L0)((l - L) / L + 1 - L0 / L) = E (l - L0) / L0` at every length.
  On `corotTruss` (nonlinear) `l` is the true chord length, so the law is
  exact; on `Truss` (linear) `l` is the small-displacement length, the same
  law linearised. Tension-only and slack below the rest length at both
  fidelities, like every cable.
- Laws are accepted at both fidelities. Her engine refused a law without
  corotational analysis; v2 analyses every cable at both fidelities, so the
  same law is used at both.
- Agreement rule. A law defines kind, properties and initial strain. The v2
  fields may accompany it only when they say the same thing: `kind` must be
  the law's (`frame` -> `beam`, `cable` -> `cable`); `properties` must equal
  the law in every value the law defines (E, A; for a frame also G, Iy, Iz,
  J), compared exactly; `initialStrain` must be 0 (a cable law expresses
  pretension through `restLength`). Anything else is an `error` naming the
  disagreeing fields. Values a law does not define come from `properties`
  when given: `weightPerLength` (zero otherwise, with a warning under
  self-weight) and, for a cable, the beam-only values, which it never uses.
- Her rule that a cable law needs pinned ends is not kept: v2 already
  ignores the rotational laws of axial members.
- Every cable's force is checked after the solve against its law of its own
  end displacements (`engine._cable_law_holds`, her check): relative 1e-6,
  absolute `max(1e-5 N, 1e-9 E A)`. A mismatch is `equilibrium_not_verified`.

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
in significant compression or bending through a large rotation need it. So,
unless `analysis.segmentsPerFrame` fixes the count:

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
   warning naming the members. If the refinement runs out of Newton attempts,
   time, or nonlinear equations, the coarser result stands with a warning.
4. An adaptive count is lowered, with a warning, where finer elements would
   be unrepresentable (stations that round to the same point far from the
   origin, or element coefficients out of range). A requested fixed count is
   checked in preparation instead and refused as `error`.

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
   and only when the system has at most `max_nonlinear_equations` (1200)
   equations; otherwise the result carries a warning that the shape was not
   computed.
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
   steps, which ends in `not_converged` just below the limit load. "Where it
   started" allows 0.3 of the step's own displacement (it was 0.1): a path
   from a flat pretensioned cable grows like the cube root of the load, and
   stepping back by 99% of the load leaves 0.01^(1/3) = 0.22 of the step
   (Tal's two-leg cable fixture). A snapped branch is about a whole step away.
5. If the request's Newton attempts run out: `unknown`, `not_converged`
   ("Work limits"). If a requested wall-clock budget passes: `unknown`,
   `timeout`. Either way a reference mechanism, being verified, is reported
   as the `unstable` verdict instead.

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

A component with no support at all keeps its rigid-body modes whatever
recovery does, so recovery is not attempted for it and it spends no Newton
attempts: it is `unstable`, `unsupported_component`, at once.

**Cable-only components (owner's ruling, Tal's requirement).** The bound
protects against reporting a collapsed frame mechanism as stable, so it
applies to every component that contains a beam or a brace. A component made
only of cables (with its supports and joints) cannot collapse that way: a far
equilibrium is a real hanging state. There the displacement bound is not
applied; everything else is still required: converged with no springs,
positive definite tangent, equilibrium within 1e-5 and every cable's law
satisfied. Two details make recovery work there (`engine.ComponentProblem`):
the springs hold every equation, not only the mode directions (a cable slack
by a finite strain has no stiffness either way, but the one-sided modes treat
it as resisting lengthening), and when every cable is slack the tangent is
zero, so the spring scale is the largest cable `E A / L`. The work stays
bounded by the request's Newton attempts. This restores Tal's "initially
slack single cable" fixture: a 2 m cable with a 2.05 m rest length, fixed at
one end and loaded at the other, hangs 2.9 m away, `stable`,
`geometrically_stiffened`. A pin-jointed portal pushed sideways stays
`unstable` (`test_merged_vocabulary.py::test_far_recovery_is_still_refused_for_a_frame_mechanism`).

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
- Every cable's force matches its tension-only law of its own end
  displacements ("Member laws").

`resultsValid` is true only for `stable` and `marginal` components. Results
of other components are omitted, not zeroed.

### Robustness guards (merged from Tal's engine)

All four of her guards are kept, mapped to v2: invalid input is an `error`
for the whole request; anything else makes the affected component `unknown`
with a reason code, and its entries are withheld.

| Guard | Where | Outcome |
| --- | --- | --- |
| Loads on one node summed exactly (`math.fsum`, rational arithmetic when even its partials overflow), so `1e308 + 3 - 1e308` is `3`. A total outside the double range is refused. | `model._combined_loads` | `error`, "combined force or moment ... exceeds the numeric range" |
| Range of derived element coefficients, before any native call: a span whose square overflows; per element `L^2`, `EA`, `EA/L`; for beams `GJ`, `GJ/L`, `L^3`, `EI`, `4EI/L`, `12EI/L^3` per inertia; for a cable law the length ratio, its inverse, `E L / L0`, `EA / L0` and the reference force; `w L` under self-weight. With a fixed `segmentsPerFrame` the actual mesh stations are checked, so subdivision far from the origin that makes stations coincide is caught. | `model.element_range_problem` | `error` naming the member ("reference span", "coincident mesh stations", "outside the OpenSees numeric range"); an adaptive count is lowered instead (see "Beam subdivision") |
| Recursive non-finite check of every number a component reports (displacements, reactions, member forces, modes, load factor, residuals, nonlinear report), and floating-point exceptions raised while analysing it. | `engine._finite`, `engine._guarded` | `unknown`, `non_finite_result` |
| A finite native response that does not balance (global force, global moment, or nodal residual above 1e-5) is withheld. The balance is computed with forces scaled by the largest force entry and arms by the component size before any sum or cross product, so loads near the double range cannot overflow `r x F`; norms use `hypot`. | `engine._equilibrium_residual` | `unknown`, `equilibrium_not_verified` |

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
  `unstableNodeIds` and modes. Modes share one budget of `max_modes` (12) for
  the whole request, taken by components in contract order (Tal's shared
  mode budget); counts are never truncated.
- `inactiveNodeIds` (optional): the contract nodes left out of the analysis
  because nothing is attached, nothing loads them and nothing supports them.
  Present only when there is at least one.
- `nonlinear` (optional): present when a nonlinear analysis succeeded
  (`status` `success`). Fields:
  - `segmentsPerFrame`: the fixed count requested; otherwise the largest
    number of elements adaptive subdivision gave any beam (1 when no beam
    was subdivided or there is none).
  - `steps`: Newton attempts the request spent (the attempt budget's count,
    "Work limits").
  - `forceResidual`, `momentResidual`, `nodalResidual`: the largest over
    components of the normalised global force (with the self-weight check),
    global moment and free-DOF nodal residuals of "Verification". Each is at
    most 1e-5.
  - `cableState`: every cable, `taut` or `slack` (`slack` exactly when its
    `memberForces` state is `slack`).
- No zero placeholders. Her engine reported zero displacements (and zero
  reactions) for skipped nodes on a successful request. v2's rule wins:
  absent means unavailable, so an inactive node has no entry at all.
- `staticIndeterminacy` per component = internal force unknowns - free DOFs
  + mechanisms, counted on the linear model without subdivision (so it does
  not depend on mesh): 1 per brace or cable, 6 per beam, minus 1 per freed
  axis at each beam end, plus the same bookkeeping for elastic axes as
  locked ones.
- Member forces are reported per contract member, not per segment: signed
  axial (for a subdivided beam, the value largest in magnitude), largest
  shear and torsion, bending moment at each member end.
- `analysis.solver` is `"OpenSees <version> / dof-opensees <version>"`.

## Work limits (merged from Tal's engine)

The criteria require reproducible turn results, so the primary bounds count
work, never time, and a result does not depend on machine load. All are
request-wide, shared by the components in work order, and checked before the
work or allocation they bound (`model.Limits`, `engine._Budget`).

- **Newton attempts**, default 96 (her `max_nonlinear_attempts`). One attempt
  is one attempted load increment: a call of the driver's `step` (Newton,
  line-search fallback and branch check together), including the prestress
  stage, recovery stages, bisection moves and replays after a rejected
  step, and the one-step fast path's single solve
  (`nonlinear.AttemptBudget`). Linear-fidelity solves are not counted: they
  are bounded by a fixed number of attempts of their own. A component whose
  work stops on the budget is `unknown`, `not_converged`, with the last
  verified load factor and a warning naming the "increment budget", unless
  its reference mechanism is already verified, which is then its `unstable`
  verdict. If only the refinement re-solve stops, the coarser verified
  result stands with a warning.
- **Dense reference equations**, default 2688 (her `max_linear_equations`):
  each component's reference classification reads a dense tangent of its
  unsubdivided system, at either fidelity, and spends that many equations,
  free rotations of released ends included. A component that does not fit
  in what is left is not built: `unknown`, `not_converged`, with a warning
  "the N-equation linear model exceeds the M-equation dense analysis
  limit"; a component with no support is `unstable`, `unsupported_component`
  without shapes, since statics decides it.
- **Subdivided nonlinear equations**, default 1200 (her nonlinear tangent
  budget): each nonlinear solve spends the equations of its subdivided
  system (six per interior segment node), counted before it is built; a
  refinement spends the increase. Over the budget: `unknown`,
  `not_converged` with a warning (or the reference mechanism). The same 1200
  bounds every dense tangent read at a loaded state. A consequence: the
  benchmark stress frame (490 members, 2220 subdivided equations) is
  `unresolved` under nonlinear fidelity; it was solved before the merge.
- **Wall clock**: only when the request sets `analysis.timeoutMs`, as an outer
  safeguard. Without it no clock is consulted (`timeout` cannot occur). With
  it, work left unfinished is `unknown`, `timeout`, as before.
- **Work order** (`engine._work_order`): components with no free DOF first,
  then supported components, then unsupported ones (her rule: anchored
  regions before unsupported ones spend the shared budgets), each group by
  increasing free-DOF count, ties by id. So every budget boundary is
  reproducible.

`tests/test_merged_vocabulary.py::test_results_do_not_depend_on_machine_load`
runs a hard three-component model (a column beyond its Euler load, a
pretensioned cable net, a slack-cable stay) with every clock read advanced by
1000 s, twice, and once without delay; the results are identical apart from
`runtimeMs`.

## Merge with Tal's engine

| Topic | v2 before | Tal's engine | Resolution |
| --- | --- | --- | --- |
| Default fidelity | nonlinear | linear; `analysis: {type: 'corotational'}` opts in | Hers: linear by default; `type: 'corotational'` and `fidelity: 'nonlinear'` both select nonlinear. |
| Member properties | `kind`, `properties`, `initialStrain` | `law` (frame or cable) | Both accepted; a law with disagreeing v2 fields is an `error` ("Member laws"). |
| Cable law | initial strain on the reference length | `EA max(0, l / L0 - 1)`, corotational only | Her law, exactly, at both fidelities (linearised at linear fidelity). |
| Beam subdivision | adaptive | fixed `segmentsPerFrame`, default 8 | Fixed count when given, adaptive when absent. |
| Primary work bound | 2000 ms wall clock | 96 Newton attempts, request-wide | Hers; `timeoutMs` optional outer safeguard, off by default. |
| Equation budgets | none (dense shape read up to 1500) | 2688 dense linear, 1200 nonlinear, request-wide, before allocation | Hers, mapped to v2's dense reads ("Work limits"). |
| Mode shapes | 12 per component | 12 per request | Hers: one request-wide budget. |
| Work order | no-solve components first | anchored regions first | Hers: anchored before unsupported (zero-DOF components still first). |
| Robustness guards | finite check of results | exact load sums, coefficient range checks, recursive non-finite check, unbalanced responses withheld | Hers, all four, mapped to `error` or `unknown` with a reason code. |
| Partially solved model | per-component verdicts and entries | per-scope `result` objects; whole-model fields only on full success | v2 result model: `components`, entries of valid components. |
| Above a critical load | `unstable`, `load_induced_instability`, critical factor | `unresolved` | v2: a verified `unstable` with the factor. |
| Unsupported component under nonlinear | `unstable`, `unsupported_component` | `unresolved` | v2. |
| Skipped nodes | absent | zero placeholders on full success | v2: absent means unavailable; listed in `inactiveNodeIds`. |
| Initially slack cable hanging far away | reference mechanism (`unstable`) | `success` | Hers for cable-only components: no displacement bound there, all other checks kept; the bound still applies to any component with a beam or brace ("Recovery"). |
| Result extras | none | `inactiveNodeIds`, `nonlinear` report | Added ("Result assembly"). |

Her five test files are ported as `tests/test_tal_*.py`; each assertion
changed to v2 behaviour carries a one-line comment saying why.

## Defaults and tunables

| Name | Value | Status |
| --- | --- | --- |
| Default fidelity | `linear`; nonlinear is opt-in | Tal's engine (conflict, hers wins). |
| Beam subdivision under nonlinear fidelity | `segmentsPerFrame` when given; else larger of `ceil(29 * sqrt(rho))` and `ceil(12.5 * theta)`, clamped to 1..32; 4 without a linear result | Measured; see "Beam subdivision". |
| Newton attempts per request | 96 (`DOF_OPENSEES_MAX_NONLINEAR_ATTEMPTS`) | Tal's `max_nonlinear_attempts`. |
| Dense reference equations per request | 2688 | Tal's dense linear budget (largest benchmarked lattice). |
| Subdivided nonlinear equations per request; dense reads at loaded states | 1200 | Tal's nonlinear tangent budget. |
| Default wall-clock budget | none; `timeoutMs` is an optional safeguard | Tal's deterministic limits (conflict, hers wins). Was 2000 ms. |
| Branch check tolerance | 0.3 of the step | Was 0.1; see "Nonlinear fidelity", item 4. |
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
