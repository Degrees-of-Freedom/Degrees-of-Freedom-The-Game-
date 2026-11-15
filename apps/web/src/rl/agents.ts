import { GoalEnv } from "./goalEnv";
import { actionFeatures, kindBalancedPrior, stateContext } from "./features";
import { LinearSoftmaxPolicy } from "./policy";
import { createRandom, type Random } from "./rng";
import type { GoalAction, Observation, StepResult } from "./types";

/** Anything that can choose an action from the legal set. */
export interface Agent {
  act(obs: Observation, actions: readonly GoalAction[]): GoalAction;
}

/** Uniform random over the legal actions; the baseline to beat. */
export class RandomAgent implements Agent {
  constructor(private readonly random: Random = createRandom(0)) {}
  act(_obs: Observation, actions: readonly GoalAction[]): GoalAction {
    // Skip `finish` (index 0) so random play is not trivially cut short.
    return actions[1 + Math.floor(this.random() * (actions.length - 1))] ?? actions[0];
  }
}

/** Plays a trained policy, either greedily or by sampling. */
export class PolicyAgent implements Agent {
  constructor(
    private readonly policy: LinearSoftmaxPolicy,
    private readonly mode: "greedy" | "sample" = "greedy",
    private readonly random: Random = createRandom(0),
  ) {}
  act(obs: Observation, actions: readonly GoalAction[]): GoalAction {
    const ctx = stateContext(obs);
    const rows = actions.map((a) => actionFeatures(ctx, a));
    const prior = kindBalancedPrior(actions);
    const i =
      this.mode === "greedy"
        ? this.policy.greedy(rows, prior)
        : this.policy.sample(rows, this.random, prior);
    return actions[i];
  }
}

export interface EpisodeSummary {
  seed: number;
  steps: number;
  totalReward: number;
  solved: boolean;
  /** Cost units of the final structure. */
  cost: number;
  stars: number;
  invalidMoves: number;
}

/** Play one episode to completion. */
export function playEpisode(env: GoalEnv, agent: Agent, seed: number): EpisodeSummary {
  let obs = env.reset(seed);
  let totalReward = 0;
  let invalidMoves = 0;
  let result: StepResult | null = null;
  do {
    result = env.step(agent.act(obs, env.legalActions()));
    obs = result.observation;
    totalReward += result.reward;
    if (result.info.invalid) invalidMoves++;
  } while (!result.done && !result.truncated);
  return {
    seed,
    steps: obs.step,
    totalReward,
    solved: result.info.analysis.success,
    cost: result.info.analysis.cost,
    stars: result.info.analysis.stars,
    invalidMoves,
  };
}

export interface EvaluationSummary {
  episodes: number;
  successRate: number;
  meanReward: number;
  /** Mean cost of solved episodes; null when none were solved. */
  meanSolvedCost: number | null;
  meanSteps: number;
}

/** Evaluate an agent over seeds `firstSeed ... firstSeed + episodes - 1`. */
export function evaluate(
  env: GoalEnv,
  agent: Agent,
  episodes: number,
  firstSeed = 10_000,
): EvaluationSummary {
  const runs = Array.from({ length: episodes }, (_, i) => playEpisode(env, agent, firstSeed + i));
  const solved = runs.filter((r) => r.solved);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  return {
    episodes,
    successRate: solved.length / episodes,
    meanReward: mean(runs.map((r) => r.totalReward)),
    meanSolvedCost: solved.length ? mean(solved.map((r) => r.cost)) : null,
    meanSteps: mean(runs.map((r) => r.steps)),
  };
}
