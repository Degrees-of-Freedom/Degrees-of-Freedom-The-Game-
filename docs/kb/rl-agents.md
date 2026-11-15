---
title: "Agents and Reinforcement Learning for the Goal Mode"
last_validated: 2026-11-15
validated_against:
  - apps/web/src/rl
  - apps/web/src/rl/goalEnv.test.ts
  - apps/web/src/rl/trainer.test.ts
  - apps/web/src/rl/bridge.test.ts
  - apps/web/src/rl/planning
  - apps/web/src/rl/stages.test.ts
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

Status: the environment (including keep-out zones and a delayed second stage), a learner, two planners, a bridge for external agents and tests are implemented. A trained agent solves the one-weight level reliably. On the game's three-weight level it solves it only when seeded with scripted demonstrations (see [Measured results](#measured-results)); the random layout is untested for learning.

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
| `zones.ts` | Keep-out zone geometry (scenario rule, not a game rule). |
| `demonstrations.ts` | Scripted and planner demonstrations for the imitation term; `trainer.ts` also has `imitate` and `demonstrationAccuracy`, which test what the features can express. |
| `planning/` | Planners that solve scenarios without learning: `graphPlanner.ts`, `erosionPlanner.ts`, `portfolioPlanner.ts` (best of both), shared `common.ts`, runner `run.ts`. |
| `lookahead.ts` | Features of the structure an action would produce (simulated with the game's analysis); tested, not used in training. |
| `cli/train.ts`, `cli/serve.ts`, `cli/compare.ts` | `npm run train:goal`, `serve:goal`, `compare:goal`. |

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

A linear softmax policy over a variable action set: `π(a|s) ∝ exp(w·φ(s,a) + prior(a))`, 24 action features (`ACTION_FEATURE_NAMES`). Features describe an action relative to the current structure (a foundation directly under an unconnected weight, a member connecting a supported end to a weight, a joint while the structure is a mechanism, section type, cost, direction). They do not depend on the scenario or on the number of weights, which is why a policy can be saved, validated (`StoredPolicySchema` rejects a different feature set) and applied elsewhere.

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

Three-weight (`pickup1`) is **solved only with demonstrations**. Without them, three rounds (each one from-scratch and one to three warm-started runs, 20 held-out episodes each) all solved 0% (random also 0%):

1. 640 episodes: the policy placed all four foundations early, built diagonals that stayed mechanisms and exhausted supply.
2. After adding `foundationRedundant` (1,200 episodes, 3 warm-start seeds + 1 from scratch): the agents connect all three weights in 5 steps for about 1,340, but never add the joints, so the structure stays a mechanism.
3. After grading the stability reward by the share of unstable nodes (same setup): still 0%. The final policy has every joint feature negative (for example `jointOnSupportedWhileMechanism` −0.3, `jointAtWeight` −1.1) and `memberWhileMechanism` +0.9, so it keeps adding members. Warm-starting from the `single` policy, which had joint weights positive, did not preserve them.
4. With 20 scripted demonstrations imitated alongside the policy gradient (`--demos 20`), 800 episodes, four seeds (two at `--demo-weight 1`, two at 3): **all four greedy policies solve 100% of 20 held-out episodes**, first reaching it at episode 64 to 224, at cost 1,980 each. The first checks that were solved had the stability reward graded and the loaded-base joint feature (items 2 and 3 of the plan above) in place.

**Caveat: this is largely imitation.** The cost of 1,980 is exactly the demonstrator's solution (a glulam column and base joint under each weight), `pickup1` has fixed weights, and I did not run an ablation separating the imitation term from the policy gradient. It shows the environment, features and reward can express and hold a full solution, not that reinforcement learning discovered it. Not tested: a different weight layout (the demonstrator cannot reach `pickupR` weights above 3 cells), cheaper-than-demonstrator solutions, and imitation turned off after pretraining.

The level itself is solvable with the same actions: a foundation, a glulam column and a base joint under each weight, 9 steps, cost 1,980 (checked in the environment). Diagnosis before the demonstrations (consistent with round 4, not proven): success is never seen while sampling, so the only joint signal is shaping, and with about ten candidate nodes only one or two joints are right at any time, so the average joint looks harmful and its weights drift negative. Next experiments: an ablation with the imitation weight annealed to zero; held-out layouts (needs a demonstrator or generator for taller weights); a two-weight curriculum scenario.


## Multi-part goals, keep-out zones and planners

Scenarios can now set `zones` (boxes no member or node may touch) and `laterStages` (weights that appear after N actions). A `wait` action is offered only while a stage is pending. The episode is solved only once every stage has arrived and the whole structure passes. Holding a solved stage when the next arrives earns `stageBonus` (0.5), and the drop in progress from a new weight is not charged to the action taken. Zones and stages are agent-scenario rules; the game's editor has neither. My reading of "hold, wait, avoid zones" is this staged goal plus zones; it is an interpretation, not a project decision.

| Scenario | Goal |
| --- | --- |
| `zoned` | `pickup1` with a zone under the second weight; larger supply (10 joints, 10 glulam, 5 foundations). |
| `staged` | One weight, then a second appears after 5 actions. |
| `holdAvoid` | Staged and the zone together, with `pickup1`'s supply. |

Two corrections made while building these, both found by checking feasibility rather than assuming it: a wider first zone could only be solved with HEB sections, of which `pickup1` has none; and the detour around the narrower zone needs a portal (a column each side of the weight, five moment connections), so with six joints `zoned` cannot be solved at all, which is why it has the larger supply.

**Graph planner** (`planning/graphPlanner.ts`). Dijkstra over lattice members priced at section cost, half a joint and squared length (slender members buckle: without the length term it picked one long diagonal that failed). Weights are connected one at a time, later ones branching off earlier structure; shared trees and independent columns are both searched, every weight order for up to four weights, glulam and IPE bases. Repair is a beam search over three moves scored by the game's own objectives: the moment connection that frees the most nodes, upgrading the worst overloaded section, or adding a second leg to a weight. Shared trees of horizontal cantilevers were cheapest but left mechanisms no joint fixed, which is why independent columns are searched too, and upgrading before reinforcing spoiled the portal, which is why repair is a beam search rather than a fixed order.

**Erosion planner** (`planning/erosionPlanner.ts`). Evolutionary structural optimisation: start from every legal short member around the weights with a joint at every node and a foundation at every ground node, then remove the least-utilised members (the solver's utilisation) in batches that shrink after a failure, then joints, foundations, and downgrade sections, accepting each step only if the game's analysis still passes. Two things were needed to make it work: removing a member must also remove what it was holding up (the game counts a jointed node with no member as a floating part, so one-at-a-time removal stalled in a heavy local minimum), and the starting structure had to be thin (long members only along axes) or one analysis took about 2 s and a run took over ten minutes; an explicit analysis budget now bounds every run.

**Planner results** (`npm run compare:goal`; each solved in the environment with zero rejected moves unless noted; one machine, not a benchmark):

| Scenario | Graph | Erosion |
| --- | --- | --- |
| `single` | solved, cost 660 | solved, cost 660 |
| `pickup1` | solved, 1,980 (13 s) | solved, 1,980 (11 s) |
| `staged` | solved, 1,320 | solved, 1,320 |
| `zoned` | solved, 4,000 (19 s) | solved, 3,240 (9 s) |
| `holdAvoid` | solved, 3,420 | **not solved** |

Erosion is cheaper where it works but ignores the level's supply while eroding; on `holdAvoid` its local optimum needs seven moment connections and the level has six, so it is reported unsolved. The graph planner checks supply as it builds. Neither planner is optimal: both are heuristics checked only against the game's analysis.

**Learner on the new scenarios** (600 episodes, seed 1, one planner demonstration (graph) imitated alongside the policy gradient, 10 held-out episodes):

| Scenario | With planner demonstration | Without |
| --- | --- | --- |
| `staged` | **100% solved, cost 1,320** (equal to the planner's) | 0% (mean reward 0.16) |
| `holdAvoid` | 0% (mean reward 1.23) | not run |
| `zoned` | 0% (mean reward 0.41) | not run |

So the multi-stage hold-wait-extend behaviour is learnable from one planner demonstration and not from reward alone, but as with `pickup1` this is imitation of one fixed layout.

**Follow-up: more seeds, longer training, unseen layouts.** None of it solved the zoned scenarios.

- `zoned` and `holdAvoid`: 2 seeds each, 1,000 episodes, imitation weight 4 (up from 2). All four runs solved 0%, the same as the single-seed runs; mean reward did not improve (`holdAvoid` 1.23, `zoned` 0.41, both unchanged).
- Random layouts (`stagedR`: weights, later stage and zone drawn from the seed, both weights 3 cells up). The graph planner solves 16 of 16 held-out layouts, mean cost 3,303 (a first version that also varied height and load solved only 4 of 12, mostly because a weight 2 cells up has a much tighter movement limit, so it was replaced). Agents trained for 800 episodes on demonstrations from 24 planner-solved layouts (2 seeds), and one with no demonstrations, solved 0% of 20 held-out layouts (mean reward about 1.2 with demonstrations, 0.7 without). So generalisation to unseen layouts is **not** shown.

**Why: the linear features cannot express these solutions.** `imitate` fits a policy by maximum likelihood to the planner's decisions alone, with no environment and no reward; `demonstrationAccuracy` then counts exact matches. With the current 24 features:

| Scenario | Planner decisions reproduced |
| --- | --- |
| `single` | 3 of 3 |
| `staged` | 8 of 8 (tested) |
| `pickup1` | 8 of 9 |
| `holdAvoid` | 12 of 19 |
| `zoned` | 9 of 19 |

If a policy trained only to copy the planner cannot reproduce it, more reinforcement learning with the same features cannot find it, which matches the 0% results. Some mismatches are harmless ties (which of two needed joints goes first), but the member choices are not: the planner's `holdAvoid` second stage is an irregular tripod of 2-cell columns and short diagonals around the zone, and the policy keeps choosing a single long diagonal. Adding geometric features aimed at it (a foundation one cell from a weight, a foundation mirrored through a weight from an existing one, horizontal/vertical member flags, a member level with a weight) did not change the picture (`zoned` 10 of 19) and was reverted.

**Three follow-ups to that diagnosis** (all tested offline against the graph planner's decisions; the scripts are not kept in the repo):

1. *Look-ahead features* (`lookahead.ts`: simulate each candidate with the game's analysis and describe the result: potential gained, unstable share dropped, objectives gained, connections gained, whether it solves, cost). `holdAvoid` 12 → 14 of 19 decisions reproduced.
2. *A non-linear scorer* (one hidden layer of 16 or 32 tanh units). No gain over the linear scorer on its own.
3. *An aliasing count.* On `zoned`, 15 of 19 demonstrated moves have another legal candidate with an identical feature vector (11 of 19 on `holdAvoid`, none on `single` or `staged`), so no scorer on those features can separate them. Position features (offsets of each end from the nearest unconnected weight, member direction) cut it to 8 of 19 and 4 of 19. With look-ahead and position features together, linear, 16-unit and 32-unit scorers all reproduced exactly the same 12 of 19 (`holdAvoid`) and 9 of 19 (`zoned`).

Identical counts across scorer sizes mean capacity is not the limit, but the test cannot say whether the rest is optimisation (my fitting loop may stall: the kind-balanced prior puts hundreds of member candidates about 7 nats down), ties no feature can break, or both. Position features were not added to the trained policy and the agent was not retrained with look-ahead or an MLP, because the offline fit showed no gain to justify it. `lookahead.ts` is committed and tested but unused by training.

**Choosing among whole proposals worked.** `PortfolioPlanner` asks the graph and erosion planners for complete plans and keeps the best by the plan as a whole (solved, then cheapest). On the 16 random staged-and-zoned layouts (seeds 10,000 to 10,015):

| | Solved | Mean cost (solved) | Mean planning time |
| --- | --- | --- | --- |
| Graph | 16 | 3,303 | 3.8 s |
| Erosion | 13 | 2,968 | 13.8 s |
| Best of both | 16 | 3,005 | about 17.6 s |

That is 9% cheaper than graph alone at about 4.6 times the planning time. It is not a learned policy: the choice is an argmin over plans the game's analysis has already verified. A learned selector could only save time by predicting which planner will win; none was built. So the position this leaves is: the move-by-move RL agent solves `single`, `staged` and `pickup1` (with demonstrations for the last two) but not the zoned scenarios or unseen layouts, while search-based planners solve all of them, and the better of two is cheaper than either's worst case.

## Limitations and open questions

- **The policy is useful greedily, not as a sampler.** Sampled training episodes almost never solve the level (entropy stays around 6.7 nats, close to a uniform choice over the legal actions) because learning is driven by the shaping signal; the argmax is correct while the distribution stays flat. Greedy performance can also fluctuate late in training, which is why the CLI keeps the best checkpoint.
- **A linear scorer over hand-written features** is a first learner, not a ceiling. Features encode domain knowledge (support, mechanism, proximity to a weight), so this tests that the environment is learnable and the reward sound, more than it shows general structural design skill.
- **Add-only actions.** The agent cannot remove or swap pieces, unlike the editor.
- **Generalisation across layouts and larger levels** (`pickupR`, taller weights needing chained members and several joints) is untested. Episode time grows with the number of nodes because every candidate action is enumerated and scored.
- The reward weights, step caps and per-scenario section lists are choices made here, not project decisions.
- The shaped reward is policy-invariant only for the undiscounted objective; the trainer discounts at 0.99, which is a small departure.
