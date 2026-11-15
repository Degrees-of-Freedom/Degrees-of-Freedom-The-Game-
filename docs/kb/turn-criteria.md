---
title: "Turn, Deck and Connection Criteria"
last_validated: 2026-11-14
validated_against:
  - "Project owner multiplayer simplification and follow-up answers, 2026-11-14"
  - docs/kb/multiplayer-refresh-criteria.md
  - docs/kb/saved-match-criteria.md
  - docs/kb/solver-criteria.md
owner: project owner
status: needs-review
---

# Turn, Deck and Connection Criteria

## 1. Status and confirmed rules

The [multiplayer refresh](multiplayer-refresh-criteria.md) is the latest authority. Criteria only: the current code may still implement older limits. Multiplayer is the only target game type, initially private local hot-seat.

- Draw **four cards total** per player turn. Choose elements/loads or connections independently for each draw; any split, including 4/0 or 0/4, is valid when the deck has cards.
- Play any number of elements, connections **and loads** in the player's hand, or pass. Remove the old independent 1/1/2 limits. No played instance can be spent twice.
- Each incoming end/quarter attachment still needs its own connector instance; touching/crossing never connects automatically.
- Exactly one default foundation and its starting column per player, fully fixed and immutable. No playable or automatic extra foundation.
- Connections control only rotation, using 1-, 2- or 3-restrained-axis card types. Intentional connected translations are compatible, not editable translation laws.
- Automatic numerical checkpoints occur every 3 completed player turns globally by default, interval editable in Settings, and at match end. Noncheckpoint commits are unsolved, not stable.
- At checkpoints replay pending turns and attribute at most one verified new/worsened eligible -1 to each responsible original turn/player. Penalties remain after repair; unknown or unchanged issues do not generate deductions.
- Keep player moves and make minimum local safety-restraint corrections, never columns down or new bases. Timburr explains the correction. System correction is not a card play.

## 2. Match setup and deck 1

Use the published fixed-round multiplayer ruleset and player count. The horizontal field is 15×15; current working interpretation is 15 cells per axis (0..15 positions). Publish vertical extent and exact game-unit/SI conversion. Initial foundations/columns and their fully fixed attachments cannot be edited, moved, removed or relaxed. Setup pieces do not consume hand cards.

The elements/loads deck contains the standard axial+bending beam-column, tension-only cable, 0.25k₀ spring, 0.5k₀ spring and gravity load cards. No planar/trichord assemblies, section/material variants, independent brace, foundation or other game-type cards in the active deck. Maximum member lengths are 5, 7 or 10 game units; positive permitted shorter spans are valid. Use Euclidean length for diagonals, not per-axis maximum reach. Exact k₀, section/capacity/load values and counts remain authored versioned parameters.

Each source-deck selection is one recorded draw action. Cancellation/reload/readiness cannot reroll a drawn card. Define deck exhaustion explicitly before release; do not force a fixed 2/2 split or borrow from another deck without player choice. Unplayed cards remain in hand under the initial proposed retention policy; hand limits/discard rules are still versioned balance decisions, not hidden new play caps.

## 3. Deck 2: six-DOF connection design

The historical six-component mechanics model remains available to the solver, but the **player deck has only rotational masks**:

| Card type | Player choice | Connected translation |
| --- | --- | --- |
| Restrain 1 rotation | Choose one permitted RX/RY/RZ axis | Compatible by explicit attachment |
| Restrain 2 rotations | Choose a permitted pair of axes | Compatible by explicit attachment |
| Restrain 3 rotations | RX, RY and RZ restrained | Compatible by explicit attachment |

Remaining rotations are released. No 0-restraint ball card, translational release/restraint slider card or elastic connector card is offered. Store actual axes/frame and immutable card/attachment identity. Cables/springs must not gain bending resistance from irrelevant rotational DOFs.

Shared-joint rotational freedoms continue to match in physical axes. Starting column/foundation fixity is an immutable exception to any attempt to lower a node's mask; only compatible incoming attachments are legal. Node appearance is one compact DOF glyph, not connector hardware along each member. Original player mask and system corrective overrides are separate layers; only a declared game-owned correction may override effective behavior, never a silent player edit.

## 4. Turn lifecycle

| Phase | Required event and behavior |
| --- | --- |
| Begin/draw | Announce active player; collect four independent source choices/card arrivals exactly once under privacy policy. |
| Plan | Stage/edit/cancel any held cards within printed choices; retain exact card, endpoint, quarter-port and joint IDs. |
| End turn | Validate the entire draft, card ownership, lengths, bounds, clashes, locked setup pieces and rotational compatibility; reject actionable illegal input without a physical penalty. |
| Noncheckpoint commit | Atomically consume played cards/save topology and mark this turn pending analysis. Advance via private handoff, saying when the next checkpoint is due. No numerical solve. |
| Due checkpoint | Freeze the ordered window and rules/solver/settings versions; replay/assess original turns, apply bounded minimal local corrections and verify current result. |
| Checkpoint report | Name originating turns/players, issues, one-per-turn penalties, local system constraints/reactions and verified/pending scope. Do not blame only the checkpoint player. |
| Final turn | Resolve a checkpoint once even when due and final coincide, then finalize the fixed-round adjusted share result. |
| Quit/resume | Available in every phase; suspend/resume exact state without implicit pass/commit/finalization/redraw. |

Apply [animation criteria](animation-criteria.md) to every event; state changes are authoritative before decorative completion. Skip never consumes extra cards or bypasses verification.

## 5. Legality and analysis

Use [placement criteria](placement-criteria.md), including original-reference quarter points on every current family, no physical clashes and fixed starting objects. Invalid/stale input is not a physical issue. No automatic preview or inspection solve bypasses the checkpoint interval. Geometric validation is allowed between checkpoints.

Maintain separate last-attempted/last-verified checkpoint and current model/version. Old forces are explicitly historical. Pending turns are not certified stable. Reuse a reviewed initial setup fixture/baseline; any exceptional setup numerical analysis must be declared. Keep solver selection/settings/provenance truthful across Rust/OpenSees capabilities; an unsupported feature cannot silently become a fake success.

## 6. Issue attribution across checkpoints

Replay pending turns in recorded order at the scheduled checkpoint, preserving the player live history and recording retrospective correction lineage explicitly. Compare compatible verified baselines and group reasons by originating turn. Penalty cap is one per responsible turn, not one per checkpoint and not per object. Interrupted/repeated checkpoints deduplicate evidence, correction and deductions. Unknown baselines must not establish blame.

A correction introduced during replay cannot relocate/delete a later recorded player placement. Use a compatible local correction or mark unknown scope. Details and acceptance fixtures are in [refresh section 4](multiplayer-refresh-criteria.md#4-delayed-issue-attribution-and-correction).

## 7. Penalty and unresolved results

Historical -1 events remain after repair. No new deduction for unchanged issues, display changes, a numerical timeout or an unknown replay. Minimum local constraints replace older scaffold/anchor/vertical-column repairs. System-only translation restraint is permitted only when required and is recorded with an unscored neutral reaction. No new foundation object is created.

Final attraction uses verified player foundation reactions divided by total applied gravity, minus accumulated penalties. Corrective restraint reactions count in corrected-model equilibrium but never in player attraction numerators. Unavailable components earn no attraction under the confirmed fallback; do not invent zero physical reactions or renormalize into 100%.

## 8. Persistence and acceptance criteria

Save draw choices/positions, all card locations, unrestricted played-card lists, originating turn IDs, original/effective rotational masks, frozen setup data, pending checkpoint window, interval change events, last attempted/verified checkpoint, repair constraints/reactions and penalty provenance. Atomic/recoverable state and private resume are governed by [saved-match criteria](saved-match-criteria.md).

Required fixtures: four arbitrary source draws; many member/load/connector plays; pass; shorter/diagonal lengths under 5/7/10; no old caps; fixed default setup; no extra foundations; turns 1/2 without solves and turn 3 with a checkpoint; final/due deduplication; interval changes; multiple responsible turns in one report; unknown baseline; quit/reload during each phase; muted/reduced/skipped animation and no duplicate effects.

## 9. Questions still to resolve

Actual card/capacity/k₀/load values, deck counts/exhaustion/retention, match/player presets, vertical field extent, supported Settings interval bounds, joint-profile establishment/tolerances, local correction budgets and tie/uplift/self-weight/zero-load policies remain explicit parameters. Cadence basis, four source-selectable draws, unlimited plays including loads, draft-only physical editing, and removal of every nonmultiplayer game type are settled.
