import { describe, expect, it } from "vitest";
import { recordDemonstrations, scriptedSolution } from "./demonstrations";
import { ACTION_FEATURE_NAMES } from "./features";
import { GoalEnv } from "./goalEnv";
import { createRandom } from "./rng";
import { GOAL_SCENARIOS } from "./scenarios";

describe("scripted demonstrations", () => {
  it("solve the levels they are written for, in every weight order", () => {
    for (const id of ["single", "pickup1"] as const) {
      const env = new GoalEnv(GOAL_SCENARIOS[id]);
      const { solved, attempted, steps } = recordDemonstrations(env, 12, 3);
      expect(solved).toBe(attempted);
      expect(steps.length).toBe(3 * GOAL_SCENARIOS[id].level.loads!.length * attempted);
    }
  });

  it("record aligned rows, priors and a valid chosen index", () => {
    const { steps } = recordDemonstrations(new GoalEnv(GOAL_SCENARIOS.single), 2, 1);
    for (const step of steps) {
      expect(step.rows).toHaveLength(step.prior.length);
      expect(step.rows[0]).toHaveLength(ACTION_FEATURE_NAMES.length);
      expect(step.chosen).toBeGreaterThanOrEqual(0);
      expect(step.chosen).toBeLessThan(step.rows.length);
    }
  });

  it("refuse a level no single column can reach", () => {
    const env = new GoalEnv(GOAL_SCENARIOS.single);
    const obs = env.reset();
    const tall = { ...obs, targets: [{ ...obs.targets[0], at: [4, 4, 6] as [number, number, number] }] };
    expect(() => scriptedSolution(tall, createRandom(1))).toThrow(/height 6/);
  });
});
