---
title: "Turn, Deck and Connection Criteria"
last_validated: 2026-11-14
validated_against:
  - "Project owner turn definition and follow-up answers, 2026-11-14"
  - docs/kb/solver-criteria.md
  - apps/web/src/solver/voxelInput.ts
  - apps/web/src/solver/voxelSections.ts
  - apps/web/src/game/store.ts
  - packages/solver-contract/src/index.ts
owner: project owner
status: needs-review
---

# Turn, Deck and Connection Criteria

## 1. Status and confirmed rules

This is a design specification, not implemented behavior. It extends the [solver criteria](solver-criteria.md) and supersedes earlier turn proposals only where the owner has confirmed a rule here. The existing voxel editing and challenge rules do not implement this system.

The owner confirmed:

- Two separate decks: deck 1 contains elements and loads; deck 2 contains connections.
- At the start of every turn, draw two cards from each deck, four total.
- Play **up to one element, one load and two connections**. These are independent maximums; playing fewer cards, including passing, is allowed.
- One connection card attaches **one member end to a shared joint**. A new member normally needs two cards to connect both ends.
- At turn end, solve the structure and identify instability or other issues introduced into the shared structure.
- Keep a move that introduces issues and deduct **1 point per turn** with a verified new or worsened issue, regardless of affected object count. Persistent unchanged issues and unresolved solver results do not trigger deductions.
- Shared access permits new loads and end attachments on the shared structure, including opponents' members. Placed connections cannot be edited or replaced, including by their owner; new members may frame into an existing joint through their own new connection cards.
- Each player has only their starting foundation. Foundations are not drawable or playable cards.
- Base-game load cards are persistent downward gravity loads only; no lateral-force or moment cards.

Remaining rules are proposals unless explicitly confirmed. Recommendations make the draft reviewable; they are not silently finalized rules. A playable match must configure its unresolved policies first.

## 2. Match setup and deck 1

Proposed setup retains the solver criteria's 2–4 players, each with one fixed foundation and one initially connected column. Setup pieces/connections do not consume turn draws or plays. Validate the starting structure and store the initial analysis as the comparison baseline. Foundation ownership is explicit; no player can add a second foundation through a card. Opening hand, seating, starting geometry, deck composition and match duration remain balance decisions.

Each card has a unique instance ID and a versioned definition ID. It occupies exactly one location: draw pile, hand, deployed structure or discard pile. Deployed cards remain attached to the objects they created and cannot be recycled by reshuffling. Record shuffle algorithm/seed, deck order, draw positions and discard order for deterministic replay. Proposed information policy: private hands, public placements and issue reports.

Deck 1 covers all documented structural families. Names below identify the current experimental catalog; they are not validated numerical properties or final balanced cards.

| Family | Proposed contents and semantics |
| --- | --- |
| Beam-column | SHS 100×6 steel, Glulam 200×400, IPE 300 steel and HEB 300 steel. Beam versus column follows orientation, not a different formulation. |
| Axial brace | Required by solver criteria M03 but absent from the voxel catalog. Section, material and capacities need definition. |
| Tension-only cable | Cable Ø24 is the current example. Each card defines rest length or initial strain and pretension; do not silently apply the prototype's 25 kN pretension to every cable. |
| Load | Point load 50 kN is the current example. Confirmed base deck uses persistent downward gravity point loads with printed magnitudes. Lateral-force and moment cards are excluded from the base game. |
| Foundation / support | Setup-only by owner decision. Not included in either deck; no turn play adds a foundation. |

An element card places one member, not an entire multi-member assembly or a foundation. Each member definition specifies lengths, orientation/section roll, E, G, A, Iy, Iz, J where relevant, capacities and self-weight policy. Player choices must stay within printed options. One load card uses one load allowance even if its defined load has several vector components.

A load targets an explicit joint or member-end interface, not mere coordinate coincidence. Gravity loads persist; removal requires an explicit separate rule. A load on an unsupported or unstable target is reportable physics, not automatically an illegal placement. Interior attachments and distributed loads remain deferred until subdivision/equivalent-load semantics are defined. Crossing members never connect automatically.

## 3. Deck 2: six-DOF connection design

Use **named presets backed by one six-axis schema**. For each local DOF the card defines `free`, `locked` or `elastic`. The card fixes its laws, stiffnesses and capacities; the player chooses only permitted orientations. Custom profiles are authored card definitions, not a way for players to invent arbitrary stiffnesses during play.

Order the axes `(UX, UY, UZ, RX, RY, RZ)`, conjugate to `(FX, FY, FZ, MX, MY, MZ)`. `L` means exact relative-motion lock; `F` means free with zero transferred generalized force; `E` means a specified elastic law. Locked does not mean infinitely strong: capacity is a separate card property. Translational stiffness uses force/length; rotational stiffness uses moment/radian in the agreed unit system.

| Proposed preset | UX | UY | UZ | RX | RY | RZ | Behavior |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Fixed / moment | L | L | L | L | L | L | Transfers all forces and moments. |
| Ball joint / 3D pin | L | L | L | F | F | F | Transfers forces, permits all relative rotations. |
| Hinge about X | L | L | L | F | L | L | Permits one rotation; may orient to Y/Z if printed options allow. |
| Slider along X | F | L | L | L | L | L | Permits one translation. |
| Cylindrical about X | F | L | L | F | L | L | Permits translation and rotation along/about one axis. |
| Planar bearing, normal Z | F | F | L | L | L | F | Permits in-plane motion and rotation about the normal. |
| Semi-rigid moment | L | L | L | E | E | E | Rigid translations; specified rotational springs. |
| Elastic coupler | E | E | E | E | E | E | Specified springs on all axes. |
| Authored partial release | Per card | Per card | Per card | Per card | Per card | Per card | Any additional validated six-axis profile. |

This covers free, rigid and elastic behavior for every DOF without putting every mathematical combination into the deck. Preset counts/rarities and stiffness/capacity tiers remain balance choices. Bearing presets here are bilateral idealizations: they do not imply friction, contact gaps or lift-off, which require separate validated laws.

**Proposed axes:** global Z is up; local X follows the member's reference direction from end A to B at both ends. Section roll/reference direction defines Y, with a deterministic documented fallback when parallel to X; Z completes the right-handed frame. Store orientation with the connection and show an axis preview. Hinges/sliders/bearings may select permitted axes within that frame. ID reordering must not silently change orientation. Large-rotation relative-motion and spring conventions require solver definition and validation before nonlinear use.

A shared joint is a kinematic interface, not a ground restraint. Each member end has its own connection law to that joint. Adding a third member's connection does not upgrade the earlier two. A foundation provides restraints; an ordinary new joint does not. Attaching a member end to a foundation still uses one connection play, except for starting setup pieces.

An unattached end transfers nothing to a coincident joint. Explicit internal member continuity remains intact. A rigid connector cannot create bending resistance in an axial-only brace/cable. Irrelevant rotations must not acquire artificial stiffness or be mistaken for mechanisms.

One active connector per member end; no stacking to bypass play limits. Placed connections are immutable: no editing, replacing, reorienting, upgrading or voluntary removal, even by their owner. Framing into an existing connection means attaching a new member end to its shared joint with a new card, not changing the existing card or granting its profile to the incoming member. Public joint/interface identity must make this distinction clear. Any future damage/failure-release policy is a separate explicit rule, not a player edit.

Shared access applies regardless of ownership: a player may place permitted loads on an existing shared target and attach an unconnected member end to an existing joint, including on another player's structure. Only cards in the active player's hand may be played. Shared access does not allow moving existing members, deleting loads, stealing cards, changing foundation ownership or editing placed connections.

## 4. Turn lifecycle

| Phase | Required behavior |
| --- | --- |
| Begin | Identify player/turn ID; retain the previous committed model and analysis baseline. |
| Draw | Draw two cards from each deck exactly once; record instance IDs and pile transitions. Reconnect, cancellation and preview cannot redraw. |
| Plan | Stage up to one element, one load and two connections from the hand, in any order. Targets can include objects staged in the same transaction. |
| Preview | Optional provisional analysis. No committed topology/card changes, penalties or authoritative scoring. Temporary incomplete configurations are allowed. |
| End turn | Freeze and validate the complete draft: category limits, card ownership, targets, geometry, permissions and parent model version. Illegal/stale drafts stay in planning with actionable errors. |
| Analyze | Solve the complete proposed topology under recorded model, solver and policy versions, with persistent loads, committed damage and explicit initial strain. Freeze edits; ignore stale responses. |
| Assess | Compare with the prior committed baseline; report new, persistent, worsened, resolved or unknown issues and apply the configured penalty policy. |
| Commit | Atomically record model, cards/piles, analysis validity, issue report and penalty event under one turn ID; advance player. Legal unstable moves remain on the reference grid. |

A pass still draws and resolves the turn. Unused play allowances do not carry forward. Proposed hand policy: unplayed cards remain in hand. The hand limit or any discard/exchange rule must be decided because a player draws four even while passing. Cancelling a draft restores staged cards/objects but does not undo the draw. Repeated submissions are idempotent: one draw, one card consumption and one penalty event per turn.

Proposed deck sizing for initial playtesting: use a 1:1 load-to-element ratio in deck 1, so two draws average one of each; random draws are not guaranteed to contain both. Give every listed member family a nonzero representation. For P players and T planned rounds, each deck needs at least 2 × P × T cards to supply all regular draws without recycling, plus any opening-hand allowance. Exact counts and connection-preset frequencies remain a playtesting decision.

Proposed exhaustion rule: reshuffle only that deck's discard pile; if insufficient, draw what remains and record the shortfall. Never recycle deployed cards or compensate from the other deck. Exhaustion and match-ending policies need confirmation.

## 5. Legality and analysis

Legality belongs to the game engine. Reject unknown/duplicate card IDs, excessive play counts, invalid targets, zero-length/out-of-bounds members, forbidden ownership/connection changes, invalid connector definitions/orientations and incompatible imposed constraints. Invalid input is not a structural penalty. Diagnose redundant constraints under an explicit legality policy; structural redundancy is not itself illegal.

A legal move may leave unconnected ends, introduce a mechanism, slacken a cable, cause uplift or exceed capacity. Those are physical outcomes. Proposed placement policy permits isolated elements and connecting previously placed ends. The final transaction determines assessment, not the sequence of provisional placements.

Reapply persistent loads from the original reference geometry to current topology; preserve committed damage and explicit initial strain. This intentionally allows new members to attract existing loads and is not real staged construction. Keep strength exceedance separate from instability. No automatic dynamic collapse, removal or permanent deformation is implied.

Analyze the entire shared structure, isolating independent components. An optimization may reuse unchanged verified component results only when model/policy versions match. Report effects on opponents and existing members, including regions remote from the played card. Preserve verified results for unrelated stable components.

## 6. Detecting introduced issues

Every issue record includes category, affected stable object IDs/region, severity/utilization where valid, current/prior validity, reason codes and comparison status. Categories include unsupported/disconnected components, rigid-body/internal/near mechanisms, load-induced instability, excessive deformation, member/connection strength exceedance and unresolved analysis. Cable slack and uplift are reported states; penalizing them requires an explicit game rule.

Proposed comparison policy:

| Status | Meaning |
| --- | --- |
| New | Verified issue on a previously verified issue-free region, or on a new object. |
| Persistent | Comparable prior issue remains without a configured worsening threshold crossing. |
| Worsened | Verified comparable issue crosses a configured severity tier/deterioration threshold. |
| Resolved | Prior issue is now verified absent. |
| Unknown | Missing, incompatible or unresolved evidence prevents reliable comparison. |

Use versioned tolerances/hysteresis so roundoff does not trigger penalties. Compare component lineage through stable object IDs when regions merge/split. Do not label an old issue new solely because a new member joins its region. Mode vectors can change basis/sign, so compare physical subspaces/regions, not raw eigenvector IDs. Never assume an unverified region was healthy merely because it lacked valid force results.

Proposed game responsibility: attribute verified adverse changes between consecutive turns to the active player's complete transaction. This does not prove which individual card caused a nonlinear failure. Report changed cards without attributing effects through invalid superposition. Repair can resolve an issue without erasing historical penalty events.

## 7. Penalty and unresolved results

**Confirmed:** keep the move and deduct **1 point** once per turn with at least one verified new or worsened issue, regardless of affected object count. Persistent unchanged issues do not repeat the deduction; unresolved solver results do not trigger a penalty. This avoids counting the same physical event many times through affected nodes/modes. **Pending:** exact eligible categories beyond instability/overload, worsening thresholds and deferred verification. Instability and member/connection overload are the initial proposed eligible categories; do not invent additional penalties for ordinary cable slack or uplift.

Do not infer a physical penalty from timeout, numerical error or `unresolved`. Proposed unresolved policy retains the legal move with unknown scope, schedules bounded reanalysis, withholds new authoritative reaction scoring for that scope, and applies no physical-issue penalty without verification. Whether later verification produces a deferred penalty attached to the originating turn remains open. Prior results must retain their historical version, never masquerade as current valid reactions.

Return signed six-component foundation reactions with validity. Load attraction, uplift/self-weight treatment and cumulative scoring remain game policies. Do not normalize unavailable components into a full 100% share. Retained geometry remains available for repair; permanent releases/removal require an explicitly enabled bounded failure policy.

### Worked turn example

Player A draws two deck-1 cards and two deck-2 cards. From their accumulated hand they stage an IPE member, one gravity load, a fixed connection at the new member's first end, and a ball joint connection at its second end. The second end frames into a joint already used by Player B. Player B's existing connector remains unchanged; the new ball-joint law applies only to A's incoming end. The load may target that shared joint under shared-access rules.

The draft may be unstable before the second connector is placed; that preview has no penalty. On end turn the complete shared model is analyzed. If a previously verified member on Player B's frame now exceeds capacity, the issue report identifies that existing member and the active turn, even though A's new member is not itself overloaded. The legal move remains and produces a 1-point deduction for A's turn, even if several members have new verified issues. If an old issue merely persists, it does not add a deduction. If the affected region is unresolved, it receives no invented utilization, reaction score or physical-issue penalty.

## 8. Persistence and acceptance criteria

Record turn/player IDs, parent/committed model versions, rules/deck/card versions, draws/pile transitions, played instances, topology/connection IDs and orientations, persistent loads, solver version/options, component results/validity, issue comparisons and penalty amount/reason/policy version. Keep private hands/decks out of public views. Store the authoritative result or enough for deterministic recomputation. Recover interrupted commits without half-committed state, redraws or duplicate consumption. Timing-dependent limits must return explicit unknown scope rather than fabricated valid classifications.

The following tests are required when implementing this design; they are not current test coverage:

| Scenario | Required result |
| --- | --- |
| Begin, cancel, reconnect, retry | Two draws per deck once; no duplicate card or penalty events. |
| Play caps / mixed hand / pass | Separate 1/1/2 limits enforced; missing categories never force a play; pass allowed. |
| Exhaustion and retention | Deterministic configured reshuffle/shortfall/hand behavior. |
| End connections / shared joint | Two ends normally consume two cards; third attachment does not modify earlier connectors. |
| Six-axis profiles / rotated fixtures | Free axes transfer nothing, exact locks preserve compatibility, elastic laws/capacities verified; equivalent transformed response. |
| Coincident disconnected geometry | No force transfer or leaked foundation fixity without intentional connection. |
| Preview instability / final repair | No preview penalties; final transaction alone is assessed. |
| Remote shared-structure effects | Existing/opponents' regions assessed; actual equilibrium determines reactions. |
| Persistent, worsened, repaired issue | Correct history, tolerance and configured penalty aggregation. |
| Merge/split / unresolved region | No spurious new issue from renaming; unknown is not treated as stable; unrelated valid results preserved. |
| Shared access / immutable connections | Opponent structures accept new permitted loads/end attachments; existing connectors cannot be edited, replaced or removed. Incoming cards never alter earlier profiles. |
| Replay / interruption | Equivalent cards, classifications and penalties with no partial/duplicate commit. |

## 9. Questions still to resolve

1. Penalty eligibility beyond instability/overload, worsening thresholds and deferred verification. The 1-point amount, per-turn aggregation and no repeat/unknown penalties are confirmed.
2. Repair: proposed base play repairs by adding members/connections; removal or modification of placed cards is not authorized. Placed connections remain immutable.
3. Foundations are confirmed setup-only; starting layout and column properties still need definition.
4. Card economy: opening hand, retention/cap/discard/exchange, deck sizes, load-to-element ratio, connection frequencies and exhaustion.
5. Loads: magnitudes, eligible targets, self-weight and removal. Persistent downward gravity only is confirmed for the base deck.
6. Placement: lengths, isolated elements and interior attachment. Shared access to existing joints is confirmed.
7. Match: setup/order, turn limit/end condition, reaction scoring, penalty interaction and victory/ties.

Documentation review checked the named member families against `voxelInput.ts`/`voxelSections.ts` and the solver requirements; no turn implementation or numerical validation is claimed.

Confirmed rules can guide contract design now. Unanswered policies must remain explicit; recommendations are not agreed or implemented behavior.
