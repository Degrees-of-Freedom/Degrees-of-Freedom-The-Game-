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
  - apps/web/src/evaluator/model.ts
  - apps/web/src/evaluator/sections.ts
  - apps/web/src/game/store.ts
  - packages/solver-contract/src/index.ts
owner: project owner
status: needs-review
---

# Turn, Deck and Connection Criteria

## 1. Status and confirmed rules

This specification extends the [solver criteria](solver-criteria.md) and supersedes earlier turn proposals where the owner has confirmed a rule here. The [Shared table playtest](unified-runtime.md#shared-table-playtest) implements local card draws, staging and commits with explicit attachments. Verifying end-turn issues and applying the confirmed penalty require compatible analysis.

**Later joint decision — 2026-11-14.** All member ends intentionally attached to one shared joint must use matching physical directions and connection freedoms. Foundations are fully fixed by default. Each attachment retains its own immutable card. The first connector establishes the common permissions. An incompatible incoming card stays in hand. The optional six-axis frame deck implements this rule for fixed, ball, directional hinge, guide and elastic printings. [Joint DOF criteria](joint-dof-criteria.md)

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
- Each player has only their starting foundation. Player foundations are not drawable/playable cards. Neutral system-repair scaffolding/ground anchors are an explicit owner-confirmed exception, earn no player attraction points and remain for the match; they are not a new player foundation.
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
| Player foundation / support | Setup-only and not included in either deck. No player card play adds a foundation. Permanent unscored neutral repair anchors are a separate system-only exception. |

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

The optional `shared-table-joints-1` frame catalogue deals seven printings. The diagonal hinge releases rotation about horizontal (+X,+Y)/√2. The X guide releases global X translation. The two elastic seats allow global Z translation with 20 or 80 MN/m stiffness. The yaw fitting allows global Z rotation with 8 MN·m/rad stiffness. Each of those five fittings locks its remaining components and has a provisional elliptical capacity interaction with intercepts of 400 kN resultant force and 80 kN·m resultant moment. Their directions are fixed on the printing. The original fixed and ball values and previous seeded decks are preserved.

In the small-displacement browser frame solver, each flexible component has its own relative end motion. The solver eliminates these internal coordinates from the stiffness matrix, recovers them for the signed end actions and independently checks every connector law on its physical axes. Compression screening uses the internal connector tangent at the trial load factor. A free translation or a moment applied along a free rotational axis can leave the structure unstable. An unloaded pure joint spin contributes zero stiffness and zero reaction. OpenSees HTTP continues to expose the connection types its own request contract supports. [Analytical fixtures](../../apps/web/src/solver/voxel/frameConnections.test.ts)

The seed-1 playthrough applied a 10 kN gravity card to Player 2's 20 MN/m seat on turn six, then reloaded the committed turn. Relative vertical movement measured −0.500 mm, the supported foundation received +10 kN and the seat used 0.025 of its printed capacity. The replay test adds an 80 MN/m connector at that same joint and exercises an incompatible hinge. [Browser runner](../evidence/elastic-joints/check.mjs) · [Earlier printing](../evidence/elastic-joints/before-printing.png) · [New printing](../evidence/elastic-joints/after-printing.png) · [Replay test](../../apps/web/src/game/jointCatalogue.test.ts)

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

**Confirmed scored preset.** Keep the move and deduct **1 point** once per turn with at least one verified new or worsened eligible issue, regardless of affected object count. The owner approved witnessed instability and verified member/connection overload, including system pieces. The versioned playtest enters overload above 1.001 utilization, clears below 0.999 and charges worsening at a further 0.10 above the last charged level. An unchanged issue, unresolved response, ordinary cable slack or uplift does not produce a deduction. Historical deductions remain after successful repair.

Timeout, numerical error and unresolved analysis leave the physical scope unknown. The scored preset retains the move and its original assessment. Later verification cannot charge a past turn. Final scoring awards zero attraction to unknown reaction contributions while retaining the corresponding physical values as unavailable.

Return signed six-component foundation reactions with validity. Final-only load-share percentage minus historical penalties is confirmed; uplift/self-weight parameters remain game policies. Neutral repair-support reactions earn no player attraction, and total gravity stays the denominator. Do not normalize unavailable components into a full 100% share. Retained geometry remains available for repair; permanent releases/removal require an explicitly enabled bounded failure policy.

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

1. The approved playtest issues and thresholds are recorded in §7 and the [criteria ledger](criteria-ledger.md). Further penalty categories require a separate rule change.
2. Retained structure and recorded game-owned automatic correction for instability and overload are now confirmed, with Timburr explanation; player additions may also repair issues. Removal or modification of placed player cards is not authorized. Historical penalties are now confirmed to remain after repair. Exact issue thresholds and the requested game-owned automatic correction of instability/overload and the permanent neutral support/local-intervention policy are tracked in [failure and repair](failure-repair-criteria.md).
3. Player foundations are confirmed setup-only; neutral repair anchors are an explicit system-only exception, permanent and unscored for players. Starting layout/column properties and repair-anchor geometry still need definition.
4. Card economy: opening hand, retention/cap/discard/exchange, deck sizes, load-to-element ratio, connection frequencies and exhaustion.
5. Loads: magnitudes, eligible targets, self-weight and removal. Persistent downward gravity only is confirmed for the base deck.
6. Placement: grid/diagonal and original-quarter-only attachment across all families, no physical clashes and assembly card economy are confirmed. Board/tolerances, fitting geometry and validated quarter analytical laws remain to define; see [placement](placement-criteria.md).
7. Match: fixed rounds and final load-share percentage minus accumulated penalties, highest adjusted score wins, are confirmed. Exact round count, load/uplift/zero policy and ties remain in [scoring](scoring-match-criteria.md).
8. Joint compatibility: first-attachment/setup-profile establishment, canonical frame conventions, numerical matching tolerances and legacy mixed-profile handling. Matching freedoms/axes with potentially different elastic stiffnesses, and fully fixed foundation defaults, are confirmed; the enforcement/migration details remain proposed.

Documentation review checked the named member families against `voxelInput.ts`/`voxelSections.ts` and the solver requirements; the local card lifecycle is implemented, with numerical verification pending.

Confirmed rules can guide contract design now. Unanswered policies must remain explicit; recommendations are not agreed or implemented behavior.

## Delegated first-release decisions — 2026-11-14

The owner delegated the remaining product decisions to Codex, prioritizing simplicity, quality and a complete functional game. These are selected release requirements, not implementation or test evidence. They supersede earlier proposals on the same subjects; other confirmed requirements and numerical acceptance gates remain in force.

Use two players and eight rounds (16 turns). No separate opening hand: the first turn starts with its normal draw. Draw exactly two cards from each deck once per turn. Unplayed cards remain in hand; no hand cap, voluntary discard, redraw, trading or exchange in this release. Retain the confirmed optional 1-element/1-load/2-connection limits and passing. Show cards grouped by type with stable ordering and scrollable overflow.

Use the finite deck manifest appended to the card criteria. It supplies every regular draw, so ordinary matches need no exhaustion rule. If corrupted/invalid configuration cannot supply a required draw, reject it before setup or offer explicit recovery; never invent cards, recycle deployed cards or leave a match stuck midway through drawing.

The default authoritative assessment runs after every completed turn, including a pass, before handoff. It may run in a worker while safe camera/inspection controls remain available. Experimental multi-turn checkpoint scheduling remains a separately labelled development option, not the normal release rule. Freeze the player transaction, assess its issues, record at most one historical deduction, attempt bounded authorized correction, then commit the recorded outcome atomically.

## Owner revision — 2026-11-15 Shared table checkpoints

The owner subsequently selected scheduled Shared table analysis with a default interval of **three completed player turns across the table**. A pass counts as one completed turn. This supersedes the every-turn assessment default above for new `grow-dusk-play-2` matches. Historical matches without that rules revision retain their original assessment, draw and repair behavior.

`game/turnCheckpoints.ts` records the interval (supported range 1–12), setting version/log, completed-turn count, last attempted checkpoint, last fully verified checkpoint, exact last analysed physical board/model identity and an unassessed pending-turn window. Interval changes are replayable `interval` events. They do not start analysis, erase pending turns or grant another action. A shortened interval is evaluated on the next accepted End. The final sixteenth turn always flushes one checkpoint, even when fewer than three turns have elapsed. The default checkpoint boundaries are 3, 6, 9, 12, 15 and 16.

Intermediate committed turns have explicit **pending** reports and zero provisional deduction. They do not claim a stable result or launch the authoritative assessment. Each pending record preserves its original player, turn number, before/after board, draft and physical ID counter. At a due checkpoint, replay those originating physical transactions oldest-first. Attribute a verified new/worsened issue to its originating actor and turn, with at most one historical deduction per origin. An accepted system node fitting is carried into every subsequent origin in that window. Original player connector printings stay in the board's original connection layer; rated system fittings remain separate `jointCorrections` with policy, turn/issue identity and permanent object ID.

Each origin is attributed at its first actual checkpoint attempt only. An unavailable first assessment remains explicitly unresolved and cannot acquire a retroactive penalty when older unknown forces later become computable. Issue memory retains the unknown episode and the accepted checkpoint receipt records unresolved origins. `lastAttemptTurn` advances independently of `lastVerifiedTurn`, so a failed/partial attempt does not trigger an uncontrolled solve every following turn or fabricate verification. Future verified new/worsened changes use the existing issue-comparison policy.

The fully verified marker requires a nonempty complete accepted-model finding set with every instability and applicable capacity finding verified and cleared. A stable equilibrium can still have overload or unknown strength, so its `lastAnalysis` display identity may advance while `lastVerifiedTurn` remains earlier. Quiet inactive findings are omitted from change receipts; the checkpoint therefore inspects the full accepted model rather than treating an empty changes array as proof of safety.

Commit the updated reports, system layer, checkpoint receipt, issue memory and cleared unassessed queue together. Pending windows and setting choices survive private save/reload. A repeated accepted checkpoint cannot draw, penalize, install a fitting or finalize twice. Save replay reconstructs the same checkpoint windows and rejects altered attribution evidence. The last analysed board is retained with its own physical identity. Displays must label it stale after subsequent committed edits and must not apply that response to the current unassessed structure. The moves-until-analysis label derives from completed player turns and the actual recorded interval, including the forced final boundary.

`game/turnCheckpoints.test.ts` verifies no analysis on the first two committed turns or their pending reload, originating-actor attribution at turn three, replayed interval changes, settings during staging, final-pass flushing, carried fitting layers, exact checkpoint retry behavior and no retroactive unknown-overload deduction. These are domain/real-WASM regression fixtures. Normal-Play visual countdown, interrupted worker transaction and complete browser-match acceptance are separate integration gates in the [criteria ledger](criteria-ledger.md).
