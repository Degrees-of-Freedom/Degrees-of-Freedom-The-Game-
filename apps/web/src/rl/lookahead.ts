import { analyzeVoxel } from "../solver/voxel";
import type { GameModel } from "../game/model";
import { applyAction } from "./actions";
import { potential, summarizeAnalysis } from "./reward";
import type { GoalAction, GoalScenario, KeepOutZone, RewardConfig } from "./types";
import { DEFAULT_REWARD } from "./reward";

/**
 * Features of the structure an action would produce, from simulating it with
 * the game's own analysis. They let a small scorer judge a design as a whole
 * (does this member leave a mechanism? does it pass the checks?) instead of
 * guessing from the action's coordinates.
 */
export const LOOKAHEAD_FEATURE_NAMES = [
  "laPotentialGain",
  "laUnstableDrop",
  "laObjectivesGain",
  "laConnectedGain",
  "laSolves",
  "laCost",
] as const;
export const LOOKAHEAD_FEATURE_COUNT = LOOKAHEAD_FEATURE_NAMES.length;

export interface LookaheadState {
  scenario: GoalScenario;
  zones: readonly KeepOutZone[];
  model: GameModel;
  reward?: RewardConfig;
}

/** Look-ahead features for every action in `actions` (zeros for `finish`/`wait`). */
export function lookaheadFeatures(
  { scenario, zones, model, reward = DEFAULT_REWARD }: LookaheadState,
  actions: readonly GoalAction[],
): Float64Array[] {
  const { level } = scenario;
  const now = summarizeAnalysis(analyzeVoxel(model, level), model, level.budget);
  const before = potential(now, reward);
  return actions.map((action) => {
    const out = new Float64Array(LOOKAHEAD_FEATURE_COUNT);
    if (action.kind === "finish" || action.kind === "wait") return out;
    const result = applyAction(level, model, action, zones);
    if (result.issue) return out;
    const after = summarizeAnalysis(analyzeVoxel(result.model, level), result.model, level.budget);
    out[0] = potential(after, reward) - before;
    out[1] = now.unstableShare - after.unstableShare;
    out[2] = (after.objectivesPassed - now.objectivesPassed) / 8;
    out[3] = (after.connectedTargets - now.connectedTargets) / Math.max(1, after.targets);
    out[4] = after.success ? 1 : 0;
    out[5] = (after.cost - now.cost) / 1000;
    return out;
  });
}
