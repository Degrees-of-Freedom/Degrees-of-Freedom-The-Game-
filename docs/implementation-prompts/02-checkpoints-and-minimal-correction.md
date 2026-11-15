# Session 2 — Scheduled solving and minimum local correction

Copy the prompt below into a separate Codex/Claude session. Run in the stated order.

```text
Read `AGENTS.md`, `docs/kb/README.md` and `docs/kb/multiplayer-refresh-criteria.md` first. This newest revision supersedes conflicting earlier rules. Inspect current main/code and preserve unrelated changes; do not assume a previous chat's implementation state. Work on a feature branch. This prompt authorizes implementation of its stated session scope, not deploying, merging or publishing. Update the relevant KB with actual behavior, evidence and limitations; do not claim unsupported physics or ask again about settled MR01–MR19 choices.

Prerequisite: start from the merged/reviewed session-1 result, reading `docs/implementation-handoffs/session-1.md`. Do not run against an older independent branch. Own checkpoint/physics integration and associated state/evidence, preserving session-1 rules.

Implement:
- Automatic solve every 3 globally completed player turns by default, Settings-editable positive interval, plus match end. No solve from draw/hover/inspect/placement/noncheckpoint commit. A final turn already due uses one checkpoint. Geometry legality checks are not solver calls.
- Persist interval changes, due window, last attempted versus verified checkpoint and stale-result scope. Define a deterministic next-commit application rule; opening Settings/quit is not a solve. Expose truthful pending/last analyzed turn/model/solver provenance.
- At a checkpoint replay pending original turns in order from compatible evidence, attribute at most one -1 per responsible original turn/player and retain the historical penalty after repair. Do not blame only the checkpoint player. Track retrospective corrected versus live-history lineage; correction cannot delete/relocate later player moves. Unknown baselines do not prove blame.
- Simple minimum local rotational safety constraints, with system-only translational restraint only when required. No columns straight down, props, scaffold members, new foundations/anchor meshes, mass node clamping, hidden huge springs, load deletion or original player-property overwrite. Record original/effective layers and verify equilibrium, stability and capacity using supported backend semantics.
- Corrective constraint reaction is neutral, separately inspectable, in corrected-model equilibrium and excluded from player attraction; total gravity remains denominator. Retain correction records for the match. If no permitted verified correction exists, return truthful unresolved scope and the confirmed verified-component final scoring fallback.
- Idempotent final-only share-percentage minus penalty scoring, checkpoint/repair interruption and quit cancellation/suspension hooks. Keep safe view/help/quit available while workers run; late responses cannot overwrite newer state.

Inspect the existing Rust/WASM detailed contract and OpenSees adapter before editing numerical code. Preserve working backends/capability checks and unit conventions. Do not call a fallback physically valid merely to meet the fun/success goal. Parameterize genuine unresolved physical constants and budgets explicitly.

Tests: solver call counts at turns 1/2/3/4/6, passes, interval changes and final/due overlap; checkpoint replay of multiple responsible players, unchanged/unknown issue, interrupted retry; minimum rotational versus necessary translational correction, no extra foundation/columns, real neutral reactions and capacities; final-score denominator; quit/resume at each numerical phase. Run relevant web/shared/Rust/Python tests for code actually changed, typecheck/build and record limits. Do not implement roaming avatar or detailed mesh/UI choreography.

Handoff: commit; write `docs/implementation-handoffs/session-2.md` with event/request/result APIs, state lineage/settings rules, tested fixtures, exact correction semantics/limits, commands/evidence and integration instructions for sessions 3–4.
```
