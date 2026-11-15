---
title: "Agents and Reinforcement Learning for the Goal Mode"
last_validated: 2026-11-15
validated_against:
  - apps/web/src/rl
  - apps/web/src/rl/goalEnv.test.ts
  - apps/web/src/rl/trainer.test.ts
  - apps/web/src/rl/bridge.test.ts
  - apps/web/src/game/modes.ts
  - apps/web/src/game/levels.ts
  - apps/web/src/game/placementRules.ts
  - apps/web/src/game/layout.ts
  - apps/web/src/solver/voxel.ts
  - apps/web/src/solver/voxelObjectives.ts
  - package.json
owner: unknown
status: partial
---

# Agents and reinforcement learning for the goal mode

The goal-based mode is **Load in space** (`GameMode` `"load-space"`, level `pickup1`; see [unified runtime](unified-runtime.md)): weights hang in space and the player must connect every one to a foundation with a stable structure that passes the level's checks. `apps/web/src/rl` lets software agents play that mode headlessly and learn to meet its goal. It is a training and evaluation harness only. Nothing in the web UI uses it, and the game's rules and solver are unchanged.

Status: the environment, a learner, a bridge for external agents and tests are implemented. A trained agent solves the one-weight level reliably. Results on the three-weight level are recorded under [Measured results](#measured-results); the random layout is untested for learning.

## Why it reuses the game instead of reimplementing it

The environment calls the same functions the editor uses: `memberIssue` and `nodeItemIssue` (`game/placementRules.ts`) for what is legal, `initialModel` (`game/layout.ts`) for the level, and `analyzeVoxel` (`solver/voxel.ts`) for the structural result and objectives. An agent therefore cannot do anything a player could not, and "solved" means exactly what the game's `analysis.success` means. One analysis takes about 1 ms on this hardware, so no solver service is needed. The only change to game code is that `initialModel` and `randomLoads` accept an injectable random generator (default `Math.random`) so random levels can be seeded.

## Modules

| File | Role |
| --- | --- |
| `types.ts` | `GoalAction`, `Observation`, `StepResult`, `RewardConfig`, `GoalScenario`. |
| `scenarios.ts` | Scenario presets: `single`, `pickup1`, `pickupR`. |
| `actions.ts` | `applyAction` (rules check + apply) and `ActionEnumerator` (legal actions). |
| `goalEnv.ts` | `GoalEnv`: `reset(seed)`, `legalActions()`, `step(action)`. |
| `reward.ts`, `graph.ts` | Reward, potential function and the cheap connectivity it uses. |
| `features.ts` | Action features φ(s, a), state features, `kindBalancedPrior`. |
| `policy.ts`, `baseline.ts` | Linear softmax policy with validated JSON persistence; ridge value baseline. |
| `trainer.ts` | REINFORCE training loop. |
| `agents.ts` | `RandomAgent`, `PolicyAgent`, `playEpisode`, `evaluate`. |
| `schema.ts`, `bridge.ts` | zod-validated JSON-lines protocol for external agents. |
| `cli/train.ts`, `cli/serve.ts` | `npm run train:goal`, `npm run serve:goal`. |

## The environment

`GoalEnv` is Gym-like and deterministic for a seed. `reset(seed)` returns an `Observation`; `step(action)` returns `{ observation, reward, done, truncated, info }`. Stepping after the episode ends throws.

**Scenarios.** `pickup1` is the game's level. `single` is `pickup1` with only its first 40 kN weight (derived in `scenarios.ts`, not a game level). `pickupR` is the game's random pick-up level with weights drawn from the seed. Each scenario fixes a step cap and the member sections an agent may use (`shs`, `glulam`, `ipe`, plus `heb` for `pickupR`); level supply limits still apply.

**Actions.** Add-only, so episodes are finite: place a `foundation` on solid ground, add a `member` of an allowed section, add a `joint` (moment connection) at a node, or `finish` (give up). Members grow from an existing node (a weight, foundation or member end) along the 26 lattice directions at every length the section allows. A rejected action leaves the model unchanged, is penalised and still counts toward the step cap. The first step of `single` has 404 legal actions (169 foundations, 234 members, `finish`); a joint becomes legal once a member exists.

**Episode end.** `done` when `analysis.success` becomes true (the game's own completion test) or the agent finishes; `truncated` at the step cap.

**Finding that shapes the policy.** A bare column is a mechanism: a member end takes moment from a fixed foundation only if its node has a moment connection. In `single`, foundation under the weight, a member from foundation to weight and a joint at the base solve the level; the joint at the base is the step that turns the structure from a mechanism into one that passes every check (tests in `goalEnv.test.ts`).

## Reward

Per step: `shaping + terminal − stepPenalty − invalidPenalty` (`reward.ts`, defaults in `DEFAULT_REWARD`).

- **Shaping** is `Φ(s') − Φ(s)` with `Φ = 0.2·reach + 0.2·connected + 0.2·stable + 0.4·objectives·connected`, each term in [0, 1]. A potential difference telescopes, so shaping speeds learning without changing which policy is best; a test checks that the shaping over a solving episode sums to Φ(solved) − Φ(start) = 1.
- **reach** is how close the supported structure is to each unconnected weight (0 at 8 or more cells, 1 once connected). It is what lets an agent that has never connected anything still see progress.
- **objectives** is the fraction of the 8 objectives a solved pick-up level reports, scaled by `connected`. The scaling fixes a reward hole found while building this: the game's objectives pass vacuously when nothing is attached (a lone foundation already passes 6 of 7), which paid for a useless foundation. `PICKUP_OBJECTIVE_COUNT = 8` is pinned by a test against the real analysis.
- **terminal**: `+1` for solving plus `0.5 ×` the unspent share of the level budget (cheaper solutions score higher); `−0.25` for ending unsolved.
- **stepPenalty** 0.01; **invalidPenalty** 0.05.

## The learner

A linear softmax policy over a variable action set: `π(a|s) ∝ exp(w·φ(s,a) + prior(a))`, 23 action features (`ACTION_FEATURE_NAMES`). Features describe an action relative to the current structure (a foundation directly under an unconnected weight, a member connecting a supported end to a weight, a joint while the structure is a mechanism, section type, cost, direction). They do not depend on the scenario or on the number of weights, which is why a policy can be saved, validated (`StoredPolicySchema` rejects a different feature set) and applied elsewhere.

Training (`trainer.ts`) is REINFORCE: batches of whole episodes, discounted returns, a ridge-regression value baseline refit each batch, a small entropy bonus, plain gradient steps with a norm clip. Training seeds start at 1,000,000 and evaluation seeds at 10,000, so they never overlap.

These design choices were forced by experiments on `single`, and each is pinned or explained in the code:

- **Kind-balanced prior.** Without it the one joint that completes the structure competes with hundreds of member and foundation actions and is almost never tried. The prior gives foundation, member and joint equal initial mass; it is a constant offset, so it does not change the gradient. There are deliberately no learnable per-kind bias features: they drifted negative from noisy early samples and starved the joint.
- **State × action features** (`memberWhileMechanism`, `jointOnSupportedWhileMechanism`, …) because a linear scorer cannot otherwise express "this only matters while the structure is a mechanism".
- **No advantage or step normalisation, and not Adam.** Both turn a batch that saw no success into a full-size step along noise, which random-walked the rarely sampled weights. Raw advantages with plain steps went from about 1–2 of 8 seeds learning at 480 episodes to 5 of 8, and 7 of 8 at 960.

## Using it

Install with `npm install`, then:

```bash
npm run train:goal -- --scenario single --episodes 960 --seed 1
```

It prints batch metrics with a periodic greedy evaluation, evaluates random, final and best-checkpoint policies on held-out seeds and writes `rl-runs/<scenario>-seed<N>/` (`policy.json` = best checkpoint, `policy-final.json`, `history.csv`, `evaluation.json`; `rl-runs/` is gitignored). Options: `--scenario`, `--episodes`, `--batch`, `--lr`, `--seed`, `--eval`, `--check-every`, `--init <policy.json>` (warm start), `--out`.

For an agent in another language, `npm run serve:goal` speaks JSON lines on stdin/stdout (`bridge.ts`, validated by `schema.ts`). Methods:

| Request | Meaning |
| --- | --- |
| `{"method":"reset","params":{"scenario":"single","seed":0,"features":true}}` | Start an episode; returns the observation, the legal `actions`, and with `features` one numeric row per action plus `featureNames` and a log `prior`. |
| `{"method":"step","params":{"actionIndex":3}}` or `{"params":{"action":{…}}}` | Play an action from the last list, or an explicit one (still rule-checked). Returns `reward`, `done`, `truncated`, `info` and the next legal actions. |
| `{"method":"actions"}` | Re-list the current legal actions. |

Errors come back as `{"ok":false,"error":"…"}`; an optional `id` is echoed. A Python RL library can train against this directly, using the feature rows or building its own observation from the model.

## Measured results

All numbers are from this branch on one machine and are not a benchmark.

- `single`, random uniform agent: 0% solved. Trained policy, greedy: 100% solved on held-out seeds, in 3 steps at cost 660 (my hand-built solution costs 740). Over 8 training seeds at 960 episodes, 7 reached a solving greedy policy.
- Training takes about 35 s for 400 episodes on `single`.
- A policy trained on `single` does not transfer zero-shot to `pickup1`: it keeps building and spends 6,120 against a 3,000 budget without solving.

Three-weight (`pickup1`) results: see the section added when those runs finished, below.

## Limitations and open questions

- **The policy is useful greedily, not as a sampler.** Sampled training episodes almost never solve the level (entropy stays around 6.7 nats, close to a uniform choice over the legal actions) because learning is driven by the shaping signal; the argmax is correct while the distribution stays flat. Greedy performance can also fluctuate late in training, which is why the CLI keeps the best checkpoint.
- **A linear scorer over hand-written features** is a first learner, not a ceiling. Features encode domain knowledge (support, mechanism, proximity to a weight), so this tests that the environment is learnable and the reward sound, more than it shows general structural design skill.
- **Add-only actions.** The agent cannot remove or swap pieces, unlike the editor.
- **Generalisation across layouts and larger levels** (`pickupR`, taller weights needing chained members and several joints) is untested. Episode time grows with the number of nodes because every candidate action is enumerated and scored.
- The reward weights, step caps and per-scenario section lists are choices made here, not project decisions.
- The shaped reward is policy-invariant only for the undiscounted objective; the trainer discounts at 0.99, which is a small departure.
