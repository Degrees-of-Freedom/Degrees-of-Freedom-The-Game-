---
title: "AI Turn Lab"
last_validated: 2026-11-15
validated_against:
  - apps/web/src/game/aiLab.ts
  - apps/web/src/game/aiLab.test.ts
  - apps/web/src/pages/AiLab.tsx
  - apps/web/src/game/turns.ts
owner: unknown
status: partial
---

# AI turn lab

The experimental `/ai-lab` page supports human versus AI and stepped AI versus AI matches on the Shared table turn engine. It generates a limited set of one-step element moves from existing non-foundation joints, uses fixed connection cards when available, and optionally places a load. Every generated action goes through the existing staging functions; turns end unresolved without a structural solve. Passing is possible. The lab is separate from the 3D Shared table and does not persist models or matches.

Training simulates matches with reproducible exploratory choices and fits a six-feature linear reward predictor using online gradient descent. Its hand-authored proxy rewards connections, upward and diagonal geometry, ownership and loads; it is not an engineering assessment, verified safety, or the confirmed final scoring rule. Beginner, intermediate and advanced use the same learned weights with 80%, 35% and 5% random action selection respectively. They are exploration settings, not measured or guaranteed competitive skill levels. Training is in the browser and starts from zero weights; the user can retrain or reset it.

The generator does not enumerate all valid cards, lengths, directions or attachments, and the existing turn engine itself does not enforce every confirmed placement or joint rule. Future work should use verified solver-backed outcomes and final scoring, benchmark policies on held-out seeds, measure skill levels, expand legal-action coverage and integrate into the shared workspace only after those boundaries are resolved.
