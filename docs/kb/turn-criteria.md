---
title: "Turn, Deck and Connection Criteria"
last_validated: 2026-11-14
validated_against:
  - "Project owner turn definition and follow-up answers, 2026-11-14"
  - docs/kb/solver-criteria.md
  - docs/kb/game-completion-criteria.md
  - docs/kb/placement-criteria.md
  - docs/kb/scoring-match-criteria.md
  - docs/kb/element-representation-criteria.md
  - docs/kb/joint-dof-criteria.md
  - "Project owner shared-joint freedoms revision, 2026-11-14"
  - apps/web/src/solver/voxelInput.ts
  - apps/web/src/solver/voxelSections.ts
  - apps/web/src/game/store.ts
  - packages/solver-contract/src/index.ts
owner: project owner
status: needs-review
---

# Turn, Deck and Connection Criteria

## 1. Status and confirmed rules

This specification extends the [solver criteria](solver-criteria.md) and supersedes earlier turn proposals where the owner has confirmed a rule here. The [Shared table playtest](unified-runtime.md#shared-table-playtest) implements local card draws, staging and commits with explicit attachments. Verifying end-turn issues and applying the confirmed penalty require compatible analysis.

**Later joint decision — 2026-11-14:** all member ends intentionally attached to one shared joint must use the same connection freedoms, and foundations are fully fixed by default. This replaces earlier independent release-profile choices at one joint. It does not remove per-end attachment/card identity. [Joint DOF criteria](joint-dof-criteria.md) define the visualization and proposed compatibility workflow. The current per-end playtest does not yet enforce this revised rule.

**Later completion decisions — 2026-11-14:** [Core game decisions](game-completion-criteria.md#2-owner-confirmed-decision-register) confirm final-only load-share percentage minus penalties, fixed rounds, local hot-seat privacy, grid/diagonal placement, quarter attachments for every family, no physical clashes, assembly cards using one element play and retained structures repaired through additions. These supersede earlier contradictory proposals below; implementation and numerical validation are pending.

The owner confirmed:

- Two separate decks: deck 1 contains elements and loads; deck 2 contains connections.
- At the start of every turn, draw two cards from each deck, four total.
- Play **up to one element, one load and two connections**. These are independent maximums; playing fewer cards, including passing, is allowed.
- One connection card attaches **one member end to a shared joint**. A new member normally needs two cards to connect both ends.
- At turn end, solve the structure and identify instability or other issues introduced into the shared structure.
- Keep a move that introduces issues and deduct **1 point per turn** with a verified new or worsened issue, regardless of affected object count. Persistent unchanged issues and unresolved solver results do not trigger deductions.
- Shared access permits new loads and end attachments on the shared structure, including opponents' members. Placed connections cannot be edited or replaced, including by their owner; new members may frame into an existing joint through their own new connection cards.
- All member ends attached to a shared joint use the same connection freedoms; matching must respect physical axis orientation. Placed connections remain immutable.
- Foundations are fully fixed by default (six ground restraints locked). Connection releases are a separate subject from ground restraints.
- Each player has only their starting foundation. Foundations are not drawable or playable cards.
- Base-game load cards are persistent downward gravity loads only; no lateral-force or moment cards.

Remaining rules are proposals unless explicitly confirmed. Recommendations make the draft reviewable; they are not silently finalized rules. A playable match must configure its unresolved policies first.

## 2. Match setup and deck 1

Proposed setup retains the solver criteria's 2–4 players and one initially connected column per player. Each starting foundation is fully fixed by confirmed default. Setup pieces/connections do not consume turn draws or plays. Validate the starting structure and store the initial analysis as the comparison baseline. Foundation ownership is explicit; no player can add a second foundation through a card. Opening hand, seating, starting geometry, deck composition and match duration remain balance decisions.

Each card has a unique instance ID and a versioned definition ID. It occupies exactly one location: draw pile, hand, deployed structure or discard pile. Deployed cards remain attached to the objects they created and cannot be recycled by reshuffling. Record shuffle algorithm/seed, deck order, draw positions and discard order for deterministic replay. Proposed information policy: private hands, public placements and issue reports.

The initial proposed deck 1 catalogue below reflects the existing experimental families; it is not validated numerical data or a finalized balanced deck. The later [element representation criteria](element-representation-criteria.md) also require axial springs, planar/trichord assemblies and expanded section geometry. The later owner decision in [placement criteria](placement-criteria.md) now authorizes one assembly card per element play, with one connection card per external attachment. Actual catalogue definitions, internal physics, port geometry and deck balance still require implementation/review.

| Family | Proposed contents and semantics |
| --- | --- |
| Beam-column | SHS 100×6 steel, Glulam 200×400, IPE 300 steel and HEB 300 steel. Beam versus column follows orientation, not a different formulation. |
| Axial brace | Required by solver criteria M03 but absent from the voxel catalog. Section, material and capacities need definition. |
| Tension-only cable | Cable Ø24 is the current example. Each card defines rest length or initial strain and pretension; do not silently apply the prototype's 25 kN pretension to every cable. |
| Load | Point load 50 kN is the current example. Confirmed base deck uses persistent downward gravity point loads with printed magnitudes. Lateral-force and moment cards are excluded from the base game. |
| Foundation / support | Setup-only by owner decision. Not included in either deck; no turn play adds a foundation. |

An ordinary element card places one member. By later owner decision, a planar/trichord assembly card places one complete authored assembly using one element play; each external attachment still needs its own connection card, within the two-connection-per-turn maximum. Internal authored parts/continuity do not consume extra player cards. No element card places a foundation. Each member definition specifies lengths, orientation/section roll, E, G, A, Iy, Iz, J where relevant, capacities and self-weight policy. Player choices must stay within printed options. One load card uses one load allowance even if its defined load has several vector components.

A load targets an explicit eligible joint/member-end interface or a permitted activated quarter port under the authored target rules, not mere coordinate coincidence. Gravity loads persist; removal requires an explicit separate rule. A load on an unsupported or unstable target is reportable physics, not automatically an illegal placement. Interior attachments are now required at original-reference quarter points only, for every element family; compatible subdivision/port laws must be validated before supported scored play. Distributed loads remain deferred. Unconnected elements are allowed but physical clashes are forbidden; projected crossing never connects automatically. See [placement criteria](placement-criteria.md).

## 3. Deck 2: six-DOF connection design

Use **named presets backed by one six-axis schema**. For each connection DOF the card defines `free`, `locked` or `elastic`; all attached ends at one joint must agree on the permitted physical directions and freedom states. The owner confirmed that elastic stiffness values may differ between attachments with matching freedom states and physical axes. The card fixes its laws, stiffnesses and capacities; the player chooses only permitted orientations. Custom profiles are authored card definitions, not a way for players to invent arbitrary stiffnesses during play.

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

**Revised proposed axes:** global Z is up. Use a stored canonical joint connection frame/profile, transformed explicitly into each member’s analytical frame, so matching freedoms have the same physical orientation. The earlier per-member frame proposal cannot independently orient each attached end’s release law at a shared joint. Joint-frame initialization and permitted first-attachment choices remain to define. Show an axis preview; the DOF overlay defaults to global axes with local axes available on selection. Rotated anisotropic laws may couple global components; matching preset names alone is insufficient. ID reordering must not change physical orientation. Large-rotation relative-motion and spring conventions require solver definition and validation before nonlinear use.

A shared joint is a kinematic interface, not a ground restraint. Each member end has its own attachment identity, but all attached ends at that joint must use the same freedoms. Adding a third attachment must match the common profile and cannot upgrade the earlier two. The two ends of a member may use different profiles at different joints. A foundation supplies ground restraints; an ordinary joint does not. Ground fixity does not silently prescribe the incoming connector’s release profile. Attaching a member end to a foundation still uses one connection play, except for starting setup pieces.

An unattached end transfers nothing to a coincident joint. Explicit internal member continuity remains intact. A rigid connector cannot create bending resistance in an axial-only brace/cable. Irrelevant rotations must not acquire artificial stiffness or be mistaken for mechanisms.

One active connector per member end; no stacking to bypass play limits. Placed connections are immutable: no editing, replacing, reorienting, upgrading or voluntary removal, even by their owner. Framing into an existing joint requires a new card attaching the incoming end with matching freedoms in physical axes; it does not change existing cards or waive the card cost. Proposed legality policy rejects incompatible profiles while preserving the draft; profile establishment, numerical comparison tolerances and legacy migration remain open. Different elastic stiffness values are allowed and remain attached to their individual connector definitions. Public joint/interface identity must make this distinction clear. Any future damage/failure-release policy is a separate explicit rule, not a player edit.

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
| Assess | Compare pre-correction candidate with the compatible prior baseline; record verified new/worsened issues and one eligible penalty. Then run the recorded game-owned correction/reanalysis process for instability and overload, preserving original evidence. |
| Commit | Atomically record player move/cards, pre-correction evidence, game-owned repair objects/post-correction validity, issue report and historical penalty under one turn ID; advance player. Preserve truthful pending scope if bounded correction cannot be verified. |

A pass still draws and resolves the turn. Unused play allowances do not carry forward. Proposed hand policy: unplayed cards remain in hand. The hand limit or any discard/exchange rule must be decided because a player draws four even while passing. Cancelling a draft restores staged cards/objects but does not undo the draw. Repeated submissions are idempotent: one draw, one card consumption and one penalty event per turn.

Proposed deck sizing for initial playtesting: use a 1:1 load-to-element ratio in deck 1, so two draws average one of each; random draws are not guaranteed to contain both. Give every listed member family a nonzero representation. For P players and T planned rounds, each deck needs at least 2 × P × T cards to supply all regular draws without recycling, plus any opening-hand allowance. Exact counts and connection-preset frequencies remain a playtesting decision.

Proposed exhaustion rule: reshuffle only that deck's discard pile; if insufficient, draw what remains and record the shortfall. Never recycle deployed cards or compensate from the other deck. Exhaustion and match-ending policies need confirmation.

## 5. Legality and analysis

Legality belongs to the game engine. The revised joint requirement demands compatible freedoms at every shared joint; the proposed rejection workflow must not silently edit immutable connections to achieve a match. Reject unknown/duplicate card IDs, excessive play counts, invalid targets, zero-length/out-of-bounds members, forbidden ownership/connection changes, invalid connector definitions/orientations and incompatible imposed constraints. Invalid input is not a structural penalty. Diagnose redundant constraints under an explicit legality policy; structural redundancy is not itself illegal.

A legal move may leave unconnected ends, introduce a mechanism, slacken a cable, cause uplift or exceed capacity. Those are physical outcomes. Proposed placement policy permits isolated elements and connecting previously placed ends. The final transaction determines assessment, not the sequence of provisional placements.

Proposed numerical turn policy reapplies persistent loads from reference geometry to current topology and preserves explicit initial strain. The confirmed standard game retains structures without automatic damage/removal; only an explicitly enabled future variant may commit damage. This intentionally allows new members to attract existing loads and is not real staged construction. Keep strength exceedance separate from instability. No automatic dynamic collapse, removal or permanent deformation is implied.

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

Player A draws two deck-1 cards and two deck-2 cards. From their accumulated hand they stage an IPE member, one gravity load, a fixed connection at the new member's first end, and a ball joint connection at its second end. The second end frames into a joint already used by Player B. The existing shared joint uses ball-joint freedoms, so A’s incoming ball-joint attachment matches it; Player B’s connector remains unchanged. A fixed attachment at that same joint would conflict with the revised common-freedoms rule. The first end’s fixed attachment is at a different, compatible joint. The load may target that shared joint under shared-access rules.

The draft may be unstable before the second connector is placed; that preview has no penalty. On end turn the complete shared model is analyzed. If a previously verified member on Player B's frame now exceeds capacity, the issue report identifies that existing member and the active turn, even though A's new member is not itself overloaded. The legal move remains and produces a 1-point deduction for A's turn, even if several members have new verified issues. If an old issue merely persists, it does not add a deduction. If the affected region is unresolved, it receives no invented utilization, reaction score or physical-issue penalty.

## 8. Persistence and acceptance criteria

Record the common joint profile/frame and explicit attachment IDs as well as turn/player IDs, parent/committed model versions, rules/deck/card versions, draws/pile transitions, played instances, topology/connection IDs and orientations, persistent loads, solver version/options, component results/validity, issue comparisons and penalty amount/reason/policy version. Keep private hands/decks out of public views. Store the authoritative result or enough for deterministic recomputation. Recover interrupted commits without half-committed state, redraws or duplicate consumption. Timing-dependent limits must return explicit unknown scope rather than fabricated valid classifications.

The following tests are required when implementing this design; they are not current test coverage:

| Scenario | Required result |
| --- | --- |
| Begin, cancel, reconnect, retry | Two draws per deck once; no duplicate card or penalty events. |
| Play caps / mixed hand / pass | Separate 1/1/2 limits enforced; missing categories never force a play; pass allowed. |
| Exhaustion and retention | Deterministic configured reshuffle/shortfall/hand behavior. |
| End connections / shared joint | Two ends normally consume two cards; every incoming end matches the joint’s common freedoms in physical axes and does not modify earlier connectors. Mixed-profile legacy data is flagged, not silently coerced. |
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
2. Retained structure and recorded game-owned automatic correction for instability and overload are now confirmed, with Timburr explanation; player additions may also repair issues. Removal or modification of placed player cards is not authorized. Historical penalties are now confirmed to remain after repair. Exact issue thresholds and the requested game-owned automatic correction of instability/overload and its remaining support/lifetime policies are tracked in [failure and repair](failure-repair-criteria.md).
3. Foundations are confirmed setup-only; starting layout and column properties still need definition.
4. Card economy: opening hand, retention/cap/discard/exchange, deck sizes, load-to-element ratio, connection frequencies and exhaustion.
5. Loads: magnitudes, eligible targets, self-weight and removal. Persistent downward gravity only is confirmed for the base deck.
6. Placement: grid/diagonal and original-quarter-only attachment across all families, no physical clashes and assembly card economy are confirmed. Board/tolerances, fitting geometry and validated quarter analytical laws remain to define; see [placement](placement-criteria.md).
7. Match: fixed rounds and final load-share percentage minus accumulated penalties, highest adjusted score wins, are confirmed. Exact round count, load/uplift/zero policy and ties remain in [scoring](scoring-match-criteria.md).
8. Joint compatibility: first-attachment/setup-profile establishment, canonical frame conventions, numerical matching tolerances and legacy mixed-profile handling. Matching freedoms/axes with potentially different elastic stiffnesses, and fully fixed foundation defaults, are confirmed; the enforcement/migration details remain proposed.

Documentation review checked the named member families against `voxelInput.ts`/`voxelSections.ts` and the solver requirements; the local card lifecycle is implemented, with numerical verification pending.

Confirmed rules can guide contract design now. Unanswered policies must remain explicit; recommendations are not agreed or implemented behavior.
