# Session 2 — Physics checkpoints and corrections

Runnable concurrently from the shared baseline, in a separate worktree.

```text
Work concurrently with three other sessions, in your own Git worktree and unique feature branch from the SAME baseline containing parallel-prompt commit bbe4c44. Never share a working directory, edit another session’s owned files, cherry-pick peers mid-development, or push/merge main. Read AGENTS.md, docs/kb/README.md, docs/kb/multiplayer-refresh-criteria.md and docs/implementation-prompts/parallel-contract.md. MR01–MR19 override older rules. This is an implementation task, not deployment.

Build independently against fixtures and injected adapters; do not wait for another session to finish or import symbols that exist only on an unmerged peer branch. Preserve existing compatibility exports until final integration. Never fabricate physics/results. Write tests, small commits and your own docs/implementation-handoffs/session-N.md, including commit SHA, owned files, exported interfaces, integration steps, checks and known gaps. Only session 4 updates shared KB pages during final integration.

You are SESSION 2. Own checkpoint scheduling/replay/correction/result services in apps/web/src/multiplayer/checkpoints/, solver adapters/translators and numerical backend files only when necessary. Do NOT edit domain rules/types, game/store.ts, App/Workspace, menu/settings, viewer, manifests or shared KB pages. Use injected domain snapshots/turn records and solver ports rather than importing an unmerged session-1 module.

Export createCheckpointService() with typed run(request, {signal}), result/correction/penalty output and cancellation. Document its owned request/result types and adapters. Implement:
- Every 3 globally completed player turns by default, Settings-editable interval, plus match end; no per-placement/inspection/noncheckpoint numerical solves. Final/due overlap resolves once. Track attempted/verified checkpoints and stale model/version scope.
- Ordered replay of pending original turns INSIDE checkpoints. At most one verified -1 per responsible original turn/player, not blanket blame on checkpoint player. Preserve historical penalties, live versus retrospective lineage and later player moves; unknown evidence cannot establish blame.
- Minimum local rotational safety constraints; system-only local translational restraint only when necessary. No columns down, props, new foundations/anchor meshes, load deletion, mass clamping or hidden stiffness/section upgrades. Keep original masks separate; verify stability, capacities, compatibility and equilibrium. Record neutral safety reactions, unscored for players, with total gravity unchanged as denominator.
- Final-only share-percentage-minus-penalties calculation, verified-component fallback and truthful unresolved scope. Persistable deterministic outputs, permanent correction IDs, idempotency and quit/cancel/retry behavior.

Preserve existing Rust/WASM and OpenSees capability/unit contracts. Test against real backend fixtures plus controlled test doubles; do not declare stub physics verified. Test turn counts, interval/final deduplication, multiple originating players, minimum correction versus necessary translation, neutral reactions, unknown replay and cancellation. Run appropriate backend/web checks. Write docs/implementation-handoffs/session-2.md with APIs, fixtures/evidence and numerical limitations; finish independently for session-4 integration.
```
