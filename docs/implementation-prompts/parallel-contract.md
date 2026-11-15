# Parallel-session contract

Use four independent worktrees/branches from the same baseline containing criteria commit `17415db`. No shared working directory, peer edits/cherry-picks mid-development, automatic main merges or deployment. Sessions 1–3 finish independent features; session 4 starts its own work immediately and integrates finished outputs last.

| Boundary | Owner | Interface / invariant |
| --- | --- | --- |
| Rules and saved domain state | 1 | `createMultiplayerDomain()`: get snapshot, validated command dispatch, event subscription; owns canonical command/state/event types. Preserve baseline compatibility exports until integration. |
| Analysis/replay/correction | 2 | `createCheckpointService()`: typed request/result, `run(request, {signal})`, cancellation; consumes injected model/ordered-turn adapters, never owns deck/UI state. |
| Rendering and inspection | 3 | Export scene/inspector components with read-only view data, validated-action callbacks, safe-zone and pause/dispose hooks; no direct domain mutation or hidden solve. |
| Shell and presentation | 4 | Own routing/Workspace/store/menu/settings/global CSS and event/port adapters. Integrates reviewed finished branches and reconciles shared KB. |

Every authoritative event needs stable event ID, originating turn/actor, model revision and event type; checkpoint/result/correction records also need request/checkpoint ID and solver/rules provenance. UI views expose only allowed active-player/private data. Presentation deduplicates event IDs and cannot decide scores/physics. Requests/results remain tagged to exact model/replay lineage; quit/cancel invalidates stale callbacks. Version and validate serialized boundaries; use typed adapters, not `any` or unchecked casts.

The owner of each boundary defines its exact types in its branch and documents them in its unique handoff. Other branches use dependency injection and independently compiling fixtures, not missing unmerged imports or alternative production rules. Session 4 performs final typed adaptation. No temporary test fixture is accepted as real analysis or shipped state authority.

Use unique handoffs `docs/implementation-handoffs/session-1.md` through `session-4.md`. Sessions may add session-specific documentation pages; only session 4 edits shared KB/index pages after joining outputs. Session 4 owns shared package/config changes; other sessions document requests instead of racing on manifests/lockfiles. Baseline must be available in every session, including remote clones; local-only commits do not magically appear on another machine.
