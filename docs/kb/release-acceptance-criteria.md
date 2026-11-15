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

The owner selected **Grow Dusk** for release acceptance. The supported Shared table preset uses two seats, eight rounds and fixed starting foundations. Player-directed foundation placement belongs to Creative/editor. Apply the geometry, camera, controls and assistive-input checks below to Grow Dusk.

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
| Finish | Correct final load-share percentage minus penalty totals, signed/zero/unknown policy, tie decision and one finalization event; no cumulative attraction scoring; verified-component fallback uses total gravity and labels missing evidence. |
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

Name the supported browser/device/input/accessibility matrix, initial rules/catalogue preset, hardware budgets, allowed release limitations and evidence owners. The verified-component final fallback is now confirmed; remaining uplift/zero-load and correction/card/placement/failure parameters must not remain ambiguous in a release claiming a complete playable match. Scope and thresholds require review; no new feature implementation is authorized or claimed by this criteria document.

## 6. Automatic repair and partial-evidence scoring gates

Add fixtures for retained moves corrected for instability and overload, verified repair-object capacities and external effects, no hidden support/stiffness/weight changes, pre-correction penalty preserved after repair, different elastic stiffnesses with common freedom states, and crash/retry deduplication of correction objects. Verify the final fallback awards only verified reactions against total gravity without converting unknown physical forces to zero. The owner requires automatic correction as ordinary play; bounded truthful failure handling remains mandatory when correction cannot be verified. Neutral ground support/no player credit, permanent in-match repairs and local direct intervention are now confirmed. Add fixtures for unchanged total-gravity denominator, separate verified neutral share versus unknown scope, no retirement after reinforcement/reload, and true global redistribution without unrelated direct edits.

## Delegated first-release decisions — 2026-11-14

The owner delegated the remaining product decisions to Codex, prioritizing simplicity, quality and a complete functional game. These are selected release requirements, not implementation or test evidence. They supersede earlier proposals on the same subjects; other confirmed requirements and numerical acceptance gates remain in force.

Target a browser-delivered HTTPS game, Grow Dusk as the normal entry, with lazy-loaded local assets and no account or manually started solver service required for ordinary play. The in-browser Rust/WebAssembly reference path must meet the required physics for enabled inputs; use OpenSees for independent numerical checks and optional engineering workflows. Missing browser numerical coverage is implementation work and a release blocker, not permission to substitute heuristics or silently reduce fidelity.

Support current and previous major Chrome/Edge on Windows 11, Safari on current/previous macOS, and landscape iPad Safari at 1024×768 or larger. Test mouse, keyboard-only and actual tablet touch, plus NVDA/Chrome and VoiceOver/Safari. Desktop target is 1366×768 or larger. Phones need not support full building in this release; they must preserve saves and expose a clear view/recovery path. Test 200% zoom, reduced motion, mute and portrait/GPU fallback.

Benchmark routine play on Windows 11, Core Ultra 9 185H integrated Arc, 16 GB RAM, 1366×900 DPR 1; also test reduced-decoration usability on an i5-1135G7/8 GB integrated-GPU profile. Require routine 60 fps on the main profile, at least 30 fps with reduced decoration on the lower profile, and the existing p95 solver/input targets. Measure actual final integrated builds. Preserve the full solver criteria, including separate nonlinear/buckling references and the 500-member stress suite. A stress target miss is recorded and addressed, not hidden behind a small normal deck.

Run complete 16-turn matches for seeds 0 through 19 in automated browser checks, plus at least three manually inspected full matches: normal play, adverse move/neutral repair, and interrupted/recovered play. Include all-pass/zero gravity, signed uplift, partial evidence, ties, end-round passes, clash rejection, incompatible connectors, stale responses, repeated clicks, two-tab conflict, storage quota/corruption and asset/audio/GPU failure. Numerical analytical acceptance and the 10,000-state suite remain separate from game simulations. No required feature is accepted solely on a mocked solver or isolated fixture.

Use one integration owner, up to four independent implementation agents with exclusive module ownership, and a separate final verification agent when delegating. Integrate through a reviewable branch/PR; resolve shared contracts before overlapping implementation. No force pushes or destructive cleanup. Publish evidence per criterion and update the ledger. Production-ready means the declared supported target passes these and existing applicable criteria, with no critical bugs, private-hand leaks, duplicate events, data loss or falsely verified physics. Do not label incomplete requirements passed. These decisions authorize implementation planning, not a claim that implementation or release acceptance is complete.
