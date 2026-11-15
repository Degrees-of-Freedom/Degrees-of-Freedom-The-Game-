# Session 3 — Scene, inspector, snapping and force vectors

Runnable concurrently from the shared baseline, in a separate worktree.

```text
Work concurrently with three other sessions, in your own Git worktree and unique feature branch from the SAME baseline containing criteria commit 17415db. Never share a working directory, edit another session’s owned files, cherry-pick peers mid-development, or push/merge main. Read AGENTS.md, docs/kb/README.md, docs/kb/multiplayer-refresh-criteria.md and docs/implementation-prompts/parallel-contract.md. MR01–MR19 override older rules. This is an implementation task, not deployment.

Build independently against fixtures and injected adapters; do not wait for another session to finish or import symbols that exist only on an unmerged peer branch. Preserve existing compatibility exports until final integration. Never fabricate physics/results. Write tests, small commits and your own docs/implementation-handoffs/session-N.md, including commit SHA, owned files, exported interfaces, integration steps, checks and known gaps. Only session 4 updates shared KB pages during final integration.

You are SESSION 3. Own viewer modules, element geometry, picking, node glyphs and NEW focused inspector components/scoped CSS. Use apps/web/src/multiplayer/view/ for new integration-ready components. Do NOT edit App.tsx, Workspace.tsx, game/store.ts, menu/settings, domain/checkpoint/solver code, global CSS, manifests or shared KB pages. Build read-only view models and callback-based components against fixtures, with adapters for the baseline; do not require unmerged peer exports.

Implement and export an integration-ready MultiplayerScene/ElementInspector surface:
- Usable 15×15 board/camera and 5/7/10 maximum reach with shorter Euclidean spans/quarter targets. Bold opaque legal points near the cursor, fading farther away; preserve all legal directions, selected/armed targets, stable hit regions, depth cycling and keyboard/touch access.
- Only standard member/cable/two spring variants. TWO simple coils, one from each spring endpoint, remain one analytical element. Reuse meshes/materials/LOD; do not infer stiffness from visual halves.
- Connections shown only at nodes with clear 1/2/3 restrained-rotation DOFs. No translation-editing UI, bulky endpoint hardware, correction columns or added foundations. Distinguish original masks from safety overrides; setup stays locked.
- Inspect opens persistent property panel: owner/card/family, actual/max length/units, endpoints/quarter ports, masks, spring k₀/multiplier/k, locked status, checkpoint validity/results and system reactions. Edit drafts only through callbacks; committed/setup properties read-only. No solver calls.
- AXIAL FLOW: verified tension vectors move midpoint OUT toward both nodes; compression moves both ends IN toward midpoint. Use valid per-segment signs; zero/slack/unknown has no moving vectors. Reduced motion uses static arrows. Never animate historical results as current unsolved physics or alter physical thickness to imply force.

Expose safe zones/selection state and pause/dispose hooks for session 4. Do not own quit navigation or global shell wiring. Browser-check responsive actual rendering where possible; test sign mapping, panel permissions, target fading versus legality, non-mutation and cleanup. Write docs/implementation-handoffs/session-3.md with exported props/callbacks, screenshots/evidence and integration instructions. Finish independently.
```
