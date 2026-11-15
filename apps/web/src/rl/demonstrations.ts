import { actionId } from "./actions";
import { actionFeatures, kindBalancedPrior, stateContext } from "./features";
import { GoalEnv } from "./goalEnv";
import type { Planner } from "./planning/common";
import { runPlanner } from "./planning/run";
import { createRandom, type Random } from "./rng";
import type { GoalAction, Observation } from "./types";

/**
 * One decision of a scripted solution, kept in the form the learner needs: the
 * features and prior of every legal action and the index that was chosen.
 */
export interface DemonstrationStep {
  rows: Float64Array[];
  prior: Float64Array;
  chosen: number;
}

/** Glulam columns solve every pick-up level checked; IPE ones miss an objective with three weights. */
const COLUMN_TYPES = ["glulam"] as const;

/**
 * Actions of a known solution: for each weight, in random order, a foundation
 * straight below it, a column up to it, and a moment connection at the base
 * (the column is a mechanism without one). Works when every weight is within
 * one member's reach of the ground; throws otherwise, rather than demonstrate
 * something that does not solve the level.
 */
export function scriptedSolution(obs: Observation, random: Random): GoalAction[] {
  const maxRise = 3; // the longest vertical reach of the allowed sections
  const weights = [...obs.targets];
  for (let i = weights.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [weights[i], weights[j]] = [weights[j], weights[i]];
  }
  const type = COLUMN_TYPES[Math.floor(random() * COLUMN_TYPES.length)];
  return weights.flatMap(({ at }) => {
    if (at[2] < 1 || at[2] > maxRise)
      throw new Error(`No scripted column reaches a weight at height ${at[2]}`);
    const base: [number, number, number] = [at[0], at[1], 0];
    return [
      { kind: "foundation", at: base },
      { kind: "member", a: base, b: at, type },
      { kind: "joint", at: base },
    ] satisfies GoalAction[];
  });
}

/** Replay scripted solutions in `env` and record every decision. */
export function recordDemonstrations(
  env: GoalEnv,
  episodes: number,
  seed = 0,
): { steps: DemonstrationStep[]; solved: number; attempted: number } {
  const random = createRandom(seed);
  const steps: DemonstrationStep[] = [];
  let solved = 0;
  let attempted = 0;
  for (let e = 0; e < episodes; e++) {
    attempted++;
    const episode: DemonstrationStep[] = [];
    let obs = env.reset(seed * 1000 + e);
    for (const action of scriptedSolution(obs, random)) {
      const actions = env.legalActions();
      const ctx = stateContext(obs);
      const id = actionId(action);
      const chosen = actions.findIndex((a) => actionId(a) === id);
      if (chosen < 0) throw new Error(`Scripted action is not legal: ${id}`);
      episode.push({
        rows: actions.map((a) => actionFeatures(ctx, a)),
        prior: kindBalancedPrior(actions),
        chosen,
      });
      const result = env.step(actions[chosen]);
      obs = result.observation;
      if (result.done) {
        // Only a demonstration that solves the level may teach.
        if (result.info.analysis.success) {
          solved++;
          steps.push(...episode);
        }
        break;
      }
    }
  }
  return { steps, solved, attempted };
}

/**
 * Record demonstrations from a planner's play, for scenarios the hand-written
 * script cannot solve (keep-out zones, later stages, taller weights). Only runs
 * the environment calls solved are kept, so a planner that fails teaches nothing.
 */
export function recordPlannerDemonstrations(
  env: GoalEnv,
  planner: Planner,
  seeds: readonly number[],
): { steps: DemonstrationStep[]; solved: number; attempted: number } {
  const steps: DemonstrationStep[] = [];
  let solved = 0;
  for (const seed of seeds) {
    const episode: DemonstrationStep[] = [];
    const run = runPlanner(env, planner, seed, (obs, action) => {
      const actions = env.legalActions();
      const id = actionId(action);
      const chosen = actions.findIndex((a) => actionId(a) === id);
      // An illegal planned action is penalised by the environment; do not teach it.
      if (chosen < 0) return;
      const ctx = stateContext(obs);
      episode.push({
        rows: actions.map((a) => actionFeatures(ctx, a)),
        prior: kindBalancedPrior(actions),
        chosen,
      });
    });
    if (run.solved) {
      solved++;
      steps.push(...episode);
    }
  }
  return { steps, solved, attempted: seeds.length };
}
