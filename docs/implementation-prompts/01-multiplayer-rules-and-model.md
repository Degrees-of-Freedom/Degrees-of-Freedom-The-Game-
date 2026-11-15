# Session 1 — Multiplayer rules, catalogue and state

Copy the prompt below into a separate Codex/Claude session. Run in the stated order.

```text
Read `AGENTS.md`, `docs/kb/README.md` and `docs/kb/multiplayer-refresh-criteria.md` first. This newest revision supersedes conflicting earlier rules. Inspect current main/code and preserve unrelated changes; do not assume a previous chat's implementation state. Work on a feature branch. This prompt authorizes implementation of its stated session scope, not deploying, merging or publishing. Update the relevant KB with actual behavior, evidence and limitations; do not claim unsupported physics or ask again about settled MR01–MR19 choices.

Prerequisite: start from current main. Own the common rules/model/state foundation for sessions 2–4; do not build a second game engine or new game types.

Implement:
- Multiplayer Shared table as the only game type. Remove retired game-type menus/routes/setup/help actions and active branches. Preserve old saves safely as legacy/read-only or explicit migration, never wipe them. Preserve the existing default multiplayer visual environment and working Rust/OpenSees interfaces.
- 15×15 horizontal field (document coordinate/cell convention and height), one immutable fully fixed default foundation and starting column per player, and no drawable additional foundations.
- Exactly four draws per turn, source deck chosen independently for each draw; any number of held members/connections/loads may be played. Remove 2/2 split and all 1/1/2 limits. Preserve unique instance accounting, cancel/pass/hot-seat handoff and deterministic replay.
- Exactly four member variants: standard axial/bending beam-column, tension-only cable, axial spring 0.25k₀ and 0.5k₀. Publish k₀ in N/m and resolved standard properties; use reviewed existing data where valid, and raise genuinely missing numerical choices rather than inventing engineering values. Remove retired cards from active decks without deleting useful backend fixtures.
- Max-length card tiers only 5/7/10 game units; shorter spans allowed; Euclidean diagonal length, explicit unit conversion and original-quarter ports. No per-axis cube masquerading as a length limit.
- Only three player connection types, restraining 1/2/3 chosen rotational axes. Connected translations remain compatible; no player translation/elastic laws or 0-lock card. Preserve shared-joint axis compatibility and locked setup. Committed physical properties read-only, draft edits bounded by cards.
- Versioned match fields/event contracts for solve interval default 3, committed-turn counter, last attempted/verified checkpoint, pending original-turn window, player-mask versus system-correction layers and quit/resume phase. Build the contract/hooks; session 2 owns structural scheduling/attribution.

Relevant sources: turn/card/placement/multiplayer/saved-match criteria. Validate many plays, four arbitrary deck choices and reload, 5/7/10 shorter/diagonal boundaries, four variants/three masks, locked setup/no extra foundation, legacy safety and no retired mode entry. Run focused tests, typecheck and build. Do not add avatar/UI polish, solve on every edit or fake unsupported spring/quarter laws.

Handoff: commit changes; write `docs/implementation-handoffs/session-1.md` with base/result commits, files/interfaces, finalized and still-open physical parameters, commands/results, migration behavior and exact integration points for session 2. Do not mark numerical capability complete solely because a schema accepts it.
```
