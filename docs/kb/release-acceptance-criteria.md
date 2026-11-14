---
title: "Whole-Game Release Acceptance Criteria"
last_validated: 2026-11-14
validated_against:
  - "Project owner completion-criteria request and follow-up decisions, 2026-11-14"
  - docs/kb/game-completion-criteria.md
  - docs/kb/solver-criteria.md
  - docs/kb/scoring-match-criteria.md
  - docs/kb/multiplayer-criteria.md
  - docs/kb/saved-match-criteria.md
  - docs/kb/controls-camera-criteria.md
owner: project owner
status: needs-review
---

# Whole-Game Release Acceptance Criteria

## 1. Status and release definition

Proposed release gate for an integrated game, not evidence that the current prototype passes. The owner confirmed local hot-seat first; online services are outside that release scope. A release must name its ruleset, supported cards/elements/solver subset, player/round presets, environments, browser/device matrix and versions. Mark omitted capabilities explicitly; a reduced playtest is not “full criteria compliance.”

Before implementation acceptance, every policy affecting legal actions, points, privacy, physics or match completion must be resolved in a versioned ruleset, or the dependent feature explicitly unavailable. Proposed numeric defaults in criteria are not owner-confirmed rules. Review the [decision register](game-completion-criteria.md) before claiming readiness.

## 2. End-to-end acceptance matrix

| Gate | Required walkthrough/evidence |
| --- | --- |
| Setup | Valid starting foundations/columns, known player order, catalogue/decks/seed, fixed rounds, required solver capabilities and privacy-ready initial view. |
| Draw and plan | Exactly two draws per deck per turn under the configured exhaustion policy; independent 1/1/2 play limits, pass, hand inspection, staging/cancel and explicit endpoints/quarter ports. |
| Legality | Card ownership, geometry bounds, lengths/orientations, crossing policy, quarter-only interior targets, common-joint profiles and immutable placed connections; actionable errors without physical penalties. |
| Analyze and assess | Versioned whole-structure analysis with component validity, before/after issue comparison, stable scope isolation, bounded unresolved handling and one eligible -1 event per turn. |
| Commit and handoff | Atomic cards/model/evidence/penalty/turn update, no duplicate effect, privacy cover before next hand, deliberate readiness and equal configured turns. |
| Finish | Correct final load-share percentage minus penalty totals, signed/zero/unknown policy, tie decision and one finalization event; no cumulative attraction scoring. |
| Recovery | Reload after draw/stage/analysis/commit/finalization, stale tab/request, corrupt import and quota failure; correct private state, no redraw or duplicated penalty. |
| Geometry and overlays | Recognizable declared families in all supported themes; readable/true-scale switch, truthful DOF permissions and separate result modes, accurate selection and valid result scope. |
| Presentation | Complete supported action feedback, skip/mute/reduced motion, no forced camera, private leak or avatar-triggered game change. |
| Accessibility | Full match by keyboard and supported touch input; target disambiguation, focus/error feedback, non-colour information and tested screen-reader workflow. |
| Robustness | Invalid/unsupported/extreme configurations handled without escaping errors, nonfinite outputs, frozen input or fabricated verified results. |

Use deterministic fixed fixtures and seeded scenario suites. Include legal unstable turns, repairs, persistent/worsened issues, quarter subdivision, diagonal members, crossings/coincidence, round-final passes, complete and incomplete final analysis, and supported assemblies. Test 2–4-player configurations only if the release claims them. A two-player prototype does not establish four-player acceptance.

## 3. Numerical and performance evidence

Numerical acceptance remains governed by [solver criteria](solver-criteria.md#7-acceptance-tests): proposed linear/nonlinear/buckling errors, scaled residuals, prescribed classifications and at least 10,000 seeded states. Add regression fixtures for quarter subdivisions and any enabled assembly/spring laws. Unit tests or agreement between two approximate solvers alone do not establish physical correctness. A renderer must not compensate for missing physical evidence.

Provisional targets remain p95 preview <=50 ms, ordinary nonlinear resolution <=250 ms and difficult states <=2 seconds or an explicit unresolved result, on documented hardware. Record solver runtime separately from transfer, queueing and presentation. Animation targets include acknowledgement within 100 ms and ordinary presentation within 1.2 seconds excluding actual analysis wait. Target routine 60 fps and measure p95 frame time; document lower-power behavior, warmup/sample count, browser/version, viewport and active overlays. No silent reduction in solver fidelity is permitted to hit a graphics target.

Test normal, stress and repeated-turn/scene-reset workloads, including aggregate assembly submember counts. Check CPU/GPU memory, resources/listeners/timers/audio voices, bounded queues and recovery after background-tab suspension. Limits and unsupported models must be visible before lengthy freezes.

## 4. Release review and evidence record

For every gate record pass/fail/not-run, build/commit, rules/catalogue/solver versions, fixture/seed, environment, expected/observed outcome and artifact/log reference. “Not run,” “unsupported” and “known failure” are not passes. Keep older evidence labelled historical; never reuse a screenshot as proof of a different build's physics or privacy.

Block a release claim for incorrect scores, duplicated cards/draws/penalties, private hand exposure, data loss, legal-state crashes, false verified stability or unsupported physics silently substituted. Cosmetic issues may be accepted only with recorded severity/limits and owner review; accessibility and basic readability are not merely cosmetic. The final disposition must name known limitations and the exact supported scope.

Required automated checks should include type checking, relevant unit/integration tests and a production build. Add full-game browser scenarios and fault-injection recovery tests; inspect real rendering/audio and assistive inputs manually as needed. CI success alone is not deployment or product acceptance. Publishing/deployment remains a separate action from validating a release artifact.

## 5. Open decisions

Name the supported browser/device/input/accessibility matrix, initial rules/catalogue preset, hardware budgets, allowed release limitations and evidence owners. Final scoring unknown/uplift/zero-load and card/placement/failure policies must not remain ambiguous in a release claiming a complete playable match. Scope and thresholds require review; no new feature implementation is authorized or claimed by this criteria document.
