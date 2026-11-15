import { LEVELS } from "../game/levels";
import type { Level } from "../game/model";
import type { GoalScenario, KeepOutZone } from "./types";

/** pickup1 with only its first weight: the smallest solvable goal. */
const SINGLE_LOAD_LEVEL: Level = {
  ...LEVELS.pickup1,
  name: "Pick-up · one weight",
  loads: [[4, 4, 3, 40]],
  desc: "Connect one 40 kN weight to a foundation.",
};

/**
 * An exclusion under the second weight of `pickup1`: no member or node may
 * enter it, so the direct column below (7,4,3) is blocked and the weight must
 * be reached by a detour. (A wider zone was tried first and was infeasible
 * with the level's supply: it needed HEB sections, of which there are none.)
 */
const DOCK: KeepOutZone = { id: "dock", min: [6.5, 3.5, 0], max: [7.5, 4.5, 2] };

/**
 * `pickup1` with a larger supply. Reaching the blocked weight takes a portal
 * (a column each side, five moment connections), so with the original six
 * joints the level cannot be solved at all (checked with the graph planner).
 */
const ZONED_LEVEL: Level = {
  ...LEVELS.pickup1,
  name: "Pick-up · keep-out zone",
  inv: { ...LEVELS.pickup1.inv, joint: 10, glulam: 10, found: 5 },
  desc: "Three weights; the direct column under one is blocked.",
};

/** First weight now; a second 40 kN weight appears after 5 actions. */
const STAGED_LEVEL: Level = {
  ...LEVELS.pickup1,
  name: "Pick-up · two stages",
  loads: [[4, 4, 3, 40]],
  desc: "Hold one weight, then reach a second that appears later.",
};

/**
 * Training scenarios, ordered as a curriculum. `pickup1` and `pickupR` are the
 * game's own levels; `single` is a derived level used to bootstrap learning.
 */
export const GOAL_SCENARIOS = {
  single: {
    id: "single",
    description: "One 40 kN weight at a fixed place; the smallest goal.",
    level: SINGLE_LOAD_LEVEL,
    maxSteps: 12,
    memberTypes: ["shs", "glulam", "ipe"],
    randomLoads: false,
  },
  pickup1: {
    id: "pickup1",
    description: "The game's Pick-up I level: three weights.",
    level: LEVELS.pickup1,
    maxSteps: 40,
    memberTypes: ["shs", "glulam", "ipe"],
    randomLoads: false,
  },
  pickupR: {
    id: "pickupR",
    description: "The game's random pick-up level, loads drawn from the seed.",
    level: LEVELS.pickupR,
    maxSteps: 60,
    memberTypes: ["shs", "glulam", "ipe", "heb"],
    randomLoads: true,
  },
  zoned: {
    id: "zoned",
    description: "pickup1 with a keep-out zone under the second weight (larger supply).",
    level: ZONED_LEVEL,
    maxSteps: 40,
    memberTypes: ["shs", "glulam", "ipe"],
    randomLoads: false,
    zones: [DOCK],
  },
  staged: {
    id: "staged",
    description: "Hold one weight, wait, then reach a second that appears after 5 actions.",
    level: STAGED_LEVEL,
    maxSteps: 30,
    memberTypes: ["shs", "glulam", "ipe"],
    randomLoads: false,
    laterStages: [{ atStep: 5, weights: [[7, 4, 3, 40]] }],
  },
  holdAvoid: {
    id: "holdAvoid",
    description: "Staged goal and the keep-out zone together.",
    level: STAGED_LEVEL,
    maxSteps: 40,
    memberTypes: ["shs", "glulam", "ipe"],
    randomLoads: false,
    zones: [DOCK],
    laterStages: [{ atStep: 5, weights: [[7, 4, 3, 40]] }],
  },
} as const satisfies Record<string, GoalScenario>;

export type GoalScenarioId = keyof typeof GOAL_SCENARIOS;

export const GOAL_SCENARIO_IDS = Object.keys(GOAL_SCENARIOS) as GoalScenarioId[];

export function isGoalScenarioId(value: string): value is GoalScenarioId {
  return value in GOAL_SCENARIOS;
}
