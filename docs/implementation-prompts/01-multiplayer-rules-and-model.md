# Session 1 — Rules and domain

Runnable concurrently from the shared baseline, in a separate worktree.

```text
Work concurrently with three other sessions, in your own Git worktree and unique feature branch from the SAME baseline containing parallel-prompt commit bbe4c44. Never share a working directory, edit another session’s owned files, cherry-pick peers mid-development, or push/merge main. Read AGENTS.md, docs/kb/README.md, docs/kb/multiplayer-refresh-criteria.md and docs/implementation-prompts/parallel-contract.md. MR01–MR19 override older rules. This is an implementation task, not deployment.

Build independently against fixtures and injected adapters; do not wait for another session to finish or import symbols that exist only on an unmerged peer branch. Preserve existing compatibility exports until final integration. Never fabricate physics/results. Write tests, small commits and your own docs/implementation-handoffs/session-N.md, including commit SHA, owned files, exported interfaces, integration steps, checks and known gaps. Only session 4 updates shared KB pages during final integration.

You are SESSION 1. Own the multiplayer domain: card/catalogue definitions, legal actions, turn/deck rules and match serialization. Use apps/web/src/multiplayer/domain/ for new cohesive modules. You may update existing game/model.ts, turns.ts, session.ts, persistence.ts and inventory/catalogue definitions as needed; preserve compatibility for the baseline UI. Do NOT edit App/Workspace, game/store.ts, menu/settings, viewer, solver/checkpoint code, package files or shared KB pages.

Implement:
- Four cards per turn, independently choosing either deck for each draw; any number of held elements, connections and loads playable; pass/cancel/retry do not redraw or duplicate consumption.
- Only the standard axial/bending member, tension-only cable and springs 0.25k₀/0.5k₀. k₀ is a documented N/m reference; do not invent missing engineering constants. Member max tiers 5/7/10 game units allow shorter Euclidean spans, including permitted diagonals/quarter ports.
- Three rotation-mask card types restraining 1/2/3 axes; no player translation/elastic law cards. One immutable fully fixed starting foundation/column per player; no new foundations. Field 15×15 horizontal cells; document height/unit conversion. Committed physical properties read-only, drafts editable within cards.
- Validated versioned state/actions/events, private active-player views, draw choices, original turn/model IDs, pending checkpoint window, interval setting default 3, original/effective correction layers and resumable phase. Numerical work is session 2’s responsibility.

Export createMultiplayerDomain() with snapshot, validated command dispatch and event subscription; own canonical domain types as specified by the parallel contract. Supply factories/fixtures and migration rules without wiring global UI/store. Do not delete legacy saves or working solver capabilities.

Test draw choices/many plays/cancel/reload, length boundaries, catalogue/masks, setup locks and state validation. Run relevant checks/build and document limitations. Use docs/implementation-handoffs/session-1.md and an optional session-specific KB page; shared navigation/KB reconciliation belongs to session 4. Finish your branch independently and report its commits for integration.
```
