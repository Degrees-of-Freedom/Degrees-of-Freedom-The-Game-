---
title: "Multiplayer Simplification — Current Criteria"
last_validated: 2026-11-14
validated_against:
  - "Project owner multiplayer simplification and follow-up answers, 2026-11-14"
  - docs/kb/turn-criteria.md
  - docs/kb/solver-criteria.md
  - docs/kb/scoring-match-criteria.md
  - docs/kb/failure-repair-criteria.md
  - docs/kb/visualization-criteria.md
owner: project owner
status: needs-review
---

# Multiplayer Simplification — Current Criteria

## 1. Authority and scope

This is the latest owner-requested rules/presentation revision. It supersedes conflicting earlier requirements, including older “confirmed” rules, in the completion register and domain pages. **Criteria and handoff only:** no application behavior is changed by recording this specification. Actual current code, migration work and evidence must be inspected separately. Read this page first, then the domain criteria and [four implementation-session prompts](../implementation-prompts/README.md).

The only supported target game type is **multiplayer Shared table**, initially local hot-seat with private handoff. Remove Creative, Engineering challenges, Forensics and Load in space from product menus, routes, setup, help, quit/restart paths and active mode-dependent logic. Preserve existing saves non-destructively as legacy/read-only or explicit imports; do not wipe data or pretend retired modes remain supported. A theme/camera style is not another game type. Reuse the current Grow Dusk multiplayer presentation unless deliberately changed by these criteria.

## 2. Current confirmed decisions

| ID | Requirement |
| --- | --- |
| MR01 | Multiplayer only; no alternative game-type selector or reachable retired-mode flow. |
| MR02 | Default automatic analysis every **3 completed player turns across the table**, not 3 rounds, and always at match end. Interval is editable in Settings. |
| MR03 | Horizontal play field **15 × 15**. Working interpretation: 15 grid cells per horizontal axis, coordinates 0 through 15 inclusive; vertical extent is separate and must be published. |
| MR04 | Every turn draws **4 cards total**, choosing elements/loads or connections independently for each draw. Not 2 per deck, not 6 total. |
| MR05 | Players may play any number of elements, connections **and loads** they hold, including none. No old 1/1/2 category caps. Each actual card/attachment still consumes its own instance. |
| MR06 | Exactly four playable member variants: one standard beam-column resisting axial force and bending; one tension-only cable; two axial springs with stiffness 0.25k₀ and 0.5k₀. |
| MR07 | Only three drawable connection types: restrain 1, 2 or 3 rotational DOFs. Connected translations are compatible by the attachment definition, never player-configurable free/elastic translation cards or new ground supports. |
| MR08 | Member-card maximum lengths are **5, 7 or 10 game units**. These are maxima, not exact lengths; legal shorter/diagonal spans are allowed. |
| MR09 | Each player has exactly their one default foundation and starting column, fully fixed and immutable. No additional foundations can be played or automatically added. |
| MR10 | Auto-correction uses minimum local joint/connection restraints, not columns downward, props or new foundation meshes. Keep the move and applicable historical penalty; simplify rather than constrain ordinary play. |
| MR11 | System-only local translational safety restraint is permitted **only when required**; record its reaction separately with no player attraction award. This is not a player connection card. |
| MR12 | At a checkpoint, replay unsolved turns to assign one -1 to each responsible turn/player with verified new/worsened eligible issues; do not blame the checkpoint player for all earlier actions. |
| MR13 | Inspecting an element opens a property panel. Draft properties can be edited within printed choices; committed physical properties are read-only. Setup column/foundation always locked. |
| MR14 | Timburr actively moves around the screen and is flashy, entertaining and emotive, rather than remaining a small fixed corner portrait. Accessibility and unobstructed controls still apply. |
| MR15 | Springs appear as **two simple coils, one extending from each endpoint**. The two coils depict one spring element/law, not two extra analytical springs. |
| MR16 | Selection/snap points near the pointer are bold; farther points fade. Preserve precise hit identity, ambiguous-target cycling, keyboard/touch access and legal reach. |
| MR17 | Quit is available at any time, including drawing, placement, animation, analysis and correction. Preserve resumable state; quitting does not secretly end a turn or forfeit. |
| MR18 | Turn/event transitions are explicit and apply the animation/sound criteria. Skipping or replaying visuals cannot mutate cards, turns, results or penalties. |
| MR19 | In the load-path view, calculated axial **tension** animates vectors from the member centre toward its end nodes; **compression** animates from both ends toward the centre. No flow for zero/slack/unavailable axial results. |

Retained unless explicitly superseded: fixed-round match, final-only load-share percentage minus historical penalty points, shared access, no physical clashes, original-reference quarter attachments on every **current playable** family, immutable committed player objects, matched connection freedom axes at one shared joint, no repeat/unknown penalties, private hot-seat hands and honest component/result validity. Assembly cards, HSS/wide-flange section decks, elastic connection cards, standalone brace cards and alternate member/material choices leave the current playable catalogue. General solver/library support for broader physics may remain internal, not a product card family.

## 3. Analysis cadence, settings and result freshness

Count successfully committed **player turns** globally; a pass counts, cancelled drafts/readiness/retries do not. With interval 3, checkpoint after turns 3, 6, 9, etc. A final turn already due a checkpoint uses one checkpoint/finalization result, not two. An early match end/quit is different: completed match ending requires final analysis; Quit merely suspends and does not force a solve.

No automatic solve on pointer motion, inspection, individual placements, card draws, ordinary noncheckpoint turn completion or view changes. Geometry/legality checks remain available and are not numerical structural solves. The multiplayer UI should not offer an ordinary manual Run simulation path that bypasses the cadence. Development diagnostic runs must be explicitly non-authoritative and outside normal play.

Settings must expose a validated positive integer `solveEveryTurns`, default 3, with a published supported range; persist it with the match and log mid-match changes publicly. Proposed rule: changing the interval affects the next committed-turn scheduling check, never launches a solve from the Settings dialog. Count from the last scheduled checkpoint attempt; keep last attempted and last verified checkpoints separately. If a reduced interval is already exceeded, solve on the next committed turn. Failed bounded work does not create an infinite every-frame/every-turn retry loop. Record the exact due window/setting version.

Between checkpoints, label previous results **last analyzed at turn N — current structure not yet analyzed**. Keep historical overlays against their historical reference or clearly stale, never current/verified. Unsolved does not mean stable, failed or zero reaction. Preserve pending turn IDs for checkpoint attribution. No provisional new authoritative score or failure verdict is invented between scheduled analyses. Initial setup should use a reviewed stable fixture/baseline; any setup analysis exception must be explicit rather than an unnoticed extra solve.

## 4. Delayed issue attribution and correction

At a due checkpoint, freeze the current revision and ordered pending window. Replay its recorded turns from the compatible previous baseline using the same rules, inputs and preexisting system corrections. These replay solves occur **inside the checkpoint**, not after every live turn. Use a deterministic sequence of issue comparison and local correction so later replay steps have an explicit baseline; retain the original live moves/cards and record checkpoint-derived correction/evidence events separately. Do not retroactively manufacture player draws or edits.

For each responsible original turn, record its verified new/worsened eligible issue and at most one -1, with actor, originating turn, evidence/model IDs and checkpoint ID. Several players/turns can each receive one deduction in a single checkpoint. Unchanged issues do not repeat; unknown baseline/failed replay cannot prove blame. Supersedes the older proposed disabling of deferred penalties. Preserve the entire window and any partial verification on interruption/reload; do not charge the active checkpoint player simply because they pressed End turn.

The exact replay event/model lineage must be designed and tested: the retrospectively corrected replay branch is not silently the historical live model, and final current topology/quarter targets/player moves must remain equivalent. If an intermediate correction conflicts with a later recorded placement, do not drop or relocate that player move. Seek a compatible local correction or mark that scope unresolved. Bound per-window work and return truthful partial results if required.

The correction candidate set is deliberately small: add the fewest necessary **local rotational constraint components**, then minimal **system-only local translational safety components** when required. Use diagnosed modes/actions to target the affected element/joint. Do not lock all six DOFs everywhere, add a vertical member to the ground, add a foundation, delete loads, change reference geometry or fabricate a successful residual. Validate stability **and** member/connection capacity, equilibrium and full affected-component behavior after each bounded candidate. A local restraint can redistribute forces globally; local edit scope does not mean globally zero physical effect.

Store the original player connection mask and any system override as separate layers. Effective corrective restraints must be inspectable, with reason, origin turn, checkpoint, constrained axes, reference frame, validity, reaction and permanence. Existing system corrections remain for the match unless a later owner rule changes lifetime; this retains the previously confirmed persistence while replacing physical scaffolding with local constraint records. No new card/foundation is created. Correction reactions are neutral/unscored, included in corrected-model equilibrium and excluded from player attraction numerators; W remains total applied gravity. Clearly call them **game safety-restraint reactions**, not physical columns or original-player foundation reactions.

Do not quietly add automatic section-strength upgrades if these constraint actions cannot resolve an overload. A broader correction action needs an explicit rule and validated model. Minimum means a documented deterministic ordering/objective over a bounded local candidate set, not an assertion of a globally optimal edit. If no permitted verified correction exists, retain the move and explicit unknown/unresolved scope and use the confirmed verified-component scoring fallback. “Fun and flexible” means fewer restrictions/needless edits, not hidden forces or false physics.

## 5. Current cards, connections and geometry

The standard solid member is one beam-column formulation with axial and bending response and explicitly documented supported shear/torsional behavior, one authored section/material and capacities. Column versus beam follows role/orientation, not separate player families. Cable is tension-only with explicit rest state; never silently two-way. Springs have k = 0.25k₀ or 0.5k₀, where a versioned **reference axial stiffness k₀ in N/m** is published in the catalogue. k₀ is not implicitly EA/L and the same-ruleset spring ratio is exactly 2. Actual k₀/material/section/capacity numbers require review; do not invent units or change stiffness with display coil size or shorter placement unless the authored law says so.

Each member card carries `maxLength` in {5, 7, 10} **game lattice units**, with one explicit game-to-SI conversion. Use Euclidean reference span for diagonals, allow any positive permitted shorter span, retain quarter-port exceptions to grid targets, and do not interpret max length as a per-axis reach cube or exact stick length. Changing current two-metre grid spacing, if desired, is a separate explicit unit decision. A 10-unit maximum permits 6 units, but not a diagonal whose actual length exceeds 10 although every coordinate delta is below 10.

Connection masks contain exactly one, two or three restrained components of `(RX, RY, RZ)` in a stored documented joint frame; the other rotational components are released. Player chooses permitted axes/orientation, not translation laws or ground restraints. There is no fourth ball/zero-restraint card type, no elastic connection deck, and no translation slider/coupler card. Preserve intentional attachment and relative translation compatibility; “rotation-only” does not mean attached ends can independently separate in space. Cable and axial spring rotational components do not acquire invented moment stiffness from a connector mask; show inactive quantities truthfully.

All intentionally attached ends at one shared joint continue to have compatible rotational freedom axes. Setup column and its foundation/attachment fixities are locked; incoming cards cannot relax them. At a locked setup joint only a compatible mask is legal. How cards establish a previously empty joint remains explicitly authored; do not introduce a silent upgrade mechanic. Display **one node-local connector/DOF glyph**, no bulky per-member-end connector meshes; selected details distinguish each attachment/card and any safety override from the common node appearance.

Two simple endpoint-originating spring coils share one axial line and one parent identity. Keep the span/end interfaces readable, avoid a decorative gap implying disconnection, and do not double the modeled stiffness by treating visual halves as parallel/series springs. Quarter-point targets remain analytical/interface data, not arbitrary helix vertices. Normal readability enlargement/true-scale inspection still apply, with schematic coil dimensions labelled when appropriate.

## 6. Inspector, point selection and quit

Inspecting an element selects it and opens an anchored or docked property panel with family/card ID, owner, actual/max length, units, endpoints/quarter targets, connection rotation masks, spring factor/k₀/effective k where relevant, cable active/slack state where verified, setup-lock status, last checkpoint/model version and available physical results. Distinguish original versus system-corrected properties/constraints. No hovering is required to keep it open.

Draft edits are bounded by the card and legality rules. Committed physical properties are read-only, including another player's objects. Starting foundation/column are always locked. Display preferences may be changed without physical edits. The panel never silently solves, consumes another card, commits the draft, changes setup fixity or presents old results as current. Responsive layout, keyboard focus, Close and target disambiguation are required.

Reinstate pointer-distance salience for **all legal snap targets**, not only principal spokes: nearby targets are bold/opaque with the current target strongest, and distant targets fade smoothly. The chosen/armed point stays identifiable, including in depth. Fade is visual only, not a hidden legality change; keyboard/touch target choice and overlap cycling remain usable. Use hysteresis/stable hit regions so fading does not make a target flee the pointer. Scale the reachable-target strategy to the 15×15 field and length 10 without allocating thousands of new meshes per pointer frame.

Quit to menu is reachable at all times from a persistent Menu/Quit affordance and accessible shortcut/escape hierarchy. Modal privacy/animation/analysis/repair states must not trap the user. Suspend/cancel presentation and pending workers safely, retain recoverable authoritative match/draw/draft/checkpoint state, invalidate stale callbacks and present a privacy cover on resume. Quit is not End turn, Reset, Concede or Finalize. On storage failure show honest unsaved status/export options without preventing departure or claiming an unsaved checkpoint is safe.

## 7. Avatar, turn events and axial load-path motion

Timburr roams safe screen-space regions, looks/points toward the current public action, celebrates draws/builds, reacts expressively to checkpoint findings and visibly explains local safety restraints. Use paths/poses, anticipation, squash/lean/gestures and rare Conkeldurr transformations; a fixed portrait with only text or a perpetual small bob is not sufficient. Do not cover snap targets, hands, inspector, quit controls or public result text. Use bounded action priorities and interruption; do not chase the pointer or leak private card identities. Reduced motion offers still poses/short fades, with mute/glow/hide controls retained.

Define versioned presentation events for turn begin, each deck choice/card arrival, stage/edit/cancel/play, noncheckpoint commit, handoff cover/readiness, checkpoint queued/started/completed, attributed issue/penalty, local correction and verification, settings change, quit/resume and finalization. Show cause then effect. An unsolved turn says **turn committed — next analysis in N turns**, not “stable.” Checkpoint replay may attribute outcomes to earlier players; its UI names original turn and current checkpoint distinctly. Apply the [animation criteria](animation-criteria.md) to each event, including sound, skip, deduplication and reduced motion.

**Confirmed axial-motion rule:** for verified nonzero tension, animate vector markers from the member midpoint outward toward both endpoint nodes. For verified compression, animate from both ends inward toward the midpoint. Preserve axis/curve alignment, use opposed tracks on the two halves and keep markers within the segment rather than jumping across joints or gaps. Labels/legend say **axial tension — toward nodes** and **axial compression — toward centre**. These are explanatory stress/action indicators, not actual moving mass, displacement vectors or a unique load-attribution route.

Use the signed calculated axial force and documented sign conversion, not ownership, displacement colour, member slope or guessed gravity direction. For a subdivided/quarter-loaded element with varying sign, use valid segment results and local centres; do not force one misleading sign on the whole parent. If only a whole-member value is valid, disclose that scope. Slack cable, near-zero force within declared tolerance or unavailable results have no moving axial vectors; a claimed cable compression state is a diagnostic, not a normal cable animation. Bending-only behavior is not automatically compression. Keep line-width/force magnitude overlay separate from physical section size and deflection contour.

Reduced motion displays static directional arrows and text. Between checkpoints show historical flow only on its labelled historical geometry or suppress it; do not animate stale forces as the current result. No avatar/path/particle animation triggers analysis or changes scoring.

## 8. Acceptance and open parameters

| Scenario | Required evidence |
| --- | --- |
| Mode/menu/route sweep | Only multiplayer playable; retired saves preserved without executable alternate-mode paths. |
| 4 deck-selectable draws / many plays / pass | Exact four total, source choice per draw, any held cards playable, no old category caps or duplicate consumption. |
| Turns 1/2/3/4/6 / final turn / setting changes | No live noncheckpoint solves, correct global count, one final/due checkpoint, persisted setting/window and truthful stale state. |
| Batched attribution / repeated issue / interrupted replay | At most one -1 per responsible original turn, no blanket checkpoint-player blame, no duplicated effects or unverifiable blame. |
| 15×15 cells / diagonals / max 5,7,10 / shorter spans | Published bounds/units and Euclidean maxima; field/target/camera/clearance behavior remains usable. |
| Four member variants / three connector types | No retired cards; correct axial+bending, tension-only, 0.25k₀/0.5k₀ and rotation-mask behavior; translations not an editable card law. |
| Setup / correction / second checkpoint | Exactly one fixed foundation/column per player; no new base/downward prop; minimum recorded local constraints and neutral reaction accounting. |
| Inspect/edit / bold-near fade-far targets | Editable drafts only, locked committed/setup state, pointer/touch/keyboard target parity, no hidden solver calls. |
| Quit at every phase / reload | Prompt exit, preserved identities/window, no false commit or stale callback, private resume cover. |
| Avatar + animated event walkthrough | Active expressive roaming, unobstructed controls, all normal/reduced/muted/skip states and no game mutation from visuals. |
| Tensile/compressive/slack/zero/unknown/segment-sign cases | Exact outward/inward axial vector rule from valid force data, static accessibility alternative and honest result freshness. |

Open numerical/presentation parameters are not silently finalized: actual k₀ and standard member properties; board vertical extent; interval supported bounds; geometric/capacity tolerances; exact local constraint candidate ordering/budgets; card counts/load magnitudes/deck exhaustion; tie/uplift/self-weight/zero-load policies; animation/roaming paths and hardware targets. Inspector permissions, cadence basis, spring reference, source-deck draw choice, unlimited load plays and checkpoint responsibility have been explicitly answered and are not open.
