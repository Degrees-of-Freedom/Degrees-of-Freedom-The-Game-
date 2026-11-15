import { describe, expect, it } from "vitest";
import { GoalEnv } from "./goalEnv";
import { LOOKAHEAD_FEATURE_COUNT, LOOKAHEAD_FEATURE_NAMES, lookaheadFeatures } from "./lookahead";
import { GOAL_SCENARIOS } from "./scenarios";
import type { GoalAction } from "./types";

const named = (row: Float64Array) =>
  Object.fromEntries(LOOKAHEAD_FEATURE_NAMES.map((n, i) => [n, row[i]]));

function state(env: GoalEnv) {
  return { scenario: env.activeScenario, zones: env.activeScenario.zones ?? [], model: structuredClone(env.currentModel) };
}

describe("lookaheadFeatures", () => {
  it("score a useful foundation above a useless one, and leave passive actions at zero", () => {
    const env = new GoalEnv(GOAL_SCENARIOS.single);
    env.reset();
    const actions: GoalAction[] = [
      { kind: "foundation", at: [4, 4, 0] },
      { kind: "foundation", at: [12, 12, 0] },
      { kind: "finish" },
    ];
    const [near, far, finish] = lookaheadFeatures(state(env), actions).map(named);
    expect(near.laPotentialGain).toBeGreaterThan(far.laPotentialGain);
    expect(near.laCost).toBeCloseTo(0.4);
    expect([...lookaheadFeatures(state(env), [actions[2]])[0]]).toEqual(new Array(LOOKAHEAD_FEATURE_COUNT).fill(0));
    expect(finish.laSolves).toBe(0);
  });

  it("flag the move that solves the level and the joint that clears a mechanism", () => {
    const env = new GoalEnv(GOAL_SCENARIOS.single);
    env.reset();
    env.step({ kind: "foundation", at: [4, 4, 0] });
    env.step({ kind: "member", a: [4, 4, 0], b: [4, 4, 3], type: "glulam" });
    const [base, top] = lookaheadFeatures(state(env), [
      { kind: "joint", at: [4, 4, 0] },
      { kind: "joint", at: [4, 4, 3] },
    ]).map(named);
    expect(base.laSolves).toBe(1);
    expect(base.laUnstableDrop).toBeGreaterThan(0);
    expect(top.laSolves).toBe(0);
  });

  it("give zeros for an action the rules reject and do not modify the model", () => {
    const env = new GoalEnv(GOAL_SCENARIOS.zoned);
    env.reset();
    const s = state(env);
    const before = JSON.stringify(s.model);
    const [row] = lookaheadFeatures(s, [{ kind: "foundation", at: [7, 4, 0] }]);
    expect([...row]).toEqual(new Array(LOOKAHEAD_FEATURE_COUNT).fill(0));
    expect(JSON.stringify(s.model)).toBe(before);
  });
});
