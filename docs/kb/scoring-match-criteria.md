---
title: "Scoring and Match Resolution Criteria"
last_validated: 2026-11-14
validated_against:
  - "Project owner completion-criteria request and follow-up decisions, 2026-11-14"
  - docs/kb/turn-criteria.md
  - docs/kb/solver-criteria.md
  - docs/kb/failure-repair-criteria.md
  - docs/kb/saved-match-criteria.md
owner: project owner
status: needs-review
---

# Scoring and Match Resolution Criteria

## 1. Status and confirmed rules

This is a design specification, not implemented scoring. The owner confirmed a fixed-round match, foundation load attraction scored **only at match end**, and **final score = final load-share percentage minus accumulated penalty points**. Highest adjusted score wins. This supersedes earlier unconfirmed cumulative/round scoring options and the raw-share-only interpretation. No load-attraction points accumulate during play. The existing once-per-turn -1 penalty for a verified new/worsened eligible issue remains in force.

The first multiplayer release is local hot-seat. Exact round count, tie tolerances and unresolved final-result policy below remain proposals. A round is one completed turn by each configured player; passes count. Proposed starting preset: 2 players, 8 full rounds, with supported player counts and round limit declared before setup. The older playtest's settings are not automatically final balance rules.

## 2. Final score calculation

Use an explicit versioned scoring policy and final committed model/result. For a candidate base policy, Z is up and all scored applied loads are persistent downward gravity. Let W be their total positive downward force magnitude across the complete shared model. Let R_i be the sum of signed upward foundation reactions belonging to player i in that same verified load state. Define:

`loadSharePercent_i = 100 * R_i / W`

`finalScore_i = loadSharePercent_i - penaltyPoints_i`

Penalty points are positive counts of committed -1 events, not a second deduction applied when loading the match. Example: a verified 60% share and two penalty events gives 58 points; 40% and no penalties gives 40. Show share, penalty subtotal and adjusted score separately. Display rounding must not determine the winner; compare stored full-precision values under a versioned tie tolerance. Negative adjusted scores are allowed under this proposed formula.

**Proposed uplift policy:** retain signed R_i. An uplift reaction can produce a negative share; another foundation may exceed 100%. Do not clamp/renormalize reactions, cap shares at 100%, or introduce positive-only attraction without owner approval. Under a fully valid gravity-only state the signed reactions must balance W within solver tolerances, not arbitrary display rounding.

**Proposed load policy:** self-weight off for the first scored preset, so W and reactions refer to the same gravity-card load set. If self-weight is enabled later, declare whether it is included in both the scoring load and denominator. Do not subtract separately solved self-weight/pretension contributions from nonlinear results using assumed superposition. Foundation ownership groups verified reactions; member/card ownership never changes stiffness or load attraction. Pretension alone does not create scored applied gravity load.

## 3. Incomplete or invalid results

Publish component-scoped validity and applied load totals without pretending missing reactions are zero. Preserve verified results for unrelated stable parts. Do not normalize the verified subset into a full-model 100% share. Results from a prior topology cannot become the final score for a different topology.

Proposed finalization rule: a winner requires verified final scoring evidence for every required scope. Preserve valid partial contributions for inspection, but keep the final score/winner **pending**, rather than awarding provisional totals as final. Attempt bounded recovery using the solver policy. If the verification budget is exhausted, mark the match incomplete/unranked with an explanation and export/retry options. No fabricated physical penalty or automatic win/loss follows from a timeout. This policy, including treatment of a genuinely unstable final structure, needs owner confirmation; do not quietly implement zero load share or a forfeit as a substitute.

If W is zero, do not divide by zero or award equal invented percentages. Proposed policy: zero attraction points for all players, then compare accumulated penalties; label “no scored gravity loads.” This differs from numerical failure and needs confirmation. Any self-equilibrated loading still needs valid interpretation before applying a gravity-share formula.

## 4. Ending and tie handling

Freeze the configured round limit, player order, supported catalogue, seed and scoring/penalty versions at setup. End after every player has completed the final round; there are no extra draws, turns or attraction awards after the boundary. A legal final pass still receives normal analysis and issue assessment. No target-score victory is used in this confirmed fixed-round format.

Once the final turn and all required verification are committed, create one idempotent finalization event referencing the model/result and score breakdown. Proposed tie policy: joint winners within a documented absolute score tolerance, initially 0.01 points for playtesting. Do not secretly use raw share, seat order or animation timing as a tiebreak. Concessions, abandoned games, rematches and optional time limits need explicit policies; they are not implicit ways to bypass pending verification.

Show current reaction estimates as **provisional load share**, not banked points. Clearly separate historic estimates, committed penalties, projected adjusted result and final outcome. Finalization and animations cannot consume cards or repeat score events. Save/reload must preserve the same outcome and tie decision.

## 5. Acceptance and open decisions

| Scenario | Required result |
| --- | --- |
| 60/40 verified share, two penalties on first player | Final scores 58/40; share and penalty remain separately inspectable. |
| Recompute, retry or reload final turn | One finalization and one copy of each penalty; no attraction accumulation. |
| Uplift / asymmetric supports | Correct signed reactions and declared policy; no forced positive 100% distribution. |
| Independent invalid component | Valid results preserved, missing scope explicit; no invented final winner. |
| No loads / numerical failure | Distinct policy paths, no division by zero or false equal distribution. |
| Final pass / equal rounds | Exactly the configured number of turns per player before finalization. |
| Near tie / reordered players / display rounding | Versioned tolerance and same physical/policy outcome. |

Open: round/player presets, uplift/self-weight policy, final instability/unresolved handling, zero-load result, tie tolerance, concession/abandonment and any future deferred penalties. These must be resolved in a release ruleset, not hard-coded from recommendations. See [release acceptance](release-acceptance-criteria.md).
