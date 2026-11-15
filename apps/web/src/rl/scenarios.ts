import { LEVELS } from "../game/levels";
import type { Level } from "../game/model";
import type { GoalScenario } from "./types";

/** pickup1 with only its first weight: the smallest solvable goal. */
const SINGLE_LOAD_LEVEL: Level = {
  ...LEVELS.pickup1,
  name: "Pick-up · one weight",
  loads: [[4, 4, 3, 40]],
  desc: "Connect one 40 kN weight to a foundation.",
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
} as const satisfies Record<string, GoalScenario>;

export type GoalScenarioId = keyof typeof GOAL_SCENARIOS;

export const GOAL_SCENARIO_IDS = Object.keys(GOAL_SCENARIOS) as GoalScenarioId[];

export function isGoalScenarioId(value: string): value is GoalScenarioId {
  return value in GOAL_SCENARIOS;
}
