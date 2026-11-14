---
title: "Failure, Issue Assessment and Repair Criteria"
last_validated: 2026-11-14
validated_against:
  - "Project owner completion-criteria request and follow-up decisions, 2026-11-14"
  - docs/kb/turn-criteria.md
  - docs/kb/solver-criteria.md
  - docs/kb/scoring-match-criteria.md
  - docs/kb/placement-criteria.md
  - docs/kb/avatar-criteria.md
owner: project owner
status: needs-review
---

# Failure, Issue Assessment and Repair Criteria

## 1. Confirmed base-game policy

The owner chose **retain the structure, report verified issues and apply the existing eligible -1 turn penalty; repair by adding elements/connections**. Repairs must be clearly noted, and the structure continues in play without automatic collapse/failure removal. This is a target policy, not implemented verified issue comparison.

A reported strength exceedance, instability or disconnected region is a condition to explain and repair. It does not automatically break a member, degrade stiffness, release a connector, remove a load, alter reference geometry or end the match. New loads remain governed by existing card rules, not a repair-only editing privilege. Placed connectors stay immutable. Permanent damage, dynamic collapse and destructive repair actions are outside the standard mode; a future variant needs separate explicit rules and validated analysis.

## 2. Issue evidence and eligibility

Each issue records stable ID/category, affected objects/component lineage, prior/current model/result/version, physical fidelity/validity, severity or utilization where available, governing limit state, comparison status and reason. Mark new, persistent, worsened, resolved and unknown separately. Identify remote effects on other players' pieces, not just the newly played card.

Proposed initial penalty-eligible categories: verified structural instability and member/connection capacity exceedance. Eligibility for unsupported/disconnected geometry, near-mechanisms or excessive deformation must be explicitly approved; do not expand the confirmed generic issue penalty by inventing new categories. Ordinary slack, uplift, illegal input, rejected placement, timeout, nonconvergence and unavailable evidence are not automatically penalized.

Strength and instability are different findings. A mechanism does not provide a valid force/utilization field merely because a regularized solve returns numbers. An unloaded mechanism can still be unstable. Compare only compatible verified scopes/options; unknown prior results cannot establish that a region was previously issue-free. Preserve results for unrelated stable components.

## 3. New, worsened and resolved

| Comparison | Required interpretation |
| --- | --- |
| New | Verified eligible issue in a previously comparable verified issue-free region, or verified issue on a newly introduced object with appropriate baseline semantics. |
| Persistent | Same comparable condition without an approved worsening threshold crossing; no repeated deduction. |
| Worsened | Comparable verified issue crosses a versioned severity/limit-state threshold. Raw numerical jitter or changed mode basis is insufficient. |
| Resolved | Current compatible verified evidence establishes the issue absent in its relevant scope. |
| Unknown | Missing/incompatible/unverified evidence prevents the comparison; no assumed repair or physical penalty. |

Define force/moment/deformation scales, absolute/relative tolerances and hysteresis in policy. For capacity checks use recognized governing interactions and utilization, not arbitrary named-capacity comparison. A proposed threshold template uses entry/exit tolerances around utilization 1 and separate configured worsening tiers; actual values require fixtures and owner review. Do not infer a new event merely from eigenvector sign, reordering, a new ID for the same physical region, or component merge/split. Track lineage and compare physical subspaces/conditions where appropriate.

An unresolved solver retry is not evidence of worsening. Deferred issue attribution/deductions after later verification are proposed disabled for the initial ruleset unless approved: retain the originating pending evidence and do not penalize the next player for an unverified earlier event. Any later policy must attribute explicitly to the originating turn and remain idempotent.

## 4. Penalty ledger and repair presentation

Confirmed aggregation is one -1 event per turn containing at least one verified new/worsened eligible issue, independent of affected object/mode count. Record all issue reasons under that one event, actor, turn/model/policy version and stable idempotency key. Repeated analysis, reload or replay cannot deduct again. The final score subtracts the accumulated ledger under [scoring criteria](scoring-match-criteria.md).

Historical-penalty refund on repair is awaiting an explicit owner choice. Until resolved, do not silently refund or duplicate earlier deductions. Repair assessment compares the complete new committed model with the previous baseline; a provisional brace in preview must not clear a committed warning or trigger a penalty. A beneficial move can still introduce another issue elsewhere, which is reported independently.

Show a repair/change report with “Resolved”, “Improved but still present”, “Unchanged”, “New/worsened” and “Not verified”, including affected object labels and optional safe focus actions. Resolved issues leave the active warning list and remain in history. The structure continues normally in play; an issue warning is not a disabled element or a game-over state. Keep analysis validity separate: retained geometry in an unstable component does not magically provide authoritative reactions.

Offer suggestions as suggestions, such as inspecting missing attachments or adding a brace. Do not claim a specific card guarantees repair without verified analysis. Timburr may acknowledge improvement; Conkeldurr requires a compatible verified serious-event source and cooldown, never a guessed issue/penalty count.

## 5. Acceptance and open policy

| Scenario | Required result |
| --- | --- |
| One turn affects many members/modes | One eligible -1 event with all reasons; structure retained. |
| Same issue next turn / tiny utilization jitter | No repeated penalty without a configured verified worsening transition. |
| Verified repair / partial improvement / unresolved retry | Accurate distinct status; active resolved marker clears, no automatic removal or false safety. |
| Repair harms another region | Report both improvement and eligible adverse change; aggregate per turn. |
| Component merge/split / mode basis change | Stable physical attribution, no spurious new issue from renaming. |
| Reload/replay/retry / historical review | Same ledger, no duplicated deductions or animation-created consequences. |

Open: exact eligible categories, worsening/hysteresis values, historical-penalty handling, deferred verification and repair suggestions. Permanent failure/repair variants require separate approval; they are not hidden behind a renderer's break animation.
