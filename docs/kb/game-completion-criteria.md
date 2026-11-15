---
title: "Core Game Criteria — Current Multiplayer Rules"
last_validated: 2026-11-14
validated_against:
  - "Project owner multiplayer simplification and follow-up answers, 2026-11-14"
  - docs/kb/multiplayer-refresh-criteria.md
  - docs/kb/turn-criteria.md
  - docs/kb/solver-criteria.md
owner: project owner
status: needs-review
---

# Core Game Criteria — Current Multiplayer Rules

## 1. Current source of truth

Read [multiplayer simplification](multiplayer-refresh-criteria.md) first. It contains the latest confirmed MR01–MR19 register and supersedes earlier conflicting decisions, even if an older page called them confirmed. This is documentation, not a claim of implemented behavior. [Pre-refresh decisions](history/pre-refresh-game-decisions.md) are historical only.

Only multiplayer Shared table remains a target game type. The current release remains local hot-seat with private handoff, fixed rounds and final-only adjusted load-share scoring. The deck, turn and physics checkpoint rules have changed substantially; do not reproduce the old per-turn solver/1-member/1-load/2-connector prototype as the intended game.

## 2. Owner-confirmed decision register

The current confirmed register is [MR01–MR19](multiplayer-refresh-criteria.md#2-current-confirmed-decisions); it replaces conflicting G-series decisions. Earlier G-series records are [historical](history/pre-refresh-game-decisions.md).

## Current criteria map

| Area | Source | Current requirement |
| --- | --- | --- |
| Turns/cards | [Turn criteria](turn-criteria.md) | Four source-selectable draws; any held elements/connections/loads playable; preserve explicit attachment identity. |
| Checkpoints | [Refresh sections 3–4](multiplayer-refresh-criteria.md#3-analysis-cadence-settings-and-result-freshness) | Every 3 global completed turns by default, editable interval, match-end solve; checkpoint replay attributes original turns. |
| Scoring | [Scoring criteria](scoring-match-criteria.md) | Final share percentage minus historical penalties; system safety reactions unscored, unknown forces unavailable. |
| Placement | [Placement criteria](placement-criteria.md) | 15×15 field, max lengths 5/7/10 can be shorter, quarter interfaces, no material clashes, locked starting pieces. |
| Definitions | [Card criteria](card-definition-criteria.md) | One axial/bending member, cable, springs 0.25k₀/0.5k₀; only 1/2/3 restrained-rotation connector types. |
| Correction | [Repair criteria](failure-repair-criteria.md) | Minimum local restraints; no downward columns, props or new foundations. |
| Interaction | [Controls criteria](controls-camera-criteria.md) | Inspector panel, editable drafts/read-only committed pieces, bold nearby/faded distant targets, quit anytime. |
| Privacy | [Multiplayer criteria](multiplayer-criteria.md) | Only multiplayer; independent source-deck draws and private hot-seat handoff, no card leaks. |
| Persistence | [Saved match criteria](saved-match-criteria.md) | Save pending checkpoint window, selected draws, repair layers, settings and quit/resume state atomically/recoverably. |
| Visuals | [Geometry](element-representation-criteria.md), [DOFs](joint-dof-criteria.md), [visualization](visualization-criteria.md) | Reduced catalogue, two endpoint coils, node-only rotations, tension outward/compression inward vectors. |
| Personality/events | [Avatar](avatar-criteria.md), [animation](animation-criteria.md) | Active roaming/emotive Timburr; explicit cause-to-effect turn/checkpoint/correction events. |
| Acceptance | [Release criteria](release-acceptance-criteria.md) | Validate the revised full match, including no noncheckpoint solver calls and original-turn penalty attribution. |

## 3. Retained and superseded decisions

Retained: shared access, intentional connectivity, quarter attachment on every playable family, no physical clashes, immutable committed player pieces, compatible common rotational freedoms at shared joints, fixed setup foundation/column, one historical -1 per responsible turn with verified new/worsened eligible issues, no repeated/unknown penalties, final verified-component fallback, honest validity and private hot-seat hands.

Superseded: multiple game types; two fixed draws per deck; 1/1/2 play caps; mandatory every-turn solves; assembly/section-family card decks; player translational/elastic connection laws; additional neutral anchor/foundation/column meshes; mandatory fixed corner avatar. System-only corrective translation restraints are an explicitly recorded exception, not a new connection card or a new foundation.

## 4. Implementation handoff and open parameters

Run the [four separate implementation prompts](../implementation-prompts/README.md) in order. Each session reads current main, preserves unrelated work and produces a concrete tested handoff. They are prompts, not already created sessions or implementation.

Remaining authored parameters include actual k₀/member properties, vertical field extent, supported interval limits, tolerance/correction budgets, card counts/load magnitudes/exhaustion, and tie/uplift/self-weight/zero-load policy. Do not reopen the answered cadence, draw, unlimited-load, spring-reference or inspector-permission decisions. Keep current solver integration facts in [structural solver](structural-solver.md) and [Rust solver](rust-solver.md); do not discard working backends because the playable catalogue is smaller.
