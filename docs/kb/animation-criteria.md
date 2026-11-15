---
title: "Animation and Sound Criteria"
last_validated: 2026-11-14
validated_against:
  - docs/kb/game-completion-criteria.md
  - docs/kb/avatar-criteria.md
  - prototypes/timburr-companion/README.md
  - "Project owner animation direction and follow-up decisions, 2026-11-14"
  - docs/kb/turn-criteria.md
  - docs/kb/solver-criteria.md
  - docs/kb/3d-viewer.md
  - docs/kb/joint-dof-criteria.md
  - docs/kb/unified-runtime.md
owner: project owner
status: needs-review
---

# Animation and Sound Criteria

## 1. Status and confirmed direction

This page records the owner's presentation requirements and proposes an implementation specification. It does not claim that the animation system, settings, sounds or acceptance gates are implemented. Existing viewer effects are described in [3D viewer](3d-viewer.md); current environments and interaction gaps are described in [unified runtime](unified-runtime.md).

The owner confirmed:

- Cover all game actions, including setup, card interactions, turns, construction, analysis, errors and victory.
- Take inspiration from Magic: The Gathering Arena and Hearthstone: glowing cards, dramatic trails and impactful reveals. Create original assets and an engineering-themed magical identity.
- Keep ordinary actions mostly fast and subtle. Use rare dramatic moments for verified structural failure, a major lead change and victory.
- Include coordinated sound effects.
- Use glow, pulse and ghosted deformation modes for structural feedback; actual bending or breaking must correspond to verified game outcomes. Glow/pulse should be configurable.
- Keep the presentation tasteful, engaging and readable.

The numerical budgets, setting defaults, effect recipes and implementation sequence below are proposals for review and playtesting. Animation never defines a game rule or supplies missing physics. [Turn criteria](turn-criteria.md) govern actions and penalties; [solver criteria](solver-criteria.md) govern physical validity. Later completion criteria now confirm fixed rounds and final adjusted-share scoring; exact thresholds and other parameters remain open. The standard game retains structures without automatic destruction.

## 2. Visual language and hierarchy

Treat cards as tangible magical objects and the shared structure as the central play surface. Use crisp silhouettes, short luminous trails, restrained particles, directional motion and precise connection snaps. Effects should explain the source, target and outcome of an action. Player accents must coexist with structural warning colours; pair colour with shape, labels or icons.

| Level | Use | Presentation budget |
| --- | --- | --- |
| Ambient | Available targets, active player, selectable cards | Quiet persistent outline or icon; optional slow glow/pulse. No constant particle showers. |
| Routine | Hover, select, draw, stage, attach, place, cancel, pass | Small movement and one short accent; rapid return to a readable resting state. |
| Informative | Analysis complete, reaction change, issue warning, ordinary score change | Localized emphasis and a concise labelled result. Avoid full-screen celebration. |
| Dramatic | Verified structural failure, major lead change, victory | One focal event with a stronger reveal and sound accent. Aggregate simultaneous events. |

Do not give every card play a dramatic treatment. Reserve broad bloom, long trails and camera emphasis for the dramatic tier. Keep text, connection endpoints, axes, loads and important controls visible. Avoid strobing, rapid full-screen flashes, persistent shaking and uncontrolled screen clutter. Hover motion must not move a target away from the pointer.

## 3. Action coverage

Every supported action needs intentional start, feedback and completion states; an immediate highlight or static cue is sufficient when movement would add friction. The catalogue below specifies desired behavior, not permission to introduce new actions or rules.

| Action / step | Required visual feedback | Sound / sequencing |
| --- | --- | --- |
| Open game / load assets | Brief board reveal; readable loading/error state; controls appear when ready. | Respect saved mute settings before audio starts; no autoplay dependency. |
| Match setup / player order | Introduce player identity and starting foundations/columns in a clear sequence. | Short setup accent; do not imply setup cards consume turn allowances. |
| Turn start / handoff | Clearly identify active player and remaining allowances. | Brief handoff cue; conceal private information before the next player's reveal. |
| Draw two cards from each deck | Distinct deck origins and four card arrivals; draw order remains legible without four blocking reveals. | Stagger short swishes; show the actual recorded cards once, including shortfall if configured. |
| Hover / keyboard focus / inspect | Lift or outline, readable detail view and stable focus target. | No repeated hover sound by default; focus works without motion. |
| Select card / choose target | Distinct selection state and valid-target cue; optional restrained targeting trail. | One selection cue; target preview does not consume the card. |
| Orient member / choose permitted connection axis | Reference-grid ghost and clear local axes/allowed orientations. | Short adjustment tick, rate limited; no invented connection freedom. |
| Stage element | Card-to-member transition and a precise placement snap; unattached ends remain visibly unattached. | Light placement accent. Preserve parent card/member identity. |
| Stage one end connection | Travel from card to the specific end interface; show its shared-joint target and compatibility with the joint’s common freedoms. | Distinct connection click; never imply that existing connections were upgraded or that unattached ends connected automatically. |
| Stage gravity load | Card-to-target motion, downward arrow and printed magnitude. | Weighted placement accent; no impact suggesting a dynamic load calculation. |
| Edit provisional placement / cancel draft | Ghost follows input; cancellation returns staged cards and removes provisional effects. | Short reverse/release cue. Cancelling does not undo the turn's draw. |
| End turn / pass | Immediate acknowledgement and clear progression to validation/analysis. | Quiet confirmation. A pass still follows required turn resolution. |
| Illegal or stale draft | Highlight the relevant card/target and explain how to fix it; preserve the draft. | Soft error cue once per rejection. No failure spectacle or score penalty. |
| Analysis pending | Persistent labelled progress/working state; allow safe view navigation. | No fake result, fabricated percentage or endless escalating sound. |
| Provisional preview result | Clearly labelled preview overlays and optional ghosted modes. | Subtle cue only; never trigger authoritative score, penalty or failure effects. |
| Verified analysis complete | Reveal valid component results, then explain changes. | Brief completion cue distinct from victory. |
| Load flow / foundation reactions | Directional load-path accents and signed reaction changes, scoped to valid results. | Soft coordinated pulse, not one sound per member. Routes are illustrative, not a physical simulation. |
| Instability / excessive deformation / overload | Distinct labels/icons, affected regions and available ghosted modes; distinguish the classifications. | Restrained warning. An instability warning alone is not a breaking event. |
| Unresolved / timeout / unavailable result | Neutral unknown-state treatment and actionable explanation. | Neutral notice; no collapse, success or physical-penalty sound. |
| Verified structural failure | Highlight the failed object and governing limit state; use the dramatic tier once per new event. | Short impact and controlled decay. Break/removal animation only if the game actually commits that failure transition. |
| Persistent / worsened / resolved issue | Persistent issues retain quiet markers; verified worsening gets one new emphasis; resolved issues clear visibly. | Do not replay old alarms on every analysis. Unknown is not resolved. |
| Score update / penalty | Show committed delta, reason and final value; keep positive load attraction distinct from deductions. | One grouped scoring cue. A verified eligible turn penalty is one -1 event, not one per object. |
| Major lead change | Identify new leader and confirmed score change without hiding the board. | Brief dramatic accent; threshold is a configurable policy still to define. |
| Victory / defeat / tie | Present the authoritative outcome and final scores with clear next actions. | Victory receives the strongest celebration; respectful defeat/tie variants. End conditions remain a game-policy decision. |
| Settings / pause / resume / exit | Immediate feedback and clean transition; preserve or discard state only under existing rules. | Restrained UI cues; changes to audio take effect immediately. |
| Save / restore / reconnect / replay | Show restored state and any pending operation; do not re-enact completed draws, awards or penalties as new events. | Quiet recovery cue. Replay controls may intentionally replay historical effects. |
| Undo / reset / removal in prototype modes | Reflect the permitted state transition and cancel obsolete overlays/effects. | Short reset cue. These effects do not authorize undo/removal in Shared table rules. |

For future actions, extend this catalogue before shipping them. Disabled controls explain why an action is unavailable; do not make a disabled action appear to succeed.

## 4. Timing, sequencing and input

Proposed normal-speed budgets, measured from action acknowledgement through the meaningful presentation, excluding actual solver/network waiting:

| Interaction | Target |
| --- | --- |
| Input acknowledgement | Visible within 100 ms. |
| Focus, selection, orientation and ordinary UI transitions | 80–180 ms. |
| Ordinary placement, connection, cancellation | 150–350 ms. |
| Complete four-card draw | 450–750 ms total using overlapping/staggered arrivals. |
| Ordinary result, score update or handoff | 200–500 ms each; overlap when meaning remains clear. |
| Ordinary turn resolution presentation | At most 1.2 s total, excluding real analysis wait and deliberate user inspection. |
| Failure or major lead-change emphasis | 600–1,000 ms; aggregate a cluster of failures. |
| Victory introduction | 1–2 s, then leave a readable result screen. |

Show cause before consequence: placement/connection, analysis pending, verified result, issue/score change, then handoff or match result. Do not delay starting analysis until a decorative animation finishes. Bundle repeated draws and result changes rather than serializing dozens of effects. A victory sequence supersedes a simultaneous lead-change celebration.

Use logical phase boundaries for blocking input. Prevent duplicate submissions and incompatible edits during commit/analysis, while allowing safe camera control, inspection and settings. Decorative animation must not lock the next legal action; if interrupted, complete or cancel to the correct logical state. Expose pending state even when all effects are disabled.

Provide a way to skip nonessential turn/result sequences and finish card arrivals immediately. Skipping changes presentation time only: it never changes draws, score, turn order or solver work. Keep final outcomes visible after skipping. Repeated clicks, long solver waits and rapid setting changes must not accumulate an unbounded queue.

## 5. Structural truth and privacy

- Animate immutable game/analysis events tied to turn ID, model version, object IDs and result validity. Ignore stale analysis and cancel effects for superseded drafts.
- Distinguish reference geometry, provisional placement, verified deformation and instability mode shapes. A mode shape is a normalized illustrative motion, not a predicted trajectory or displacement amplitude. Label exaggerated deformation and scale.
- Leave reference geometry intact for retained unstable structures. No cinematic collapse, permanent deformation, member deletion or connector release without the corresponding authorized game transition.
- Render load-flow paths as explanatory overlays. Do not invent reaction shares, normalize unavailable results to 100%, erase uplift or use ownership/graph distance as physics.
- Reveal only valid result scopes. Do not animate unavailable forces as zeros or present an unresolved component as safe.
- Private draws must not expose faces, card names, screen-reader labels or identifying sounds to opponents. Use neutral backs/counts in public views; handoff hides the outgoing hand first. Detailed hot-seat privacy mechanics remain to define.
- Gameplay state advances independently of animation completion callbacks. Reconnection, replay and skipped animations cannot repeat card consumption or scoring.

## 6. Sound design

Use a coherent original sound palette: soft card swishes, precise metallic/wooden connection clicks, low-energy load pulses, clear result chimes and rare resonant impact accents. Match sound to the action's visible contact/reveal, provisionally within 50 ms. Material variants are optional polish; they must not imply unimplemented material physics.

Provide master mute/volume and a separate effects volume. Persist preferences locally and apply them before the first cue. Music is optional future scope, with its own control if introduced. Do not require audio for targeting, warnings, turn identity or understanding results. Pair important cues with visible text/icons and accessible announcements.

Unlock browser audio through user interaction. Missing assets, suspended audio, mute and output-device changes must leave all gameplay usable. Cap simultaneous voices, merge repeated structural cues and rate-limit targeting/error sounds. Prevent clipping and abrupt loudness jumps; failure and defeat must not be punitive or startling. Fade or stop obsolete looping sounds on cancellation, navigation, pause or teardown. Background tabs must not build a queue that bursts on return.

## 7. Settings and accessibility

Proposed defaults are normal motion, glow/pulse enabled at restrained intensity, and sound enabled only after browser audio is unlocked. Honour system reduced-motion preference on first use; an explicit saved preference overrides it.

| Setting | Required behavior |
| --- | --- |
| Motion: normal / reduced | Reduced mode replaces travel, shaking, repeated pulsing and moving deformation modes with brief fades or immediate static states. Keep equivalent information and acknowledgement. |
| Structural glow/pulse: on / off | Independent switch for decorative structural glow and repeated pulse effects. Off retains static outlines, symbols, labels and selection/issue markers. |
| Master mute / volume; effects volume | Immediate, persistent controls, available before gameplay and from the active match. |
| Skip nonessential sequence | Finish to the correct visible state without repeating events or bypassing analysis. |

Do not rely on colour, sound, glow or movement alone. Support keyboard focus, target selection and inspection with stable focus throughout transitions. Announce meaningful turn/result/error changes accessibly; aggregate repeated announcements and never announce every particle or animation frame. Avoid flashes above three per second. Reduced mode disables camera shake and forced camera travel; normal mode also preserves the user's camera unless they explicitly request a focus action. Settings changes apply to active effects without requiring a reload.

## 8. Implementation and performance requirements

Keep presentation separate from game legality, solver physics and scoring. Use a centralized effect coordinator with cancellation, event priority, grouping and bounded lifetime. Reuse animation primitives for cards, trails, snaps, overlays and number transitions. Effects should carry stable object references so camera movement, resize and changing layouts do not detach them from targets.

Use a monotonic presentation clock; frame rate and animation speed must not affect deterministic game results. Pause or settle cosmetic activity when hidden and restore a clean current state on return. Dispose GPU resources, timers, listeners and audio voices when an effect or scene ends. Avoid writing game state every animation frame.

Proposed performance target: sustained 60 fps on documented supported hardware during routine play. Record p95 frame time, visible effect/voice counts and memory behavior for representative desktop and lower-power profiles. Establish specific hardware, resolution, browser and scene sizes before claiming a pass. Budget particles, transparent layers, bloom and audio voices; degrade decoration automatically under load while keeping selection, warnings and results readable. Benchmark alongside analysis work; animation must not silently reduce solver fidelity.

Document each implemented action's trigger, asset references/licences, visual/audio recipe, durations, interruption/skip behavior, accessibility fallback and test evidence. A shared catalogue should make missing states discoverable. Do not claim these requirements are complete because an existing particle effect looks similar.

## 9. Acceptance scenarios and rollout

These are future acceptance gates, not existing test results.

| Scenario | Pass condition |
| --- | --- |
| Full setup-to-victory walkthrough | Every supported action in the catalogue has appropriate normal, reduced and muted feedback; no missing completion/error state. |
| Four draws / cancel / retry / reconnect | Exactly the recorded cards arrive once; no extra draws, leaked private cards or duplicate cues for committed events. |
| Two independent end attachments | Effects identify the correct end and law; a new attachment never appears to modify an existing connector. |
| Incomplete preview / final repaired draft | Preview is visibly provisional; no penalty, final failure celebration or committed geometry change. |
| Stable, unstable, overloaded and unresolved results | Distinct labels and valid scopes; no fabricated forces, false safety or collapse. |
| Delayed and stale analysis | Clear pending state; stale results do not animate; safe navigation/settings remain usable. |
| Many failures / unchanged issue / multiple penalties | Aggregate new events; persistent issues stay quiet; one eligible -1 penalty per turn. |
| Signed reaction / unavailable component | Uplift and unknown scopes remain explicit; no invented complete load share. |
| Skip / rapid input / navigation / hidden tab | Correct final state, no duplicate actions, orphan effects, queued sound burst or delayed input lock. |
| Reduced motion / glow off / mute / keyboard | All essential information and actions remain available; no forced motion, repeated pulses or audio dependency. |
| Lead change / victory / tie | Only authoritative configured outcomes trigger presentation; victory supersedes redundant celebrations. |
| Stress and resource lifecycle | Meet measured budgets on named profiles; bounded queues and no growing resource use after repeated turns or scene changes. |

Implement in reviewable stages:

1. Inventory current actions/effects and document gaps; establish reusable motion/audio primitives, cancellation and settings first.
2. Cover setup, card draws, targeting, placement, per-end connections, loads, cancellation and validation errors.
3. Integrate versioned analysis/results, honest structural feedback, issue changes and configured scoring.
4. Add rare failure/lead-change/victory treatments only where authoritative events exist.
5. Validate accessibility, timing, privacy, interruption and performance; tune through recorded full-turn playtests.

Update this page, [3D viewer](3d-viewer.md) and [development and testing](development-and-testing.md) as each stage ships. Record implemented coverage and evidence separately from remaining requirements.

## 10. Open decisions

- Exact art palette, assets, music scope and final sound mix.
- Major lead-change threshold and cooldown; no animation-defined scoring or victory rules.
- Final timing/volume defaults after playtesting and supported-device performance profiles.
- Hot-seat privacy handoff, spectator/replay presentation and future network synchronization details.
- Any permanent failure/removal policy remains with the game and solver criteria. A verified overload alone does not authorize a breaking/removal transition.

## 11. Avatar-specific criteria

[Timburr avatar criteria](avatar-criteria.md) extend this presentation specification with the owner-confirmed recurring character and compact cross-screen placement, proposed reactions, rare Conkeldurr foreman mode, model provenance and acceptance scenarios. Read that page for avatar-specific decisions and the distinction between a cosmetic demonstration and a verified game-triggered reaction. Implementation is deferred and preserved in the [prototype handoff](../../prototypes/timburr-companion/README.md), not enabled in the app.

## 12. Joint DOF overlays

[Joint DOF criteria](joint-dof-criteria.md) define the still-by-default motion compass, brief schematic translation/twist demonstrations, separate foundation-restraint subject and independent solver-instability overlay. Demonstration is not a calculated displacement, structural edit or failure event. The newer shared-joint rule requires matching incoming freedoms; connection animations must not imply automatic upgrades or attachment by coincidence.

## 13. Final scoring, quarter attachments and repair events

Later [core game criteria](game-completion-criteria.md) confirm attraction scored only at match end, fixed rounds, accumulated penalties and retained structures repaired through additions. Animate provisional shares as estimates, not banked attraction points. [Placement](placement-criteria.md) requires explicit quarter ports and one-assembly-card plays with separately paid external attachments. [Repair](failure-repair-criteria.md) needs clearly resolved/improved/persistent/unknown feedback, without automatic collapse. [Hot-seat handoff](multiplayer-criteria.md) must conceal private content immediately before any incoming reveal, regardless of decorative animation duration.

## 14. Recorded system repair sequence

The game now requires recorded game-owned correction of instability and overload. Present pre-correction issue/once-per-turn historical penalty, explicit repair placement and verified post-correction outcome in causal order; Timburr explains the change. Skipping animation never skips repair validation, duplicates objects or refunds penalties. Keep system and player objects distinguishable. Unverified correction remains pending/unknown, never a success effect based only on a completed animation; see [repair workflow](failure-repair-criteria.md#6-automatic-correction-transaction).
