# Load-path primary-direction implementation prompt

Copy the prompt below into a Codex/Claude session. This file is an implementation brief, not executed work.

```text
Update the load-path visualization in Degrees of Freedom.

Read AGENTS.md, docs/kb/README.md and docs/kb/visualization-criteria.md, especially section 7. Inspect current main and preserve its integrated UI/solver work. Work on an isolated feature branch; do not deploy or push/merge main without a separate instruction.

Animate vectors along each displayed member/segment in the primary direction that applied load is transferred through the structure, from the load toward receiving supports or recorded safety restraints.

Remove the former tension-centre-out/compression-centre-in split animation. Keep tension and compression as separate colour/labels based on calculated axial force; axial sign alone does not determine load-transfer direction.

Use a documented interpretation of actual solver results and intentional connectivity. Preserve valid branches and redistribution. Do not simply point all arrows downward, infer direction from ownership/displacement, or claim a unique exact route where the analysis cannot support one. For ambiguous combined loads, say so or offer a supported selected-load view; never fabricate attribution.

Keep arrows aligned to their displayed segment and result scope. Use valid per-segment data where quarter/subdivision results differ. Slack cables, zero displayed action and unavailable results have no moving flow. Do not suppress a valid shear/bending path merely because axial force is zero. Label force quantity, magnitude scale, source/result/model provenance and historical/stale results accurately.

Support static directional arrows under reduced motion. Keep physical member thickness separate from flow magnitude. This is explanatory static load transfer, not actual material movement or displacement. Do not change solver scheduling, card rules, model geometry or scoring to produce the animation.

Test simple source-to-support, branched/asymmetric, tension/compression, shear/bending, mixed/ambiguous load, camera/member orientation, slack/zero/unknown, segment and stale-result cases. Inspect the actual browser rendering where available, run meaningful focused tests and relevant typecheck/build checks, and record observed evidence/limitations. Update the relevant knowledge-base implementation notes and commit a reviewable result. Do not claim visual agreement proves numerical correctness.
```
