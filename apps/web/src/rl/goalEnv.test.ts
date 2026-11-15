import { describe, expect, it } from "vitest";
import { GoalEnv } from "./goalEnv";
import { GOAL_SCENARIOS } from "./scenarios";
import { PICKUP_OBJECTIVE_COUNT } from "./reward";
import type { GoalAction } from "./types";

/**
 * An IPE column under the single weight at 4,4,3 solves it. Without the joint
 * the column is a mechanism: a member end takes moment from the fixed foundation
 * only if that node has a moment connection, so the base needs one.
 */
const SOLUTION: GoalAction[] = [
  { kind: "foundation", at: [4, 4, 0] },
  { kind: "member", a: [4, 4, 0], b: [4, 4, 3], type: "ipe" },
  { kind: "joint", at: [4, 4, 0] },
];

describe("GoalEnv", () => {
  it("starts with the level's weights unconnected", () => {
    const obs = new GoalEnv(GOAL_SCENARIOS.single).reset(1);
    expect(obs.targets).toEqual([
      { key: "4,4,3", at: [4, 4, 3], kN: 40, connected: false },
    ]);
    expect(obs.analysis.error).toBeTruthy();
    expect(obs.step).toBe(0);
  });

  it("solves the single-weight level with the known column and reports success", () => {
    const env = new GoalEnv(GOAL_SCENARIOS.single);
    env.reset();
    const results = SOLUTION.map((a) => env.step(a));
    const last = results[results.length - 1];
    expect(last.done).toBe(true);
    expect(last.truncated).toBe(false);
    expect(last.info.analysis.success).toBe(true);
    expect(last.info.analysis.objectivesPassed).toBe(PICKUP_OBJECTIVE_COUNT);
    expect(last.info.terminal).toBeGreaterThan(1);
    // Everything before the last move was unsolved.
    expect(results.slice(0, -1).every((r) => !r.done)).toBe(true);
  });

  it("makes shaping telescope: summed shaping equals potential gained", () => {
    const env = new GoalEnv(GOAL_SCENARIOS.single);
    env.reset();
    const shaping = SOLUTION.map((a) => env.step(a).info.shaping).reduce(
      (a, b) => a + b,
      0,
    );
    expect(shaping).toBeCloseTo(1, 10); // Φ(solved) = 1, Φ(start) = 0
  });

  it("gives no credit for a foundation that carries nothing", () => {
    const env = new GoalEnv(GOAL_SCENARIOS.single);
    env.reset();
    // Far corner: beyond REACH_RANGE of the weight, so it is no progress.
    const result = env.step({ kind: "foundation", at: [12, 12, 0] });
    expect(result.info.shaping).toBe(0);
    expect(result.reward).toBeLessThan(0);
  });

  it("rewards a foundation placed closer to the weight", () => {
    const shaping = (at: [number, number, number]) => {
      const env = new GoalEnv(GOAL_SCENARIOS.single);
      env.reset();
      return env.step({ kind: "foundation", at }).info.shaping;
    };
    expect(shaping([4, 4, 0])).toBeGreaterThan(shaping([6, 6, 0]));
    expect(shaping([6, 6, 0])).toBeGreaterThan(0);
  });

  it("pays more for a cheaper solution", () => {
    const run = (type: "ipe" | "glulam") => {
      const env = new GoalEnv(GOAL_SCENARIOS.single);
      env.reset();
      return SOLUTION.map((a) =>
        a.kind === "member" ? { ...a, type } : a,
      ).map((a) => env.step(a));
    };
    const ipe = run("ipe").at(-1)!;
    const glulam = run("glulam").at(-1)!;
    if (glulam.info.analysis.success)
      // glulam costs 180 against 260 for IPE, so it leaves more budget.
      expect(glulam.info.terminal).toBeGreaterThan(ipe.info.terminal);
  });

  it("rejects an illegal action without changing the model and penalises it", () => {
    const env = new GoalEnv(GOAL_SCENARIOS.single);
    const before = env.reset();
    const result = env.step({ kind: "foundation", at: [4, 4, 2] });
    expect(result.info.invalid).toMatch(/solid ground/);
    expect(result.reward).toBeLessThan(0);
    expect(result.observation.model).toEqual(before.model);
  });

  it("rejects section types the scenario does not allow", () => {
    const env = new GoalEnv(GOAL_SCENARIOS.single);
    env.reset();
    env.step({ kind: "foundation", at: [4, 4, 0] });
    const result = env.step({ kind: "member", a: [4, 4, 0], b: [4, 4, 3], type: "heb" });
    expect(result.info.invalid).toMatch(/not available/);
  });

  it("ends unsolved when the agent finishes or the step cap is reached", () => {
    const env = new GoalEnv(GOAL_SCENARIOS.single);
    env.reset();
    const gaveUp = env.step({ kind: "finish" });
    expect(gaveUp.done).toBe(true);
    expect(gaveUp.info.terminal).toBeLessThan(0);

    env.reset();
    let result = env.step({ kind: "foundation", at: [0, 0, 0] });
    for (let i = 1; i < GOAL_SCENARIOS.single.maxSteps; i++)
      result = env.step({ kind: "foundation", at: [0, 0, 0] });
    expect(result.truncated).toBe(true);
    expect(() => env.step({ kind: "finish" })).toThrow(/Episode is over/);
  });

  it("only offers legal actions and always includes finish first", () => {
    const env = new GoalEnv(GOAL_SCENARIOS.single);
    env.reset();
    env.step({ kind: "foundation", at: [4, 4, 0] });
    const actions = env.legalActions();
    expect(actions[0]).toEqual({ kind: "finish" });
    expect(actions.length).toBeGreaterThan(10);
    for (const action of actions.slice(0, 200)) {
      const probe = new GoalEnv(GOAL_SCENARIOS.single);
      probe.reset();
      probe.step({ kind: "foundation", at: [4, 4, 0] });
      expect(probe.step(action).info.invalid).toBeNull();
    }
  });

  it("is deterministic and draws random loads from the seed", () => {
    const loads = (seed: number) =>
      new GoalEnv(GOAL_SCENARIOS.pickupR).reset(seed).targets.map((t) => t.key);
    expect(loads(7)).toEqual(loads(7));
    expect(loads(7)).not.toEqual(loads(8));
  });

  it("does not expose internal state to mutation", () => {
    const env = new GoalEnv(GOAL_SCENARIOS.single);
    env.reset();
    const obs = env.step({ kind: "foundation", at: [4, 4, 0] }).observation;
    obs.model.attrs["4,4,0"].found = false;
    expect(env.currentModel.attrs["4,4,0"].found).toBe(true);
  });
});
