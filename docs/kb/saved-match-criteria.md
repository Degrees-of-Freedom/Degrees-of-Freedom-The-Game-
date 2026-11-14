---
title: "Saved Match and Recovery Criteria"
last_validated: 2026-11-14
validated_against:
  - "Project owner completion-criteria request and follow-up decisions, 2026-11-14"
  - docs/kb/structural-state.md
  - docs/kb/turn-criteria.md
  - docs/kb/card-definition-criteria.md
  - docs/kb/scoring-match-criteria.md
  - docs/kb/multiplayer-criteria.md
owner: project owner
status: needs-review
---

# Saved Match and Recovery Criteria

## 1. Scope and authority

Proposed complete-match persistence requirements. The existing structural snapshot, voxel saves and local turn replay are partial building blocks; none alone certifies compliance. Save the game needed to resume correctly, not just a renderable structural model. Keep the analytical snapshot distinct from UI preferences and private/public export scopes.

## 2. Versioned match envelope

| Group | Required saved information |
| --- | --- |
| Identity and rules | Format/schema version, match ID, monotonically identified revision and parent, rules/scoring/penalty/catalogue versions, supported mode/player/round configuration and application provenance. |
| Players and economy | Stable player/foundation ownership IDs, order, hands, card instance/definition IDs, locations, decks/discards, recorded shuffle algorithm/seed or equivalent reproducible sequence, draw positions and exhaustion events. |
| Structural state | Immutable model revision or embedded resolved snapshot; member/joint/end/connection/load IDs, joint frames/common freedoms, material/section properties, spring/cable state, quarter-port lineage and assembly parent/part mappings. |
| Turn transaction | Turn/round/active player, phase, completed-draw marker, staged draft/cards, parent model, action/commit IDs, accepted event log and pending validation/analysis intent. |
| Evidence and score | Solver/adapter/options versions, result/model IDs, fidelity, validity/scope, diagnostics and issue baseline; committed issue comparisons and deduplicated penalty events; final load/share/score breakdown, pending/final outcome and tie policy. |
| Presentation recovery | Privacy-cover/readiness status, view/selection where safe, display preferences or references. No animation frame is needed to reconstruct the game. |

A save must contain resolved definitions or an immutable retrievable definition version/hash; do not reinterpret old cards using whatever catalogue is current. Record reference geometry and explicit rest strain/damage only where the enabled rules permit it. Readable mesh thickness and camera position never change physical properties.

## 3. Atomicity and crash recovery

Treat an accepted turn as one logical commit: structure, card/pile changes, evidence/issue scope, penalty event and turn advancement either all belong to the committed revision or none do. Persist a validated revision and update a current-head pointer using a documented transactional or recoverable journaling protocol. A succession of unrelated localStorage writes is not by itself atomic. Detect orphan/incomplete writes and recover the last complete revision; preserve the incomplete copy for diagnosis/export.

Serialize writes per match, reject conflicting/stale parent revisions and avoid silent last-writer-wins across tabs. An interrupted draw resumes with the same recorded card identities; it must not reroll randomness. A pending analysis request may be retried with the same idempotent intent/model/options, but a stale reply cannot overwrite newer evidence or duplicate a penalty. Completed animation callbacks never decide whether a turn was saved.

If analysis is not finalized, restore the pending/unknown status honestly. Compatible saved verified evidence may be reused for its exact model/options/policy only. Missing or incompatible solver versions must not silently recompute a different official history. If the bounded final-resolution process ends with unverified scope, preserve the confirmed scoring policy’s zero attraction award for that scope, unavailable physical results and labelled partial-evidence finalization; this is not a fabricated complete load-share result.

## 4. Validation, compatibility and privacy

Validate all imported/persisted data as untrusted: format/version, finite values, ID uniqueness, references/locations, legal card ownership and allowances, draw/event counts, profile compatibility, quarter-port fractions, configured bounds, parent lineage and result/version matching. Do not run code or resolve arbitrary external assets from a save. Apply size/complexity limits before expensive allocation or analysis. Checksums detect corruption, not cheating or authenticity on an untrusted local device.

Migration must be explicit, versioned and non-destructive, retain the source, describe changed meaning and validate the result. Mixed-profile legacy joints, coordinate-only connections, missing resolved properties and changed quarter/assembly identities may be unrecoverable without user input. Offer read-only/export/restart rather than silently coerce them. Future versions are unsupported, not “best effort” matches.

Full local match exports include private hands/decks; label them accordingly. Public summaries/replays must omit hidden information until the disclosure policy permits it. Never promise secrecy of plaintext local saves from the device owner. On restored hot-seat play, reveal the privacy cover before any private content. Do not store credentials in exported match data.

## 5. Storage UX and acceptance

Explain autosave state and last successful committed revision. Provide manual export/import and recoverable backup management. Storage quota/permission failures must be visible, preserve the in-memory match and prior valid bytes, and offer export. Do not display “saved” merely because a commit animation ended. A reload when persistence failed must not claim the missing turn was safely stored.

| Fault / scenario | Required result |
| --- | --- |
| Crash after each commit write boundary | Recover one complete state, not half cards/structure/penalties. |
| Reload after draw / staged draft / analysis pending / finalization | Identical identities and logical phase; no redraw, duplicate deduction or changed winner. |
| Two tabs / out-of-order result / retry | Explicit conflict/stale handling and one accepted effect. |
| Old/new/corrupt/oversized save | Safe refusal or explicit migration; original retained; no crash or invented physics. |
| Catalogue/solver unavailable or changed | Preserve history and explicit unavailable capabilities; no silent reinterpretation. |
| Quota failure / export / private handoff | Honest save status, recovery/export, no accidental private reveal. |

Open: storage backend, retention/backup UX, migration support window, maximum import size, save-history limits and any optional encryption. These are implementation choices requiring evidence, not a requirement to add cloud storage or SQLite immediately.

## 6. System-repair provenance

Persist the retained player move, pre-correction evidence/penalty attribution, versioned repair request/candidates and bounded resolution status, accepted game-owned object/connection IDs/properties, post-correction results and any retirement events. System objects and their reactions need separate ownership/scoring identity. Crash/retry cannot create another repair or penalty. Keep unequal elastic stiffnesses per connector and historical penalties after repair. Record the confirmed verified-component final-award scope and total-gravity denominator independently of unavailable physical reactions.
