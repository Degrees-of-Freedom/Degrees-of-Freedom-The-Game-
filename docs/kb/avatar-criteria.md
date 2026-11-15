---
title: "Timburr Avatar Criteria"
last_validated: 2026-11-14
validated_against:
  - "Project owner multiplayer simplification and follow-up answers, 2026-11-14"
  - docs/kb/multiplayer-refresh-criteria.md
  - docs/kb/animation-criteria.md
  - docs/kb/failure-repair-criteria.md
owner: project owner
status: needs-review
---

# Timburr Avatar Criteria

## 1. Current direction and authority

The owner rejects a static/quiet corner-only avatar. Under the [multiplayer refresh](multiplayer-refresh-criteria.md), Timburr must be **moving around the screen, active, flashy, entertaining and emotive**. This supersedes the earlier small-companion-fixed-at-edge recommendation. Multiplayer is the only game type; do not build separate avatar narratives for retired modes. Criteria only; this does not claim a good live avatar is already implemented.

Use Timburr as the recurring character, with rare temporary Conkeldurr foreman mode for an appropriate verified serious event. The owner states permission for character use. Keep original source/attribution records; the [archived prototype](../../prototypes/timburr-companion/README.md) is incomplete reference material, not a production solution or approved personality.

## 2. Roaming and expressive behavior

Give Timburr a bounded screen-space roaming system with safe destinations, anticipation, movement, arrival and readable resting poses. He can walk/run/hop along an unobstructed edge, peek near a public card play, point toward a selected node, celebrate, recoil with concern, think during a checkpoint and enthusiastically demonstrate the local safety correction. Use face/body/prop language, turns, lean, squash/stretch and gestures, not only text bubbles or one perpetual bob.

Use a coherent magical engineering style and coordinated original sound accents. Ordinary interactions are brisk and varied; dramatic energy is reserved for meaningful events. Blend/cancel poses and routes rather than stacking an unbounded queue. Idle activity keeps him alive without compulsory repeated dialogue. Interaction can produce a short joke/tip/playful gesture with rate limiting.

Screen-space movement is not a new physical board object, collision or structural force. Never cover the active cursor/snap region, hand/private reveal, inspector, target labels, controls, quit affordance or critical result text. Recompute safe zones on resize/dialogs; yield immediately to player input. Do not chase every pointer movement or move the camera to follow him. Hiding him leaves a discoverable restore control and full ordinary game explanations.

## 3. Event-driven reactions

| Public event | Intended reaction |
| --- | --- |
| Turn begin / chosen deck draw | Move toward a safe tray-adjacent zone, curious anticipation and short card-arrival acknowledgement; never identify an opponent's hidden card. |
| Member/load/rotation-mask play | Point or react to the actual target; no claim of analysis on unsolved turns. |
| Noncheckpoint turn commit | Upbeat handoff, explain “next analysis in N turns”; do not celebrate a fabricated stable solve. |
| Checkpoint replay / analysis | Thinking/building anticipation, visibly pending; do not reveal a result early. |
| Attributed issue / penalty | Indicate affected original turn/player and local element clearly, without insults or blaming the current checkpoint player. |
| Minimum local correction | Gesture at the actual node/axes and show the recorded safety restraint; no column downward, scaffold or new foundation animation. |
| Verified improvement / final result | Relief/celebration scoped to actual evidence; final-only score, no banked attraction awards. |
| Quit / privacy cover / resume | Exit or yield instantly, conceal private cues, no delayed audio burst or repeated prior event. |

A Conkeldurr transformation is temporary, skippable and cooldown-controlled. It requires the authoritative verified event; ordinary invalid input, pending turns and unresolved numerical work do not cause “you broke it” spectacle. It changes no card, constraint or score. Timings and event ordering follow [animation criteria](animation-criteria.md).

## 4. Correction explanation and structural truth

The game coordinator, not an avatar animation callback, decides correction. Timburr explains the diagnosed issue, originating turn, minimum local rotational or required system translational restraint, whether verification succeeded, and the historical penalty/unscored safety-reaction effect. Inspector/results/history expose the same facts. Do not imply actual columns, extra foundations, deleted weight or zero global redistribution.

Original committed member/connector properties stay read-only. Corrected idealized results have explicit system constraints/reactions and checkpoint provenance; unsolved current topology is not certified safe. An animation finishing is not numerical verification.

## 5. Assets and technical requirements

Candidate GLBs are recorded in [prototype handoff](../../prototypes/timburr-companion/README.md), from nguyenlouis32 under embedded CC BY 4.0 metadata, with separate Pokémon character rights noted. They have no embedded animation clips. Inspect mesh/rig/pose suitability and create/source needed motion before claiming the expressive target is met. A static GLB with text alone does not satisfy this revision. Keep assets local with attribution, and supply an approved corresponding portrait/static-pose fallback if 3D is unavailable; do not claim it is equivalent to the full animated experience.

Use one bounded presentation coordinator, lazy asset loading, resource ownership, pause/visibility handling and cleanup. Benchmark with the live 15×15 board, target bloom, inspector and force vectors. Do not trade solver correctness/input responsiveness for character effects. Online services, voice acting and additional evolution progression are not added by this request.

## 6. Accessibility and acceptance

Provide reduced motion (still poses/short fades instead of roaming), mute/volume, glow control, dismiss/skip and hide/restore. Honour system preference and saved override. Keep text/keyboard focus stable and politely announce only meaningful results. No flashing above accessibility limits or mandatory audio.

A recorded full multiplayer walkthrough must demonstrate varied active roaming, expressive draw/play/checkpoint/correction/final reactions, real motion/pose quality, no obstructed interaction/private leak, exact event deduplication and correct skip/mute/reduced/quit behavior. Test resize, narrow screens, background tabs, model failure and resource stability. Owner review of the revised character presentation remains necessary; no current artifact is declared approved by this criteria change.
