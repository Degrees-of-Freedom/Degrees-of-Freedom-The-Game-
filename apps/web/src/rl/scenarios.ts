import { LEVELS } from "../game/levels";
import type { Level } from "../game/model";
import type { EpisodeLayout, GoalScenario, KeepOutZone } from "./types";
import type { Random } from "./rng";

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

/** A larger supply, since random layouts can need portals (see `ZONED_LEVEL`). */
const RANDOM_LAYOUT_LEVEL: Level = {
  ...LEVELS.pickup1,
  name: "Pick-up · random staged layout",
  inv: { ...LEVELS.pickup1.inv, joint: 10, glulam: 10, ipe: 6, found: 5 },
  desc: "A first weight, then a second that appears later behind a keep-out zone.",
};

/**
 * Random staged and zoned layout: a 40 kN weight 3 cells up, then after 5
 * actions a second 40 kN weight 3 cells up at least 3 cells away, with a zone
 * under it that blocks its direct column. Only the positions vary. A first
 * version also varied height (2-3 cells) and load (30-50 kN); the graph planner
 * solved 4 of 12 of those, because a weight 2 cells up has a much tighter
 * movement limit (height/250), so they mostly measured infeasible layouts.
 */
export function stagedZonedLayout(random: Random): EpisodeLayout {
  const pick = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
  const first: [number, number] = [pick(3, 8), pick(3, 8)];
  let second: [number, number];
  do second = [pick(3, 8), pick(3, 8)];
  while (Math.hypot(first[0] - second[0], first[1] - second[1]) < 3);
  const height = 3;
  return {
    weights: [[first[0], first[1], 3, 40]],
    laterStages: [{ atStep: 5, weights: [[second[0], second[1], height, 40]] }],
    zones: [{ id: "keep-out", min: [second[0] - 0.5, second[1] - 0.5, 0], max: [second[0] + 0.5, second[1] + 0.5, height - 1] }],
  };
}

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
  stagedR: {
    id: "stagedR",
    description: "Random layouts: a first weight, then a second behind a keep-out zone (seeded).",
    level: RANDOM_LAYOUT_LEVEL,
    maxSteps: 40,
    memberTypes: ["shs", "glulam", "ipe"],
    randomLoads: false,
    layout: stagedZonedLayout,
  },
} as const satisfies Record<string, GoalScenario>;

export type GoalScenarioId = keyof typeof GOAL_SCENARIOS;

export const GOAL_SCENARIO_IDS = Object.keys(GOAL_SCENARIOS) as GoalScenarioId[];

export function isGoalScenarioId(value: string): value is GoalScenarioId {
  return value in GOAL_SCENARIOS;
}
