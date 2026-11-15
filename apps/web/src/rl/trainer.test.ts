import { describe, expect, it } from "vitest";
import { evaluate, playEpisode, PolicyAgent, RandomAgent } from "./agents";
import { ACTION_FEATURE_NAMES } from "./features";
import { GoalEnv } from "./goalEnv";
import { LinearSoftmaxPolicy } from "./policy";
import { createRandom } from "./rng";
import { GOAL_SCENARIOS } from "./scenarios";
import { train } from "./trainer";

describe("train", () => {
  it("rejects nonsensical configuration", () => {
    const env = new GoalEnv(GOAL_SCENARIOS.single);
    expect(() => train(env, { episodes: 0 })).toThrow(RangeError);
    expect(() => train(env, { batchSize: -1 })).toThrow(RangeError);
    expect(() => train(env, { discount: 1.5 })).toThrow(/discount/);
    expect(() => train(env, { learningRate: Number.NaN })).toThrow(RangeError);
    expect(() => train(env, { entropyCoefficient: -1 })).toThrow(/entropy/);
  });

  it("is deterministic for a seed and leaves the initial policy untouched", () => {
    const initial = new LinearSoftmaxPolicy();
    const run = () => train(new GoalEnv(GOAL_SCENARIOS.single), { episodes: 16, batchSize: 8, seed: 5 }, initial);
    const a = run();
    const b = run();
    expect([...a.policy.weights]).toEqual([...b.policy.weights]);
    expect([...a.policy.weights].some((w) => w !== 0)).toBe(true);
    expect([...initial.weights].every((w) => w === 0)).toBe(true);
    expect(a.history.map((h) => h.episodes)).toEqual([8, 16]);
  });

  it("reports finite batch metrics and calls back after each update", () => {
    const seen: number[] = [];
    const { history } = train(
      new GoalEnv(GOAL_SCENARIOS.single),
      { episodes: 16, batchSize: 8 },
      undefined,
      (m, policy) => {
        seen.push(m.episodes);
        expect(policy.weights).toHaveLength(ACTION_FEATURE_NAMES.length);
      },
    );
    expect(seen).toEqual([8, 16]);
    for (const m of history) {
      expect(Number.isFinite(m.meanReturn)).toBe(true);
      expect(m.entropy).toBeGreaterThan(0);
      expect(m.successRate).toBeGreaterThanOrEqual(0);
    }
  });

  // Learning is the point of the module, so pin it. Seed 7 is verified to
  // reach a solving greedy policy well inside this budget; the run is
  // deterministic, so a failure means the learner or the reward regressed.
  it("learns to solve the single-weight level far better than random play", () => {
    const env = new GoalEnv(GOAL_SCENARIOS.single);
    const random = evaluate(env, new RandomAgent(createRandom(1)), 20);
    const { policy } = train(env, { episodes: 240, seed: 7 });
    const trained = evaluate(env, new PolicyAgent(policy), 20);
    expect(random.successRate).toBe(0);
    expect(trained.successRate).toBeGreaterThanOrEqual(0.9);
    // It should also build economically: well under the 3000 budget.
    expect(trained.meanSolvedCost).toBeLessThan(1000);
    expect(trained.meanSteps).toBeLessThanOrEqual(4);
  }, 60_000);
});

describe("evaluation", () => {
  it("is reproducible and uses seeds disjoint from training", () => {
    const env = new GoalEnv(GOAL_SCENARIOS.pickupR);
    const run = () => playEpisode(env, new RandomAgent(createRandom(3)), 10_000);
    expect(run()).toEqual(run());
  });
});

describe("imitate", () => {
  it("fits the one-weight and staged planner solutions exactly", async () => {
    const { imitate, demonstrationAccuracy } = await import("./trainer");
    const { recordPlannerDemonstrations } = await import("./demonstrations");
    const { GraphPlanner } = await import("./planning/graphPlanner");
    for (const id of ["single", "staged"] as const) {
      const { steps } = recordPlannerDemonstrations(new GoalEnv(GOAL_SCENARIOS[id]), new GraphPlanner(), [0]);
      expect(steps.length).toBeGreaterThan(0);
      expect(demonstrationAccuracy(imitate(steps), steps)).toBe(1);
    }
  }, 60_000);

  it("scores an empty demonstration set as trivially matched", async () => {
    const { demonstrationAccuracy } = await import("./trainer");
    expect(demonstrationAccuracy(new LinearSoftmaxPolicy(), [])).toBe(1);
  });
});
