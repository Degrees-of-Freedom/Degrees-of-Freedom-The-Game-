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

The owner confirmed: **keep the player’s move, apply a clearly recorded game-owned repair for both instability and member/connection overload, and have Timburr explain what went wrong and what was changed.** Neutral scaffolding/ground anchors are permitted, unscored for players and permanent for the match, with local direct intervention as defined in section 7. This supersedes the earlier player-card-only repair proposal. The applicable once-per-turn -1 penalty remains historical after repair. Player additions may also repair issues; standard play does not automatically collapse/remove player structures. These are target rules, not implemented automatic correction or verified issue comparison.

A reported strength exceedance, instability or disconnected region is a condition to explain and repair. It does not automatically break/remove a player member, degrade its stiffness, release its connector, delete a load, rewrite its reference geometry or end the match. The system adds explicitly defined repair objects instead of silently changing the original card’s mechanical properties. New loads remain governed by existing card rules, not a repair-only editing privilege. Placed connectors stay immutable. Permanent damage, dynamic collapse and destructive repair actions are outside the standard mode; a future variant needs separate explicit rules and validated analysis.

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

**Confirmed:** historical penalties remain after repair. Clear a verified resolved issue from active warnings but preserve the original -1 event; never refund or deduct it again merely because the result was reloaded/recomputed. Repair assessment compares the complete new committed model with the previous baseline; a provisional brace in preview must not clear a committed warning or trigger a penalty. A beneficial move can still introduce another issue elsewhere, which is reported independently.

Show a repair/change report with “Resolved”, “Improved but still present”, “Unchanged”, “New/worsened” and “Not verified”, including affected object labels and optional safe focus actions. Resolved issues leave the active warning list and remain in history. The structure continues normally in play; an issue warning is not a disabled element or a game-over state. Keep analysis validity separate: retained geometry in an unstable component does not magically provide authoritative reactions.

The owner authorizes game-owned automatic correction for both instability and overload. The owner permits neutral system scaffolding/ground anchors as a system-only exception to setup-only player foundations. Its reactions earn no player attraction points, total applied gravity stays the scoring denominator, and accepted repairs remain permanently for the rest of the match. The direct repair must be local to the affected element/connection; this is interpreted as local intervention, not a guarantee of zero indirect force redistribution or first-order-only analysis. Repair objects must be explicit, physically modeled and compatible with joint/clash rules. Player-facing repair suggestions can supplement the automatic correction, such as adding a brace to improve the player-built structure. Such additions do not retire the permanent system repair. Do not claim a specific card guarantees repair without verified analysis. Timburr may acknowledge improvement; Conkeldurr requires a compatible verified serious-event source and cooldown, never a guessed issue/penalty count.

## 5. Acceptance and open policy

| Scenario | Required result |
| --- | --- |
| One turn affects many members/modes | One eligible -1 event with all reasons; structure retained. |
| Same issue next turn / tiny utilization jitter | No repeated penalty without a configured verified worsening transition. |
| Verified repair / partial improvement / unresolved retry | Accurate distinct status; active resolved marker clears, no automatic removal or false safety. |
| Repair harms another region | Report both improvement and eligible adverse change; aggregate per turn. |
| Component merge/split / mode basis change | Stable physical attribution, no spurious new issue from renaming. |
| Reload/replay/retry / historical review | Same ledger, no duplicated deductions, refunds on repair or animation-created consequences. |

Open: exact eligible categories (including attribution for later issues on system objects), worsening/hysteresis values, deferred verification, repair catalogue/bounds, numerical locality/clearance parameters and target permissions on system objects. Neutral ownership/no player attraction award and permanent in-match repair lifetime are confirmed. Automatic game-owned correction of instability and overload, with historical penalties retained, is confirmed. Permanent failure/repair variants require separate approval; they are not hidden behind a renderer's break animation.

## 6. Automatic correction transaction

The following workflow is proposed to implement the confirmed automatic-repair rule:

1. Freeze and validate the player's complete move against the parent model/card state. Invalid geometry, clashes or card actions stay in planning; they are not “repaired” into a different legal move behind the player's back.
2. Analyze the candidate including previously committed game-owned objects. Preserve pre-correction evidence and compare it with the compatible prior baseline. Determine any verified eligible new/worsened issue and its one-turn penalty **before** automatic correction masks it.
3. Retain the player's placed objects and cards. Select a bounded deterministic correction from a versioned repair catalogue, recording affected region, reason, object/connection IDs, resolved properties, provenance and policy version. System objects do not consume player cards or 1/1/2 play allowances and are never represented as a player secretly spending extra cards.
4. Reanalyze the complete physical candidate with the proposed repair, checking instability, member/connection overload, equilibrium, compatibility and valid component scope. A stable matrix alone does not establish capacity safety. Check for new issues elsewhere, repair-object overload, reference clashes and invalid connections.
5. Accept only a verified correction. Commit the move, original evidence/comparison/penalty, repair objects, post-correction result and turn advancement as one recoverable logical transaction. Log every attempted/accepted correction in bounded diagnostic form; do not replay it on reload.
6. Timburr explains the affected object and cause, identifies the game-owned repair and its scoring effect, and distinguishes **verified repaired**, **still pending** and **could not verify**. Normal game/result panels expose the same facts without relying on avatar motion or audio. Keep player geometry visible; do not imply the program undid the move.

Repair constraints are substantive physics, not artificial numerical stabilization. Every added prop, brace, spring or ground restraint must correspond to a declared physical game object with explicit load path, stiffness/capacity, geometry, joint law and reaction validity. Existing player connections remain immutable; incoming system attachments must respect the common freedom states and axes, while allowed elastic stiffnesses may differ. No hidden large-stiffness springs, automatic reaction renormalization, fictitious supports, ignored gravity or load deletion counts as a repair.

Use deterministic candidate ordering, stable IDs and finite load/geometry/property limits. Configure maximum attempts, solver budget, allowed repair families, attachment locations, clearances and rule exceptions. Preflight the supported match catalogue so ordinary legal play can be corrected for both instability and overload. Validate representative and worst-case combinations; do not equate a design goal with a mathematical guarantee for arbitrary input.

If no permitted correction is physically feasible or verifiable within the budget, retain the move and explicit pending/unverified scope without asserting success. Preserve valid unrelated results and attempt the configured bounded recovery. The owner-confirmed final fallback awards attraction only from verified components; unknown forces remain unavailable. The solver must handle/diagnose every input, but it cannot produce a stable equilibrium for an unaltered physical mechanism by promising to “resolve everything.” This fallback remains necessary for robust software even with automatic correction as the ordinary path.

Required future fixtures: new instability repaired by a real added load path; overload corrected without deleting weight or altering the printed player section; a repair causing another-region overload rejected/revised; incompatible system joint law/clash rejected; correction budget exhausted with truthful scope; penalty preserved even after successful correction; retry/crash/reload creates no duplicated repair/card/penalty; avatar-off/muted/reduced-motion view exposes the same repair explanation. The neutral no-player-award/permanent lifetime and local-intervention requirements in section 7 apply to every accepted correction; actual physical catalogue definitions remain to validate.

## 7. Permanent neutral repairs with local intervention

**Confirmed:** automatic repairs may add neutral safety scaffolding or ground anchors; these are game-owned, not another player foundation or a playable card. Ground support is an explicit system-only exception to the setup-only player-foundation rule; it is not additional neutral ownership for a player foundation. No player earns attraction from neutral support reactions; include all applied gravity in the same denominator. Once accepted, repair objects and their physical effects remain for the rest of the match, including after player-built reinforcement. Save/reload, a later safe result, view changes and replay do not retire them. A new match starts under its own setup and does not inherit old repairs.

The owner requires the fix to affect the local element/connection at first order. **Interpretation used in this specification:** restrict the direct intervention and player-object contact to the flagged element and its incident end/quarter interfaces; never silently edit neighboring player elements, change another joint's laws or tie unrelated frame regions together. This is a locality rule for repair placement, not a request to use only linear first-order analysis, and not an assertion that structural influence outside that location is exactly zero. Forces, displacements, modes and player foundation reactions may redistribute globally through the shared structure; recompute and show those genuine consequences.

Proposed local scope records the issue's stable member/assembly/interface IDs, the eligible endpoint/original-quarter ports and the declared neutral-ground load path. Neutral props may extend from those local contacts to real permitted ground anchors; this does not authorize additional contacts with unrelated player structures. Define local spatial/clearance limits and anchor placement constraints in the repair catalogue. An assembly is not a loophole to rewrite all constituent geometry; target the affected part/interface under its parent mapping. Every added object still needs real geometry, finite physical properties/capacities, valid connection laws and reference-clash clearance.

Choose bounded deterministic local candidates. Proposed priority: avoid player-definition/connection edits; limit player-contact scope; use the smallest adequate approved repair topology; then minimize unnecessary geometric intrusion, with a deterministic final tie-break. Do not optimize for a player's score, create hidden rigid links, attach supports to empty space or quietly expand the fix to unrelated frame regions when a local candidate fails. If no allowed local repair can be verified, retain explicit unresolved scope and use bounded recovery/final scoring fallback rather than claim locality or stability falsely.

Neutral repair objects have stable IDs, explicit neutral/system ownership, triggering turn/issue IDs, catalogue/policy versions, permanent lifetime and individually valid force/capacity/reaction data. They are visually distinguishable and inspectable. They are not player-editable or removable. Whether players may attach new cards/loads to them requires an explicit target policy before release; neutrality alone grants no ownership or scoring rights. Historical penalties remain even when the correction succeeds. New corrective objects do not count as a player spending extra cards or gaining extra turn actions.

Verify the whole post-repair structure for equilibrium, instability and overload, including neutral objects and unrelated affected regions. Record before/after reactions and new validity, not a fabricated claim of “no global effect.” A numerically resolved structure may have player attraction below 100% because the neutral scaffolding genuinely carries some gravity. Show this as **neutral support share**, separately from **unverified/unawarded scope**. Include neutral reactions in physical force/moment balance, while excluding them from every player's attraction numerator.

Timburr explains, for example: “This connection left the member unstable. I added a permanent neutral prop here. It carries some load, earns nobody points, and your turn's penalty stays.” The explanation must match verified evidence and identify the actual local object/contact; if correction is pending, say so. The regular issue/result/score panels expose the same information when the avatar is hidden, muted or reduced-motion.

Acceptance fixtures must show: a local correction without changing unrelated player definitions; real global force redistribution reported honestly; correctly modeled neutral ground reactions and unchanged scoring denominator; a verified overload correction preserving original player properties/loads; a repair remaining after later reinforcement and reload; no scoring credit or retirement through reordering/replay; and a failed local candidate remaining explicit rather than becoming a hidden nonlocal fix. This is future design/validation work, not existing solver support.
