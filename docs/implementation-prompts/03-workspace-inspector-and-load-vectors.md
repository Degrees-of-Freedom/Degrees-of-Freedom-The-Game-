# Session 3 — Workspace, geometry, inspector and axial flow

Copy the prompt below into a separate Codex/Claude session. Run in the stated order.

```text
Read `AGENTS.md`, `docs/kb/README.md` and `docs/kb/multiplayer-refresh-criteria.md` first. This newest revision supersedes conflicting earlier rules. Inspect current main/code and preserve unrelated changes; do not assume a previous chat's implementation state. Work on a feature branch. This prompt authorizes implementation of its stated session scope, not deploying, merging or publishing. Update the relevant KB with actual behavior, evidence and limitations; do not claim unsupported physics or ask again about settled MR01–MR19 choices.

Prerequisite: start from merged/reviewed sessions 1 and 2; read both implementation handoffs. Own rendering and interaction against their real event/result interfaces; do not fork rule/solver state or reintroduce retired modes/catalogues.

Implement:
- Usable multiplayer-only 15×15 board/camera/fit with Euclidean 5/7/10 card maxima, legal shorter spans and quarter ports. Restore bold/opaque legal targets near the pointer and smooth fade farther away. Keep chosen/armed/depth-overlapping targets precise, all legal directions accessible, stable hit identity and keyboard/touch/cycling parity.
- Only current standard member/cable/two spring variants. Springs show TWO SIMPLE COILS, one from each endpoint, as one analytical spring; k never derives from visual halves. Reuse procedural/shared meshes and LOD rather than per-frame allocations. Do not revive truss/HSS/wide-flange card galleries.
- Node-only connection appearance with clear 1/2/3 restrained-rotation DOF glyphs and selected frame details. No bulky connector hardware, player translation controls or correction columns/new bases. Distinguish original card mask and local system safety overrides/reactions. Starting column/foundation is locked.
- Inspect element -> property panel showing card/owner/family, actual/max length/units, endpoints/quarter ports, masks, spring k₀/multiplier/k, setup status and valid checkpoint results/overrides. Edit only draft printed choices; committed/setup properties read-only. Keep panel persistent until closed/change selection; no automatic solver call.
- Fix axial load-path vectors from CALCULATED SIGNED AXIAL FORCE: tension moves midpoint OUT toward both end nodes; compression moves both ends IN toward midpoint. Use valid segment signs when quarter subdivision varies; zero/slack/unknown has no moving flow. Cable compression is diagnostic. Reduced motion uses static arrows. Label historical/stale result geometry between checkpoints, never fake current forces. Keep flow magnitude separate from physical thickness and deflection contour.
- Quit/Menu at every phase, including privacy/modal/analysis/correction/animations. Use session-2 suspension hooks, preserve resumable state/draw/window and private cover; no implicit end-turn, redraw, final solve or forfeiture.

Relevant criteria: controls, geometry, DOFs, visualization and MR01–MR19. Browser-check actual layout/model picking at desktop/narrow widths; test inspector permissions, overlay non-mutation, sign mapping, target fading versus legality, input interruption and quit/resume. Run focused checks/typecheck/build and measure representative target/mesh performance. Preserve animation hooks for session 4 rather than emitting synthetic duplicate game events.

Handoff: commit; write `docs/implementation-handoffs/session-3.md` with screenshots/observed behavior where available, target/panel/flow event interfaces, accessible alternatives, tests and remaining rendering limitations for session 4.
```
