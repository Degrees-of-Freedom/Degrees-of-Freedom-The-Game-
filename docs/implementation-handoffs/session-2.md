# Session 2 handoff: scheduled analysis and minimum local correction

Branch `session-2/checkpoints`, from baseline `bbe4c44`. Not pushed, not merged.

| Commit | Content |
| --- | --- |
| `22722bb` | Contracts (`types.ts`) and the layered correction translator (`model.ts`). |
| `0117e3a` | Checkpoint schedule (`schedule.ts`) and its tests. |
| `741ee5d` | Issue comparison, correction search, the service, fixtures and tests. |
| the commit after `741ee5d` | This handoff. |

All code is new and lives in `apps/web/src/multiplayer/checkpoints/`. No existing file was edited: no domain rules or types, no `game/store.ts`, App, Workspace, menu, settings, viewer, manifest, solver adapter, Rust or OpenSees file, and no shared KB page.

## What session 4 needs to know first

- **The branch merges onto current `main` without conflicts.** A trial merge onto `da11441` typechecked and passed all 39 checkpoint tests there, against main's newer WASM module. The trial was discarded.
- **Nothing is wired in.** The service runs only when the shell calls it. Until then the app behaves exactly as before.
- **Session 1's correction record does not match one of the three restraint kinds here.** On `main`, the domain's `checkpoint` action stores a correction per port with a global rotation mask and a global translation mask. `rotation-joint` and `translation-joint` restraints map onto that directly. A `rotation-end` restraint locks one member end about a member-local axis and has no field there. Session 4 has to extend the domain record or store these restraints beside it; see "Integration steps".
- **Rotation masks cross this boundary in member-local axes**, not in a joint frame. The domain adapter must convert.

## Files

| File | Role |
| --- | --- |
| `types.ts` | Every request, result, adapter and correction type. Start here. |
| `schedule.ts` | Pure, persistable schedule: when a checkpoint is due. |
| `service.ts` | `createCheckpointService()`: replay, attribution, final score, cancellation. |
| `correction.ts` | The bounded search for minimum local restraints. |
| `issues.ts` | Reading issues from a solver result and comparing two states. |
| `model.ts` | Checkpoint model plus correction layer to `AnalysisModel`; invariant checker. |
| `fixtures.ts` | Test structures and a scripted-match adapter. Not game rules, not shipped state. |
| `index.ts` | Public exports. |

## API

```ts
import {
  createCheckpointService, createSchedule, commitTurn, changeInterval, finalize,
  toRequest, applyResult, freshness, parseScheduleState,
} from './multiplayer/checkpoints';

const service = createCheckpointService({
  solver,                 // DetailedSolver, e.g. wasmSolver from src/solver
  authoritative: true,    // false for any test double or diagnostic backend
  turns,                  // OrderedTurnAdapter
  models,                 // ModelAdapter
  options,                // AnalysisOptions for every solve; gravity enables self-weight
  down,                   // unit "down" vector, default [0, 0, -1]
  limits,                 // { maxSolves: 400, maxRestraintsPerTurn: 12 } by default
  tolerances,             // { overload: 1e-6, worsened: 1e-3, equilibrium: 1e-6 } by default
});

const result = await service.run(request, { signal });
service.cancel(checkpointId); // or cancel() for every run
```

`run` resolves for every outcome and never rejects: `completed`, `partial`, `failed` or `cancelled`.

### Inputs the integrator supplies

| Input | Type | Meaning |
| --- | --- | --- |
| `turns.turnsInWindow(afterTurn, throughTurn, signal)` | `OrderedTurn[]` | Committed turns with `afterTurn < turnNumber <= throughTurn`, in order, contiguous. Each has `turnId`, global `turnNumber` from 1, `playerId`, and the `revision` of the live model after it. A pass keeps the previous revision. |
| `models.modelAt(revision, signal)` | `CheckpointModel` | The original live structure at that revision, **without** system corrections. Must also answer for the setup revision. |
| `CheckpointModel` | | `nodes` (SI metres), `sections` (`AnalysisSection`), `members`, `foundations`, `loads` (global newtons). |
| `CheckpointMember` | | `kind: 'beam' \| 'cable'` with `sectionId`, or `kind: 'spring'` with `stiffness` in N/m and optional axial `capacity`. Each has `ownerId`, `originTurnId`, and `start`/`end` with `nodeId` and the original player `mask`. |
| `mask` | `[rx, ry, rz]` | `true` restrains rotation about the member's local x, y, z. Local axes follow `@dof/solver-contract`. |
| `CheckpointFoundation` | | `id`, `nodeId`, `ownerId`. Always fully fixed. |
| `CheckpointRequest` | | Built by `toRequest(schedule, due, stored)`; `stored` is `rulesVersion`, the match's existing `corrections`, all recorded `penalties`, and `playerIds`. |

### Outputs to store

| Field of `CheckpointResult` | Use |
| --- | --- |
| `status`, `authoritative`, `verified` | Only `verified: true` is a verified checkpoint. Apply penalties and corrections only from an authoritative, non-cancelled result. |
| `penalties` | New `PenaltyRecord`s: `turnId`, `turnNumber`, `playerId`, `points: 1`, `issues`, `revision`, `modelId`, `eventId`. Append to the match. |
| `corrections` / `activeCorrections` | New restraints, and the full layer now in force. Store `activeCorrections` and pass it as `corrections` next time. |
| `steps` | One per replayed turn: `evidence` (`verified`, `unchanged-model`, `unknown`), issues, restraint ids. |
| `unresolved` | Scopes that are unknown or could not be corrected, with a code and text. |
| `current` | State at the last settled turn: components with `verified`, player foundation reactions, `safetyReactions`, `totalGravity`. Its `lineage` is always `retrospectively-corrected`. |
| `final` | Present for a final checkpoint: per player `attraction`, `sharePercent`, `penaltyPoints`, `score`. |
| `settledThroughTurn`, `unsettledTurnIds` | Where replay stopped. |
| `events` | `checkpoint.penalty`, `checkpoint.correction`, `checkpoint.unresolved`, `checkpoint.completed`, `match.finalized`, each with a stable `eventId`, turn, actor, revision, `checkpointId` and `requestId`. |
| `provenance` | Service, rules and solver versions and the solver options used. |

Results contain no timestamps or runtimes, so the same request gives the same result.

## Scheduling

`ScheduleState` is plain JSON; persist it with the match and reload it through `parseScheduleState`.

- `commitTurn(state, { turnId, playerId }, { final })` counts one committed player turn across the table. A pass counts. Do not call it for cancelled drafts, readiness or retries. It returns the due checkpoint or `null`.
- A checkpoint is due when the turns since the last **attempt** reach `solveEveryTurns` (default 3), and always when `final` is set.
- A final turn that is also due by interval gives one checkpoint with `reason: 'final'` and `dueByInterval: true`. The id is `<matchId>:checkpoint:<turn>`, so both names refer to one checkpoint.
- `finalize(state)` gives the final checkpoint for a match that ends without a further turn. It returns `null` once the match is finalized. Quit must not call it.
- `changeInterval(state, n)` validates `n` against `SOLVE_EVERY_TURNS_RANGE` (1 to 12, this session's proposal), bumps `settingVersion` and appends to `settingLog`. It never makes a checkpoint due. The new value is used at the next `commitTurn`; a reduced interval that is already exceeded is due on that turn.
- `applyResult(state, result)` records the outcome. `lastAttempt` always moves, so a failed checkpoint is not retried every turn. `lastVerified` and the pending window move only for authoritative settled work. A cancelled result and a result for any other checkpoint leave the state unchanged.
- A checkpoint that is owed is kept in `state.due` across quit and reload. If another turn is committed while one is owed, the owed checkpoint is extended to that turn.
- `freshness(state)` gives the label for result panels: `analyzed at turn N`, `last analyzed at turn N — current structure not yet analyzed`, or `not yet analyzed`, plus `nextAnalysisInTurns`.

Nothing in this module solves on placement, drawing, inspection or pointer movement: the solver is reached only through `service.run`.

## Replay

1. The baseline is the live model at `window.baselineRevision` with all existing corrections. It is solved once.
2. Each pending turn is judged in order. A pass is not solved. Otherwise the turn's live model, with the corrections found so far, is solved and compared with the corrected state of the previous turn.
3. Verified new or worsened issues give that turn's player one penalty, however many issues there are. A turn that already has a penalty in `request.penalties` is not charged again.
4. If the turn changed the set of issues, the correction search runs. Its restraints apply to all later turns, and the corrected state is the next baseline.
5. A turn is settled completely or not at all. A solver failure, the work limit or an abort inside a turn leaves that turn and all later ones pending.

Issues that can cost a point are a verified unstable component and a verified overload (utilisation above 1). `marginal` is not an issue. An unstable component is worsened when its mechanism count rises above that of the baseline components its members came from. An overload is worsened when its utilisation rises by more than 0.1 %.

Unknown evidence never proves blame: a component the solver could not classify, a failed equilibrium check, or an unknown baseline gives `evidence: 'unknown'` and an `unresolved` entry, with no penalty.

Live models are only read. Later moves are never dropped or moved. A stored correction whose target is missing from a model is reported as `correction-target-missing` and not applied there.

## Correction

Three restraint kinds exist, and nothing else can be expressed:

| Kind | Effect | Recorded value |
| --- | --- | --- |
| `rotation-end` | Locks a released rotation of a beam end, member-local axis. | Moment the end transmits, N·m. |
| `rotation-joint` | Holds a joint's rotation about a global axis. | Reaction moment, N·m. |
| `translation-joint` | Holds a joint's translation along a global axis (MR11). | Reaction force, N. |

The search is deterministic and bounded:

- Stability first, then strength.
- Tiers in the order above. A later tier is used only when no candidate of the earlier one helps.
- Candidates are limited to the unstable components, or to the joints of the overloaded members. Joints that move in the solver's mechanism shapes come first; ties break by id.
- Each candidate is accepted only on a full solve of the whole corrected model.
- When the goal is reached, each added restraint is removed on trial, newest first, and stays removed if the goal still holds. The remaining set is irreducible; it is not proven to be the globally smallest.
- If a phase cannot reach its goal, its restraints are discarded and the scope is reported as `instability-not-corrected` or `overload-not-corrected`. The move and its penalty are kept. Sections are never upgraded.

Restraint ids come from the target (`safety:rotation-end:b1:start:1`), so one target is restrained once and replays give identical ids. Restraints are permanent for the match.

The corrected analysis model differs from the original only in released rotations made rigid and in solver-level restraint entries named `safety-restraint:<nodeId>`. `correctionInvariantViolations()` checks that nodes, members, sections, loads and player foundations are unchanged, and the service runs it before every corrected solve.

Joint safety restraints are sent to the solver as restraint entries because the solver contract has no other way to hold a joint. They are not foundations in any output: they appear only in `current.safetyReactions`, with `scored: false`.

## Scoring

- W is the total applied force along `down` over **all** components, verified or not.
- A player's attraction is the upward reaction of their own foundation in verified components. Safety reactions belong to nobody.
- `sharePercent = 100 × attraction / W`, and `score = sharePercent − penaltyPoints`, where the points are all recorded penalties plus the new ones.
- `validity` is `verified`, `verified-components-only` (some components unverified; they add nothing to any player while W is unchanged), or `unavailable` (no verified component, no gravity, or the final replay did not complete). Unavailable shares are `null`, never zero.
- A share can be negative when a foundation is in uplift. Tie and uplift policies remain open in the criteria.

## Evidence

All physical expectations come from the Rust solver compiled to WebAssembly (`apps/web/src/solver/wasm/dof_solver.wasm`), read from disk in the tests. Wrappers only count calls, inject an outage or abort. The one test that alters a solver result runs the service as non-authoritative and asserts the result is not verified.

Commands run in this worktree, all passing:

| Command | Result |
| --- | --- |
| `npm run typecheck` | Clean. |
| `npm test` | 33 files passed, 1 skipped; 221 tests passed, 6 skipped. The skipped file needs a running OpenSees service. |
| `npx vitest run apps/web/src/multiplayer/checkpoints` | 39 tests passed (14 schedule, 25 service). |
| `npm run build` | Built; the existing chunk-size warning is unchanged. |

Fixture results observed from the solver (two fixed columns 4 m high, 10 m apart; placeholder section and k₀ values in `fixtures.ts`):

| Fixture | Outcome |
| --- | --- |
| Loaded beam hung on one hinge | 1 mechanism; one `rotation-end` lock; it transmits about 20.0 kN·m for 5 kN on 4 m. |
| Same beam with two released rotations | 2 mechanisms; exactly two `rotation-end` locks. |
| 30 kN on a 4 m cantilever with a 40 kN·m section | Beam and column both at about 3.0 utilisation; one `translation-joint` restraint along Z carries 30.0 kN; utilisation then at most 1. |
| Weight on an inclined cable | 2 mechanisms; one `translation-joint` restraint; no rotational one. |
| Loaded horizontal spring | One `translation-joint` restraint. |
| Hinge plus overload, final | W = 35 kN; player 1 share 14.29 %, player 2 share 0 %; one penalty each. |

Tests cover: solver call counts at turns 1, 2, 3, 4, 5 and 6; passes; interval reduced, exceeded and raised; final and due overlap; several originating players; unchanged and worsened issues; replayed windows; unknown baseline; failed replay solve; work limit; interruption and retry; service cancellation; minimum rotational versus required translational correction; unchanged original model; solver-checked stability, equilibrium, compatibility and capacity after correction; neutral reactions; historical penalties; verified-component fallback; unavailable final score.

## Limitations

- **OpenSees cannot run checkpoints.** The service needs `DetailedSolver` (components, mechanism shapes, utilisation, per-restraint reactions). The OpenSees adapter implements only the original `SolverAdapter`. Its contract and tests are untouched.
- **Rust tests were not run.** No Rust file changed; `npm run test:solver` was not executed in this session.
- **Springs are translated as two-way axial bars** with `E·A/L` equal to the authored stiffness at the placed length. No spring card values are defined here; `K0` in the fixtures is a placeholder.
- **Self-weight is untested here.** Passing `options.gravity` enables it in the solver and W then includes it, but the fixtures carry no density.
- **Masks are member-local.** A joint-frame mask that is not aligned with the member axes cannot be expressed exactly.
- **One restraint entry per joint.** The solver accepts one restraint entry per node, so a joint safety restraint on a node that carries a player foundation is omitted; that node is already fully fixed.
- **A joint can collect several restraints** if the search finds each one necessary; there is no separate cap per joint beyond `maxRestraintsPerTurn`.
- **Geometric stabilisation is accepted as the solver reports it.** The loaded horizontal spring is held by one horizontal restraint and reaches equilibrium only by sagging under large displacement.
- **A cancelled run restarts from the beginning.** It returns the steps reached for display only; nothing in it is authoritative.
- **The completed-result memory is per service instance.** After a reload, a repeated request is recomputed and gives the same result.
- **Open parameters used as defaults:** interval range 1 to 12, tolerances, `maxSolves` 400, `maxRestraintsPerTurn` 12, the 0.1 % worsening threshold, signed uplift in shares.

## Integration steps

1. Merge `session-2/checkpoints`. Only new files arrive.
2. Write the two adapters over session 1's domain: `turnsInWindow` from its completed turns, and `modelAt` from its original model at a revision. Convert positions to metres, loads to newtons, and connection masks to member-local axes. Exclude system corrections from `modelAt`.
3. Decide where `rotation-end` restraints are stored, since the domain's correction record is per port in global axes. Store `SafetyRestraint` records as returned, or extend the domain record.
4. Create one service with `wasmSolver` and `authoritative: true`. Pass the scored `AnalysisOptions`.
5. Keep a `ScheduleState` in the saved match. On every committed turn call `commitTurn`; when it returns a due checkpoint, build the request with `toRequest`, call `service.run` with an `AbortSignal`, then `applyResult`, then store penalties and `activeCorrections` in the same save.
6. On resume, if `state.due` is set, run it again before the next turn.
7. Wire Settings to `changeInterval` and show `settingLog` publicly.
8. On Quit, abort the signal or call `service.cancel()`. Do not call `finalize`.
9. Use `freshness(state)` for result labels, and remove the manual Run simulation path from multiplayer.
10. Feed `result.events` to the presentation layer; ids are stable for deduplication.
11. Record the open parameters above in the shared KB when they are decided.
