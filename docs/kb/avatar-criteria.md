---
title: "Timburr Avatar Criteria"
last_validated: 2026-11-15
validated_against:
  - docs/kb/game-completion-criteria.md
  - "Project owner avatar request, prominence choice and criteria-first correction, 2026-11-14"
  - docs/kb/animation-criteria.md
  - apps/web/src/companion/Companion.tsx
  - apps/web/src/companion/reactions.ts
  - apps/web/src/game/publicRepairReport.ts
  - scripts/release-presentation.mjs
  - docs/kb/turn-criteria.md
  - docs/kb/solver-criteria.md
  - prototypes/timburr-companion/README.md
  - apps/web/src/companion/motion.ts
  - apps/web/src/companion/animator.ts
  - apps/web/src/companion/turnCues.ts
  - docs/evidence/companion-motion/check.mjs
owner: project owner
status: needs-review
---

# Timburr Avatar Criteria

## 1. Authority and scope

The specifications below originated in the criteria-first pass. The active playtest now uses the two owner-approved provisional assets from the [prototype handoff](../../prototypes/timburr-companion/README.md). Its compact companion, labelled preview and model-derived fallback are implemented in `apps/web/src/companion/`. Separate issue, reaction and accessibility gates are tracked in the [criteria ledger](criteria-ledger.md).

Owner-confirmed direction:

- Timburr is the game's recurring avatar, appearing across screens and interacting with gameplay.
- Use a 3D model; the owner states permission for character use.
- Be creative with his reactions. A proposed signature interaction is getting mad and transforming into final evolution Conkeldurr after something very wrong.
- The owner chose a **small companion across all screens, expanding for important reactions** rather than a persistent character inside the board.
- Produce criteria now; package any implementation work and assets for a future Codex/Claude run and document it in the knowledge base.

The name used in the interface is **Timburr**; the final evolution is **Conkeldurr**. The direct temporary transformation below is a cosmetic game gag, not a statement about the canonical evolution sequence or a new gameplay mechanic. Numeric thresholds, reaction recipes and settings defaults below are recommendations pending playtesting or further owner decisions.

Follow [animation and sound criteria](animation-criteria.md) for the magical arena direction, tasteful effects, mostly fast/subtle routine actions and rare spectacle. Follow [turn criteria](turn-criteria.md) and [solver criteria](solver-criteria.md) for legal actions, physical outcomes, scoring and validity. The avatar does not change those rules.

## 2. Character and art direction

Timburr is an enthusiastic little site buddy: capable, curious, a little cheeky and always on the player's side. His timber is a natural prop for measuring, balancing, pointing and celebrating construction. Let body language carry most of the personality; text adds a short useful observation or joke.

Use expressive, readable poses and warm light that fit both the paper-like daylight environments and the dusk arena. Preserve recognizable character proportions, face and props. Avoid excessive bloom, noisy outlines, constant jumping and jokes that obscure a real error. Conkeldurr is the same helpful friend with comically exaggerated foreman energy, not an adversary who punishes the player.

Proposed everyday behaviors: breathe, shift weight, glance toward the current build, adjust the timber, nod after a connection, lean in when inspecting, and briefly perk up when addressed. Limit idle activity and vary it slowly. Do not follow every pointer movement or create repetitive voice/text interruptions.

## 3. Presence and screen layout

| Context | Required presentation |
| --- | --- |
| Launcher / setup | Small welcoming companion, optional greeting and a clearly discoverable way to interact. Never block choosing an environment or setting up a match. |
| Building workspace | Compact companion at the edge of the screen. Keep cards, endpoints, action controls, score, turn banner and analysis results unobscured. |
| Inspection / analysis | Supportive glance or pose and concise feedback; the official result panel remains the source for detailed evidence. |
| Important reaction | Briefly expand the character and optional speech bubble without moving the board, stealing focus or blocking the next legal action. |
| Dialogs / drawers / narrow screens | Yield space to essential controls; reposition, compact or suppress decoration when necessary. Retain a reachable companion control. |
| About / error / not-found screens | Quiet presence with context-appropriate help; no building/score claim on a non-game page. |

Persistent character identity across route changes should not restart introductions, repeat committed results or leak an outgoing player's private hand. Position and scale must be validated at supported desktop/mobile sizes and zoom levels. Do not implement a permanent in-board character in the first scope; occasional board cameos are future proposals.

Clicking/tapping or keyboard-activating Timburr should produce a short friendly response, tip or small character action. Repeated activation must be rate-limited. Provide an obvious dismiss action for speech. Hiding the avatar must leave a small discoverable restore control; it must not remove essential game instructions.

## 4. Reaction catalogue

These are proposed recipes. Every supported action needs intentional feedback, but the avatar does not need to talk or move substantially on every action. The board and cards should carry routine action feedback; Timburr adds personality selectively.

| Event | Proposed character behavior | Meaning / guardrail |
| --- | --- | --- |
| First welcome / new job site | Small wave, timber shoulder lift | One brief greeting; do not repeat on every render or reopen. |
| Turn start / card draws | Perk up, glance toward the trays, pleased nod | React to public phase/count only, never identify private cards through text, pose or sound. |
| Select / inspect a card or joint | Thoughtful lean, point with timber | Use public, currently inspected information only. No tutorial pop-up every time. |
| Stage a member | Tiny balancing or measuring pose | Placement is provisional; no claim of structural safety. |
| Attach one member end | Satisfying nod or timber tap | Reference the specific end, not an automatic whole-joint upgrade. |
| Place a load | Brace playfully, look toward its target | Explain the load path; do not imply an impact/dynamic simulation. |
| Cancel / undo where allowed | Small step back, reset pose | No scolding, penalty or extra card consumption. |
| Invalid target / illegal action | Gentle head tilt with a useful suggestion | Respectful guidance. A UI mistake is not a physical failure or transformation trigger. |
| Analysis pending | Thinking pose, look toward structure | Never anticipate a verdict; no fake progress. |
| Experimental warning / incomplete preview | Concerned glance and explicitly provisional wording | No angry evolution, false collapse, penalty or verified-failure claim. |
| Unresolved / service error / timeout | Puzzled but calm, point to the result explanation | Unknown is not stable or collapsed; do not blame the player. |
| Verified new instability / overload | Concern, highlight or point toward the affected region | Distinguish classifications. Eligibility for Conkeldurr depends on section 5, not the avatar's guess. |
| Persistent unchanged issue | Quiet concerned resting pose or no new reaction | No repeated alarm or transformation every turn. |
| Verified repair / improvement | Relief, proud nod or short timber dance | Celebrate only the supported conclusion; a local improvement is not victory. |
| Score / penalty / lead change | Track a committed score delta; rare stronger response to a configured major lead change | Never manufacture or multiply scoring events; no celebration of an opponent's misfortune. |
| Completed playtest | Friendly wrap-up | A playtest ending without a winner is not a victory declaration. |
| Authoritative victory / defeat / tie | Strongest celebratory pose / encouraging nod / mutual acknowledgement | Respect the actual configured outcome and keep final scores readable. |
| Avatar interaction | Tip, wave, timber flourish or optional demonstration | Demonstration is labelled cosmetic and is separate from gameplay outcomes. |

Example voice: “Touching isn’t connecting. Let’s give that end a proper joint.” / “We don’t have a result yet. Let’s inspect the message.” / “Now that’s a load path!” Avoid “You broke it,” insults, taunting, threats, false safety assurances and repetitive nagging.

## 5. Conkeldurr: rare foreman mode

The signature concept is a brief transformation into Conkeldurr: a warm energy outline, silhouette/scale change, a firm foreman pose with his concrete pillars, one short sound accent and a useful repair suggestion. Settle back to Timburr automatically. Do not smash the structure, invent damage, change cards or delay resolution.

**Proposed automatic eligibility:** a new authoritative event identifies a verified new or worsened serious structural issue on a committed turn. A versioned game/result policy must define the eligible issue categories, severity threshold and reliable before/after comparison. A future penalty event may be a useful source only when it carries that verified evidence; a score deduction alone is not proof of a serious physical issue.

Never infer “very wrong” from an exception, rejected placement, timeout, disconnected service, unknown previous result, failed preview, an approximate solver warning or a repeated existing mechanism. Do not infer player fault from a single unstable result. The current experimental turn status alone is insufficient for automatic foreman mode under these criteria.

Until compatible verified events exist, provide only a clearly labelled optional **transformation preview**, if implementing the gag at all. That lets the owner review personality and visual treatment without implying completed failure detection. The archived prototype's experimental stable-to-unstable trigger is specifically **not approved** and must be replaced or disabled.

Proposed pacing: an emphasis of 600–1,000 ms, with the transformed pose optionally lingering quietly for up to 4 seconds; a cooldown of at least 45 seconds; at most one transformation per qualifying turn/event. Skip/dismiss settles immediately without changing game state. Aggregate multiple simultaneous issues. Victory supersedes a redundant foreman reaction. Returning to a saved match must not reenact an old event as new.

Use amused exasperation followed by encouragement: “Foreman mode. Let’s give that frame the support it deserves.” Do not require a permanent evolution, Gurdurr intermediate form, progression tree or punishment system. Those would need separate approval.

## 6. Sound, settings and accessibility

Use coordinated original sound accents under the [animation sound requirements](animation-criteria.md#6-sound-design). Proposed sounds: soft timber taps, a light greeting chirp, a restrained thinking accent, cheerful repair notes and a deeper foreman accent. Spoken dialogue and recognizable Pokémon cries are optional future asset scope; do not imply they have been sourced or licensed.

Required controls for an eventual implementation:

- Show/hide companion with an accessible restore control.
- Motion preference honoring system reduced motion, with an explicit user override.
- Optional decorative glow/pulse, independent of essential static markers.
- Companion audio mute/volume, coordinated with the application's master mute. No surprise audio on load; browser unlock must follow user input.
- Dismiss/skip nonessential reactions, including transformations.

Reduced motion uses still poses or brief fades instead of jumps, spins, shaking, pulsing or transformation flashes. Information remains available through concise text and normal game feedback. No forced camera movement, strobing or reliance on colour, sound or character movement alone. Keyboard focus stays on the player's task; the character has a meaningful accessible name and visible focus when directly activated. Announce only important changes politely, never every idle or frame. Persist preferences safely; unavailable storage/audio/WebGL must not break the game.

## 7. Models, provenance and animation assets

Two candidate models have been located and preserved inside the unapplied prototype patch:

| Character | Candidate source | Embedded model attribution | Observed properties |
| --- | --- | --- | --- |
| Timburr | [Sketchfab model](https://sketchfab.com/3d-models/timburr-656b3a3464724f49905b23738de8e5d2) | [nguyenlouis32](https://sketchfab.com/nguyenlouis32), CC BY 4.0 | Optimized GLB, 22,088 bytes, WebP textures, Draco geometry, no embedded animation clips. |
| Conkeldurr | [Sketchfab model](https://sketchfab.com/3d-models/conkeldurr-e3fa0c6e58e34eb5aed4fbcf7047f80f) | Same author and licence | Optimized GLB, 26,100 bytes, WebP textures, Draco geometry, no embedded animation clips. |

The downloaded copies came from [Pokémon 3D API assets](https://github.com/Pokemon-3D-api/assets) at revision `429de1288cea0d43f5b4f56305d2276e94239d65`, under `models/opt/regular/532.glb` and `534.glb`. Embedded attribution metadata, source URLs, file hashes and decoder credits are preserved in the package. The owner states permission for character use; model-source attribution and character rights are distinct records.

These are candidates, not visually approved final assets. Inspect appearance, front direction, textures, scale, silhouette and possible rigging before choosing an animation approach. No embedded clips does not establish whether a useful skeleton exists. Whole-model hops/tilts are a prototype technique; articulated expressions, gripping props and expressive foreman poses require appropriate rig/mesh controls or authored poses. Do not claim those are supplied by these GLBs.

Serve approved assets locally with retained attribution. Keep a manifest of source revision, author, licence, modifications and hashes. Validate model content and decoder loading. Provide an approved static portrait/text fallback when 3D fails and a retry path; never substitute the wrong character after a failed evolution load. Portraits must be generated from or otherwise correspond to the approved character assets. No successful fallback portraits have been packaged yet.

## 8. Architecture and performance criteria

Implement the companion as a presentation layer over immutable public game events and scoped analysis results. It may suggest inspecting something; it must not modify topology, cards, physics, penalties or scores. Use stable event, turn and model IDs to deduplicate reactions across replay, reconnect, navigation and repeated results. Never read private hand contents merely to choose a public reaction.

Keep a bounded current reaction with priorities, interruption and cooldowns rather than an unlimited animation queue. A serious result must not be overwritten immediately by routine placement chatter. Cancel stale preview effects. Match-end, hidden-tab and scene teardown behavior must dispose timers, GPU objects, decoders and audio voices correctly. Hide/pause the character without affecting committed state.

Load the character assets/rendering code lazily and share infrastructure where practical. Budget idle animation, pixel ratio, transparent layers and sound voices on documented supported hardware. Measure alongside the main 3D board; a second WebGL context is a candidate approach, not an architectural requirement. Reduce decoration or use a portrait under load. Never trade numerical correctness or responsive input for avatar polish. Use the [animation performance criteria](animation-criteria.md#8-implementation-and-performance-requirements) as the broader target; no avatar frame-rate claim has been established.

## 9. Acceptance and implementation milestones

These are future gates, not current implementation evidence.

| Scenario | Required evidence |
| --- | --- |
| All routes / styles / viewport sizes | Companion remains recognizable, compact and reachable without blocking controls or result text. Drawers/dialogs take precedence. |
| Public draw / local player handoff | No private card identity leaks through text, animation, accessible names or sound. |
| Staging / cancellation / inspection | Appropriate routine reaction; no changes to game state or committed scores. |
| Invalid input / preview instability / unresolved result | Helpful guidance; no automatic angry evolution or implied verified failure. |
| Qualified serious committed event | Exactly one temporary transformation, correct event scope and cooldown, no invented damage or deduction. |
| Repeated / stale / restored result | No duplicate dramatic reaction; existing issues stay quiet; unknown is never treated as resolved. |
| Repair / complete playtest / actual match outcome | Correctly scoped celebration; no invented winner or safety assertion. |
| Click, keyboard, mute, reduced motion, glow off, hide/restore | Equivalent usable controls and information; preferences survive reload when storage works. |
| Model/texture/decoder failure / WebGL loss | Correct character fallback, actionable retry, no app crash or wrong-character swap. |
| Audio failure / hidden tab / teardown | No blocked input, delayed audio burst, runaway queue or leaked resources. |
| Rig, poses and timing review | Owner can inspect a labelled reaction preview with original models and proposed sound. Record approved versus provisional assets. |

Recommended order for a later implementation run:

1. Read this page and the prototype handoff; inspect the then-current main and record gaps. Confirm the serious-event source and asset suitability before integrating anything.
2. Approve candidate models/poses; implement compact presence, fallback, settings, accessibility and lifecycle handling.
3. Integrate routine public events and truthful provisional/unknown result feedback.
4. Add a labelled Conkeldurr preview; enable automatic evolution only after verified event eligibility is implemented and tested.
5. Validate layout, sound, interruption, privacy, performance and event correctness; update KB status with evidence.

## 10. Open decisions

### Compact character evidence

The launcher, setup, information pages, workspace and open drawers display Timburr. Activating his control opens a tip and lets the player inspect the Conkeldurr foreman preview. The private handoff and session recovery screens suppress the companion. The local loader draws the displayed GLB once and uses a matching PNG portrait during decoding or GPU failure; retry is available in the companion panel. Both source assets are unrigged static meshes with zero embedded clips. Their resting arms and detached props reflect the preserved authored poses. Articulated reaction poses and final art approval remain open.

### Scenario motion (implemented 2026-11-15)

Timburr now plays short procedural clips chosen by public scenario. The models remain unrigged, so every clip animates the whole figure about its feet (hop, squash/stretch, lean, sideways tilt, yaw) plus the existing upper-body flex morph, which also moves the carried timber. The same sampled pose drives the portrait fallback through a CSS transform, so motion survives WebGL failure.

| Scenario (source) | Clip | Priority |
| --- | --- | --- |
| First welcome on launcher/menus, once per page load (`Companion`) | wave | routine |
| Direct activation (`Companion`) | wave | routine |
| First sight of a turn, or a new seat after handoff (`turnCues.ts`) | perk | routine |
| Select element / connection / gravity card (`ReleaseBoard`) | measure / point / brace | routine |
| Stage a member / attach an end / stage a load | measure / nod / brace | routine |
| Cancel targeting, deselect or cancel draft | stepBack | routine |
| Rejected target from the precise form or board picking | puzzled | routine |
| Newly committed report with a deduction (this page session only) | concern | reaction |
| Newly committed verified-stable report without deduction | cheer | reaction |
| Partial, unresolved or persistent issue without a new deduction | perk only | routine |
| Repair announcement: verified with nothing pending / otherwise | dance / concern | reaction |
| Third eligible deduction for the same player | foreman, shared by Timburr and Conkeldurr | dramatic |
| Final results | victory | dramatic |
| Idle: release board | breathe, shift | idle |
| Idle: launcher, menus and other workspaces | breathe, shift, glance, adjust, stretch, tapFoot, peek | idle |

Behavior guarantees, each covered by unit tests in `apps/web/src/companion/`:

- **Bounded and interruptible.** One clip plays at a time (0.5–2.4 s). A cue may replace a clip of equal or lower priority, so routine chatter never overwrites a result reaction or Conkeldurr. Every clip starts and ends exactly at rest; hop, tilt and squash stay inside the badge's headroom.
- **Sparse idle.** Nothing renders while resting. One fidget plays after a random 6–12 s pause and never repeats the previous one. This replaces the earlier "zero idle draw calls" behavior when motion is enabled; under reduced motion it still holds.
- **Still mode.** Reduced motion, *Skip effects* and hidden tabs settle the figure at rest and refuse clips; a figure swap only fades briefly.
- **Public result cues.** Routine cues carry the public card family. A verified stable result can earn a cheer. A reload can introduce the current seat with a perk. The three-deduction policy below governs the foreman entrance.

Modules: `motion.ts` contains the clip library, sampling, interruption, idle choice, scenario mapping and portrait transform. It is pure. `animator.ts` contains the frame/timer scheduler with an injectable host. `turnCues.ts` contains the committed-report policy. `figure.ts` applies poses to the 3D rig; `Companion.tsx` routes cues to whichever view is showing. On the board the control also publishes every sampled pose through `boardPose.ts`, and `viewer/companionFigure.ts` applies it to the model standing on the islet in the 3D scene (see [unified runtime](unified-runtime.md)), so the islet figure plays the same clips as the badge; it adds only a small lean toward the viewer under the pointer or while its cloud is open. Both portraits were regenerated with the new feet-anchored framing, which leaves headroom for hops. The [motion browser check](../evidence/companion-motion/check.mjs) renders every clip in 3D and in portrait form as a [contact sheet](../evidence/companion-motion/motion-sheet.png). It also plays a match through visible controls and asserts the scenario-to-clip sequence.

Clip amplitudes and timing are first-pass proposals pending owner playtesting. These are whole-figure motions, not articulated limb poses. Articulated poses still require rigging (see section 7).

The [browser runner](../evidence/companion/check.mjs) also regenerates both fallback portraits and verifies the preserved GLBs' hashes. The models by nguyenlouis32 are licensed under CC BY 4.0. Their attribution and pinned sources are preserved in [the distributed credits](../../apps/web/public/companion/CREDITS.md).

The owner authorized the two preserved, attributed GLBs for playtesting and a labelled Conkeldurr transformation preview. Automatic serious-event eligibility and final pose approval remain distinct from that asset decision. Use the recorded issue/repair event for explanations.

- Final serious-issue categories/severity threshold and the compatible verified event source. This blocks automatic evolution, not the design specification.
- Approval of the candidate models, needed rig/pose work and the final transformation look.
- Exact timing, cooldown, companion placement and chatter frequency after playtesting.
- Master audio/settings integration, optional voice assets, language/localization and volume defaults.
- Whether later board cameos or additional evolutions are wanted. They are outside the first confirmed compact-companion scope.

## 11. Later core-game decisions

The later [completion criteria](game-completion-criteria.md) define fixed rounds, final-only adjusted load-share scoring and retained structures repaired through additions. Timburr may acknowledge verified repair and a real final outcome, but should not bank provisional load shares, infer a winner from missing reactions or trigger destructive behavior. Quarter-port/assembly interactions remain tied to actual public game events and cannot reveal hidden cards. Historical prototype behavior does not override these newer criteria.

## 12. Automatic repair explanation

In the scored Grow Dusk playtest, ending a turn with recorded corrective work prompts Timburr after the next private reveal, or on the final results screen. The explanation reads the public repair receipt in order: the affected member and issue, originating deduction, installed prop and its contact, verified outcome or pending work, and the new neutral anchor's signed reaction when available. Closing it or changing the companion model only changes presentation. After reload or later turns, activating Timburr lets the player read the historical explanation again. Turn details keeps the complete evidence independently of the companion. [Browser walkthrough](../evidence/companion-repair/check.mjs).

The owner confirmed game-owned automatic correction for both instability and overload while retaining the player move and historical penalty. Timburr explains the original issue, the specific recorded repair and its score/ownership effect; [repair criteria](failure-repair-criteria.md#6-automatic-correction-transaction) own the transaction and numerical verification. The avatar presents game events rather than modifying physics from an animation callback. Show “verified repaired”, “pending” or “could not verify” accurately, and expose the same explanation without sound/avatar motion. No repaired issue refunds its historical penalty.


## 13. Permanent local neutral scaffolding explanation

The owner confirmed permanent neutral system repairs with no player attraction award. Timburr identifies the local affected element/connection, shows the actual added prop/anchor, explains that it remains for the match and that its carried load earns nobody points, and preserves the historical penalty explanation. Do not promise that other foundation reactions are unchanged: a local physical repair can redistribute forces globally. The normal inspector must show neutral ownership, local contacts, verified reactions and remaining unavailable scope even when Timburr is hidden.

## Delegated first-release decisions — 2026-11-14

The owner delegated the remaining product decisions to Codex, prioritizing simplicity, quality and a complete functional game. These are selected release requirements, not implementation or test evidence. They supersede earlier proposals on the same subjects; other confirmed requirements and numerical acceptance gates remain in force.

Use the preserved attributed Timburr and Conkeldurr assets for the release, with model-derived matching portrait fallback and retained credits. Approve their established recognizable appearance as the starting art direction; rig/pose work must be visually validated and cannot be claimed from static GLBs. Do not replace the characters or add a progression tree.

Timburr is a small edge companion with one dismissible bubble, outside board/control safe zones. Routine actions get a glance/nod rather than narration; the board supplies essential feedback. Show one short useful explanation for a new result, correction or invalid target. Idle motion is limited to subtle breathing/weight shift, with no unsolicited repeated tips. Direct activation is rate-limited to one response per five seconds. Suppress the companion on privacy/recovery covers and wherever it would reveal private information.

The owner's subsequent three-mistake rule supersedes the earlier single-event trigger. The Shared table counts each player's distinct, committed −1 penalty events in chronological order. Each event needs a verified new or worsened active finding in its recorded pre-correction comparison. All charged issues in one turn count together. A verified overload and a witnessed instability both qualify. Matching turn, player, before/after assessment IDs and charged issue IDs establish provenance. Only the turn/player suffix of the authoritative event ID enters the companion projection.

After a calculation checkpoint settles and the incoming seat selects Ready, a charged instability gets a red dialogue bubble, an exclamation mark and a written member/turn reference. The explanation reports the recorded fitting, legacy prop or pending issue. Each player's third and sixth qualifying turns can call Conkeldurr. A checkpoint that assessed several earlier turns presents one notice. A three-charge milestone has first priority, followed by a charged instability and then an ordinary repair. Among equal priorities the most recent turn wins. The notice names the original acting player and turn. The 45-second cooldown suppresses a second spectacle during that interval. The count comes from the match's committed history and survives reload. The cue requires a newly settled checkpoint in the current workspace, so reopening a save stays quiet. Victory takes priority. The companion contributes no inputs to scoring, repair or hand generation.

The board companion stands on a 3D islet. The control publishes the sampled pose through `boardPose.ts` and identifies the requested character with `data-character`. During the 800 ms `foreman` clip Timburr starts the crouch. At its first squash peak, 160 ms in, Conkeldurr takes over the same sampler and completes the rise, flex and turn. Conkeldurr then holds for under three seconds. The scene displays its matching loaded model when the islet is visible. An offscreen islet, pending model or failed renderer leaves the screen control available with its matching model or portrait. A newly charged instability opens a red speech cloud with the member and originating turn. Reduced motion shows the still character and the same text. Dismiss and Skip transformation return to Timburr immediately.

The production browser fixture builds five loose members in alternating seats and passes turn six. Player 1 has three verified deductions and Player 2 has two. On build `924534c` it observed both figures using the same foreman sampler, one audio accent, a still/muted equivalent, and restored counts after a reload. That build preceded the scene islet. The integrated islet build awaits its production rerun. [Production browser runner](../../scripts/release-presentation.mjs)

Keep Show companion, motion and audio settings in the main settings disclosure, with a small restore control when hidden. Reduced motion uses a still pose/brief fade. Missing 3D/audio never blocks play or substitutes the wrong character. Deduplicate by committed event IDs on reload. Celebrate a verified repair without claiming the entire structure is safe.
