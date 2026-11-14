---
title: "Multiplayer and Information Visibility Criteria"
last_validated: 2026-11-14
validated_against:
  - "Project owner completion-criteria request and follow-up decisions, 2026-11-14"
  - docs/kb/turn-criteria.md
  - docs/kb/scoring-match-criteria.md
  - docs/kb/saved-match-criteria.md
  - docs/kb/controls-camera-criteria.md
owner: project owner
status: needs-review
---

# Multiplayer and Information Visibility Criteria

## 1. Confirmed release scope

The owner confirmed **local hot-seat first, with a private handoff screen between players**. Online multiplayer, accounts, matchmaking, spectators, chat and server deployment are not first-release requirements. This is a target specification; the current local playtest is not proof of complete privacy, scoring or recovery compliance.

Proposed initial preset is two local players; 2–4-player support remains to validate/configure. Player count/order and fixed round count are recorded before a match starts. No change mid-match may grant extra turns, draws or foundation ownership.

## 2. Public and private information

Proposed information policy: structure, intentional connections/profiles, loads, foundation ownership, committed turns, public issue reports and penalty/score breakdowns are public. Active players can inspect their own hand; opponent card faces, hand identities, future draw order and hidden seeds/deck state are not public UI information. Whether hand counts and discard identities are public must be declared in the release policy.

Do not leak private cards through tooltips, DOM accessible names, background rendered layers, audio cues, avatar remarks, image alt text, debug panels or replay views intended to be public. Separate full local saves/debug exports from redacted public/share exports. A local device owner can inspect local files/developer state: hot-seat privacy protects normal play, not a hostile administrator. Do not describe client-side hiding as cryptographic secrecy or online anti-cheat.

## 3. Handoff state machine

1. Resolve and atomically commit the outgoing player's turn under the rules; finish public outcome presentation or allow its safe skip.
2. Hide the outgoing hand, private tooltips/dialogs and focused private labels **before** revealing the incoming hand or allowing input. The privacy cover appears immediately; animation does not delay concealment.
3. Show a neutral public cover naming only the next player and a deliberate “Ready / Reveal my hand” action. Proposed keyboard/touch support must not allow the same click/key that ended the last turn to reveal the next hand.
4. Reveal only the incoming player's private view after that action. Begin the recorded draw exactly once at the defined turn boundary; reveal retries, reload or handoff cancellation cannot redraw.

Reload, restore, returning from a hidden tab and resuming an interrupted handoff default to the privacy cover for any private active view. Preserve the logical turn/draw state; concealment does not rewind history. Proposed optional practice mode may bypass handoff only when explicitly configured and visibly identified before play. Never bypass privacy silently because both players share a device.

## 4. Local authority and future online boundary

One match coordinator owns legality, deck order, turn/model revision, analysis eligibility and scoring. Presentation reads scoped public/private views; buttons and avatar callbacks are not rule authorities. Require parent version, actor and idempotent action/commit IDs. A second tab or duplicate submission must not commit conflicting turns or double-consume cards; refuse a stale writer and offer read-only/reload recovery.

For any future online edition, the server must own hidden decks/RNG, permission checks, accepted actions, authoritative analysis/results and final scoring. Treat clients as untrusted, validate actor/version and serialize commits; use authenticated private channels, reconnect snapshots, deduplication and versioned protocols. Connection loss must not invent a pass, forfeit or redraw. These are deferred design requirements, not a claim that a server exists or that hot-seat storage is suitable for ranked online play.

## 5. Acceptance and open policy

| Scenario | Required result |
| --- | --- |
| Normal handoff / fast double click / held key | Outgoing data hidden, next hand requires distinct deliberate acknowledgement, one draw per turn. |
| Reload during planning, analysis or privacy cover | Correct logical state and private view concealed before readiness. |
| Screen reader / muted / reduced motion | No private information announced to the wrong player; equivalent readiness controls. |
| Inspect public structure / debug/export/replay | Only permitted information disclosed; exports labelled by privacy scope. |
| Two tabs / stale actor / repeated request | One authority, explicit conflict handling, no duplicated committed effects. |
| End of fixed-round match | No extra player hand revealed or extra turn begun. |

Open: player-count presets, public hand/discard counts, practice privacy override, concession/abandonment and shared-device pause policy. Online/session identity requirements must be separately reviewed before extending the release scope.
