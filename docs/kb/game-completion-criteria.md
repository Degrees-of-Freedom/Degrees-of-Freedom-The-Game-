---
title: "Core Game Completion Criteria and Decisions"
last_validated: 2026-11-14
validated_against:
  - "Project owner completion-criteria request and follow-up decisions, 2026-11-14"
  - docs/kb/turn-criteria.md
  - docs/kb/solver-criteria.md
  - docs/kb/scoring-match-criteria.md
  - docs/kb/placement-criteria.md
  - docs/kb/card-definition-criteria.md
  - docs/kb/failure-repair-criteria.md
  - docs/kb/controls-camera-criteria.md
  - docs/kb/multiplayer-criteria.md
  - docs/kb/saved-match-criteria.md
  - docs/kb/release-acceptance-criteria.md
owner: project owner
status: needs-review
---

# Core Game Completion Criteria and Decisions

## 1. Scope and source of truth

This is the entry point for the eight completion criteria requested after the initial game/solver/presentation specifications. **Documentation only:** it does not implement the rules, physics, privacy screens, meshes, persistence or release tests. Owner-confirmed choices below supersede earlier contradictory proposals. Recommendations and unresolved parameters are explicitly labelled; a future implementer must not promote them to approved rules silently.

| Area | Criteria page | Responsibility |
| --- | --- | --- |
| Scoring and match resolution | [Scoring](scoring-match-criteria.md) | Final attraction formula, penalties, fixed rounds, validity and outcome. |
| Placement and connection legality | [Placement](placement-criteria.md) | Grid/diagonal geometry, clashes, quarter ports, assembly economy and immutable attachments. |
| Element/card definitions | [Cards](card-definition-criteria.md) | Versioned physical data, capabilities, catalogue/deck authoring and instance locations. |
| Failure and repair | [Issues and repair](failure-repair-criteria.md) | Verified comparisons, one-point ledger, retained structure and explicit repair outcomes. |
| Controls and camera | [Interaction](controls-camera-criteria.md) | Mouse/keyboard/touch parity, precision targeting, navigation and interruption. |
| Multiplayer/information | [Multiplayer](multiplayer-criteria.md) | First-release local hot-seat, private handoff and future authority boundary. |
| Complete saved match | [Persistence](saved-match-criteria.md) | Atomic/recoverable full state, deterministic replay, validation and migration. |
| Integrated acceptance | [Release gates](release-acceptance-criteria.md) | One complete-match acceptance matrix and supported-scope/evidence declaration. |

[Turn criteria](turn-criteria.md) remain the source for the confirmed draw/play limits and per-end connection cards. [Solver criteria](solver-criteria.md) govern numerical verification. [Joint DOFs](joint-dof-criteria.md), [element geometry](element-representation-criteria.md), [animation](animation-criteria.md) and [avatar](avatar-criteria.md) remain presentation specifications; they do not decide legal actions or fabricate physical evidence.

## 2. Owner-confirmed decision register

| ID | Confirmed decision | Supersedes / consequence |
| --- | --- | --- |
| G01 | Load attraction is scored only at match end. | No per-turn or per-round attraction accumulation. |
| G02 | A fixed number of complete rounds ends the standard match. | No target-score victory. Exact round count remains a preset decision. |
| G03 | Final score = final foundation load-share percentage minus accumulated penalty points; highest adjusted score wins. | Raw load share alone is not the winner after penalties. |
| G04 | Local hot-seat first, with a private handoff screen. | Online multiplayer is deferred beyond the first release. |
| G05 | 3D grid endpoints, including diagonals within card-defined lengths/orientations. | No arbitrary free-positioning default. |
| G06 | Interior attachment at original-reference 25%, 50% and 75% only. | Earlier blanket deferral of interior attachments is superseded. Proposed quarter-port exception handles non-grid coordinates explicitly. |
| G07 | Quarter attachments are required for every element family, including cables and springs. | Validation cannot be skipped by presenting a marker; compatible analytical laws are required. |
| G08 | Unconnected elements are allowed, physical clashes are not. | Visual coincidence is not connectivity; projected crossing and physical material interference are different cases. |
| G09 | One planar/trichord assembly card consumes one element play; each external attachment needs a connection card. | Earlier one-member-only prohibition is revised for authored assembly cards; internal authored parts are not separately dealt cards. |
| G10 | Retain structures with issues, report/apply applicable verified -1 turn penalty, and repair by adding elements/connections. | No automatic collapse, removal or stiffness damage in standard play. |
| G11 | Repairs are clearly identified and allow continued play. | Resolved issues clear from active warnings after verification; retained unknown geometry is not an invented equilibrium. |

The earlier confirmed two decks, two draws per deck, independent up-to-1/1/2 plays, shared access, setup-only fixed foundations, immutable placed connections, matching shared-joint freedoms and no repeat/unknown penalties remain in force. Distinct external attachment cards still matter even when geometry is subdivided internally.

## 3. Pending decisions and recommendations

Historical penalty refund, exact elastic matching policy and final unresolved-result disposition are being clarified with the owner. Do not infer an answer from a proposed default or from elapsed time. Record any subsequent answer here and propagate it to the relevant criteria.

Other recommendations requiring approval/configuration: number of rounds/players; signed uplift/self-weight and zero-load scoring; tie tolerance; hand/deck retention and exhaustion; first joint-profile establishment; clash tolerances/fitting geometry; actual card properties and spring/assembly/cable quarter-port laws; issue eligibility/worsening thresholds; camera/keymap/device targets; storage/migration limits. Recommendations are developed in the linked pages; a scored release must freeze all applicable choices in a versioned ruleset.

In particular, the proposed scoring formula uses signed upward reactions over the same total applied gravity load and does not renormalize missing components. Final verification, uplift and zero-load policies are distinct choices: valid signed physics is required even if a future game policy scores it differently.

## 4. Implementation sequence and current limitations

1. Freeze the initial reviewed rules/catalogue and evidence validity policy. Resolve open gameplay choices before shipping dependent scoring/legality.
2. Extend definitions, joint/port identity and complete-match transactions without breaking legacy data. The existing shared structural snapshot is a building block, not complete match persistence.
3. Implement grid/quarter/clash/assembly validation and validate associated numerical subdivision/constitutive laws. The current two-end spring/cable or per-end fixed/ball records do not establish this scope.
4. Integrate component-valid analysis, issue comparisons and the idempotent penalty ledger, then final scoring.
5. Implement hot-seat privacy, full input/camera workflows and interruption/recovery.
6. Validate a complete match with the release matrix, including geometry/DOF/presentation/accessibility and stress evidence.

This ordering is a recommendation, not a claim of completed work. The local Shared table has partial draws/staging/commits and experimental analysis; verified penalty comparison, final scoring, broad quarter ports, clash-aware physical catalogue and complete recovery/privacy acceptance are not established by current documentation or prototype tests. Keep [development and testing](development-and-testing.md) and the [solver gap analysis](solver-criteria-gap-analysis.md) accurate as later work ships.

## 5. Criteria-document acceptance

All eight areas must contain traceable confirmed decisions, proposed workflows, error/unknown handling, acceptance scenarios and open parameters. Cross-links and older criteria must reflect superseding choices, especially final-only scoring, quarter attachments for every family, assembly cards and retained repaired structures. No runtime change or unsupported numerical claim belongs in this documentation task. Future implementation evidence must be recorded separately from these design requirements.
