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

The first multiplayer release is local hot-seat. The owner approved two players, eight rounds, signed reactions under gravity-card loads only, zero attraction at zero gravity, and joint winners within 0.01 points for the scored preset. A round is one completed turn by each configured player; passes count. Proposed starting preset: 2 players, 8 full rounds, with supported player counts and round limit declared before setup. The older playtest's settings are not automatically final balance rules.

## 2. Final score calculation

Use an explicit versioned scoring policy and final committed model/result. For a candidate base policy, Z is up and all scored applied loads are persistent downward gravity. Let W be their total positive downward force magnitude across the complete shared model. Let R_i be the sum of available signed upward foundation reactions belonging to player i from verified components in that same final load state. Keep a separate completeness mask; unavailable reactions are not numeric zero. Define:

`loadSharePercent_i = 100 * R_i / W`

`finalScore_i = loadSharePercent_i - penaltyPoints_i`

Penalty points are positive counts of committed -1 events, not a second deduction applied when loading the match. By owner decision they remain historical deductions after verified repair; do not refund them when current issue markers clear. Example: a verified 60% share and two penalty events gives 58 points; 40% and no penalties gives 40. Show share, penalty subtotal and adjusted score separately. Display rounding must not determine the winner; compare stored full-precision values under a versioned tie tolerance. Negative adjusted scores are allowed under this proposed formula.

**Approved scored preset uplift policy.** retain signed R_i. An uplift reaction can produce a negative share; another foundation may exceed 100%. Do not clamp/renormalize reactions, cap shares at 100%, or introduce positive-only attraction without owner approval. Under a fully valid gravity-only state the signed reactions across all player **and neutral system** supports must balance W within solver tolerances, not arbitrary display rounding. Player shares alone need not sum to 100% when neutral supports carry load.

**Approved scored preset load policy.** self-weight off for the first scored preset, so W and reactions refer to the same gravity-card load set. If self-weight is enabled later, declare whether it is included in both the scoring load and denominator. Do not subtract separately solved self-weight/pretension contributions from nonlinear results using assumed superposition. Foundation ownership groups verified reactions; member/card ownership never changes stiffness or load attraction. Pretension alone does not create scored applied gravity load.

### Permanent neutral support share

By owner decision, neutral system repair scaffolding/ground anchors earn no attraction for any player and remain in the physical model for the rest of the match. They are a separate support-owner class. Exclude neutral reactions from every R_i while retaining W for the complete gravity load, not only the amount carried by player foundations. A neutral repair attached near a player's member does not belong to that player for scoring.

Example: W = 100 kN, verified player reactions are 30 kN and 20 kN, and verified neutral reactions carry 50 kN. Player attraction awards are 30 and 20 points before historical penalties; the neutral share is 50% and earns no player points. This is a **fully verified** result, distinct from a case with 50% unverified scope. Never renormalize it into 60/40 or subtract neutral-carried gravity from W. Preserve individual signed neutral reactions and include them in physical force/moment balance.

Show player awarded share, neutral support share and unavailable scope separately, with validity. In nonlinear models report actual joint equilibrium reactions; do not invent independent load attribution by superposition. Repair mass/self-weight follows the declared scoring load policy consistently—no hidden load deletion or unrecorded change to the denominator.

## 3. Incomplete or invalid results

Publish component-scoped validity and applied load totals without pretending missing reactions are zero. A reaction is score-eligible only within an independently verified physical component/load state; do not cherry-pick apparently finite support numbers from an otherwise unverified component. Preserve verified results for unrelated stable parts. Do not normalize the verified subset into a full-model 100% share. Results from a prior topology cannot become the final score for a different topology.

**Confirmed final fallback:** attempt bounded supported recovery and any separately authorized physical corrections first. When that process ends, score only verified component reactions against W, the total applied gravity across the complete final model. Unverified contributions receive **zero attraction award**, while their physical reactions remain **unavailable**, not zero. Do not renormalize the verified subset to 100%, reuse stale reactions or remove unverified loads from W. Penalties remain governed by their verified historical ledger, not by this award fallback.

For each player expose verified awarded share, unavailable component scope and evidence completeness; a player with no verified reaction contribution receives zero attraction points before penalties. Finalize the result under this declared game policy and label **partial-evidence final result** when applicable. A policy-valid winner does not prove every component has a verified equilibrium or identify its true complete physical load share. Any later correction/reanalysis after finalization must create an explicit versioned amended outcome, never silently rewrite the winner or ledger.

Example: W = 100 kN, verified upward contributions are 30 kN and 20 kN, and 50 kN belongs to unverified scope. Attraction awards are 30 and 20 points before penalties, with 50 percentage points unawarded. They are not 60/40. This is a scoring decision, not a claim that missing supports carry zero physical force. The owner wants automatic correction to make fallback unnecessary in ordinary play; game-owned automatic correction for instability and overload is confirmed, with permanent neutral local repairs under [repair criteria](failure-repair-criteria.md#7-permanent-neutral-repairs-with-local-intervention). These require real physical models and cannot be replaced by artificial stabilization or fabricated results.

If W is zero, do not divide by zero or award equal invented percentages. The approved preset gives zero attraction points to all players, compares accumulated penalties and uses the label “no scored gravity loads.” Any self-equilibrated loading still needs valid interpretation before applying a gravity-share formula.

## 4. Ending and tie handling

Freeze the configured round limit, player order, supported catalogue, seed and scoring/penalty versions at setup. End after every player has completed the final round; there are no extra draws, turns or attraction awards after the boundary. A legal final pass still receives normal analysis and issue assessment. No target-score victory is used in this confirmed fixed-round format.

Once the final turn, bounded resolution process and verified-component award scope are committed, create one idempotent finalization event referencing the model/result and score breakdown. The approved scored preset declares joint winners within 0.01 points using unrounded scores. Do not secretly use raw share, seat order or animation timing as a tiebreak. Concessions, abandoned games, rematches and optional time limits need explicit policies; they are not implicit ways to bypass pending verification.

Show current reaction estimates as **provisional load share**, not banked points. Clearly separate historic estimates, committed penalties, projected adjusted result and final outcome. Finalization and animations cannot consume cards or repeat score events. Save/reload must preserve the same outcome and tie decision.

## 5. Acceptance and open decisions

| Scenario | Required result |
| --- | --- |
| 60/40 verified share, two penalties on first player | Final scores 58/40; share and penalty remain separately inspectable. |
| Recompute, retry or reload final turn | One finalization and one copy of each penalty; no attraction accumulation. |
| Uplift / asymmetric supports | Correct signed reactions and declared policy; no forced positive 100% distribution. |
| Independent invalid component | Valid reactions scored against full applied gravity; unavailable contributions get zero game award, not fabricated zero forces; partial-evidence outcome labelled. |
| No loads / numerical failure | Distinct policy paths, no division by zero or false equal distribution. |
| Final pass / equal rounds | Exactly the configured number of turns per player before finalization. |
| Near tie / reordered players / display rounding | Versioned tolerance and same physical/policy outcome. |

Open: round/player presets, uplift/self-weight policy, physical repair catalogue/local bounds and budget, zero-load result, tie tolerance, concession/abandonment and any future deferred penalties. These must be resolved in a release ruleset, not hard-coded from recommendations. See [release acceptance](release-acceptance-criteria.md).
