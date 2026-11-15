import { describe, expect, it } from "vitest";
import { ACTION_FEATURE_NAMES, actionFeatures, stateContext, stateFeatures, STATE_FEATURE_COUNT, type ActionFeatureName } from "./features";
import { GoalEnv } from "./goalEnv";
import { GOAL_SCENARIOS } from "./scenarios";
import type { GoalAction } from "./types";

const named = (row: Float64Array) =>
  Object.fromEntries(ACTION_FEATURE_NAMES.map((n, i) => [n, row[i]]).filter(([, v]) => v !== 0)) as Partial<Record<ActionFeatureName, number>>;

function start() {
  const env = new GoalEnv(GOAL_SCENARIOS.single);
  return { env, obs: env.reset() };
}

describe("action features", () => {
  it("flag a foundation directly under an unconnected weight", () => {
    const { obs } = start();
    const ctx = stateContext(obs);
    const below = named(actionFeatures(ctx, { kind: "foundation", at: [4, 4, 0] }));
    expect(below).toMatchObject({ foundationFirst: 1, foundationBelowWeight: 1, foundationNearness: 1 });
    const far = named(actionFeatures(ctx, { kind: "foundation", at: [12, 12, 0] }));
    expect(far.foundationBelowWeight).toBeUndefined();
    expect(far.foundationNearness).toBeUndefined();
  });

  it("recognise a member that connects a supported end to a weight, in either direction", () => {
    const { env } = start();
    const obs = env.step({ kind: "foundation", at: [4, 4, 0] }).observation;
    const ctx = stateContext(obs);
    for (const [a, b] of [[[4, 4, 0], [4, 4, 3]], [[4, 4, 3], [4, 4, 0]]] as const) {
      const f = named(actionFeatures(ctx, { kind: "member", a: [...a], b: [...b], type: "ipe" }));
      expect(f).toMatchObject({ memberConnectsWeight: 1, memberFromSupported: 1, sectionIpe: 1 });
      expect(f.memberCloser).toBeGreaterThan(0);
      expect(f.memberVertical).toBeCloseTo(1);
    }
  });

  it("mark a member away from everything as floating", () => {
    const { obs } = start();
    const f = named(actionFeatures(stateContext(obs), { kind: "member", a: [10, 10, 2], b: [10, 10, 4], type: "shs" }));
    expect(f).toMatchObject({ memberFloating: 1 });
    expect(f.memberFromSupported).toBeUndefined();
  });

  it("tell the joint that fixes a mechanism from other joints", () => {
    const { env } = start();
    env.step({ kind: "foundation", at: [4, 4, 0] });
    const obs = env.step({ kind: "member", a: [4, 4, 0], b: [4, 4, 3], type: "ipe" }).observation;
    expect(obs.analysis.mechanism).toBe(true);
    const ctx = stateContext(obs);
    const base = named(actionFeatures(ctx, { kind: "joint", at: [4, 4, 0] }));
    const top = named(actionFeatures(ctx, { kind: "joint", at: [4, 4, 3] }));
    expect(base).toMatchObject({ jointAtFoundation: 1, jointWhileMechanism: 1, jointOnSupportedWhileMechanism: 1 });
    expect(top).toMatchObject({ jointAtWeight: 1, jointWhileMechanism: 1 });
  });

  it("set exactly the finish feature for finish and stay finite for every legal action", () => {
    const { env, obs } = start();
    env.step({ kind: "foundation", at: [4, 4, 0] });
    const ctx = stateContext(obs);
    expect(named(actionFeatures(ctx, { kind: "finish" }))).toEqual({ isFinish: 1 });
    for (const action of env.legalActions() as GoalAction[])
      expect(actionFeatures(ctx, action).every(Number.isFinite)).toBe(true);
  });

  it("reuse the output buffer without leaking earlier values", () => {
    const { obs } = start();
    const ctx = stateContext(obs);
    const buffer = new Float64Array(ACTION_FEATURE_NAMES.length);
    actionFeatures(ctx, { kind: "foundation", at: [4, 4, 0] }, buffer);
    actionFeatures(ctx, { kind: "finish" }, buffer);
    expect(named(buffer)).toEqual({ isFinish: 1 });
  });
});

describe("state features", () => {
  it("start at zero progress and rise as the weight is connected", () => {
    const { env, obs } = start();
    expect(stateFeatures(obs)).toHaveLength(STATE_FEATURE_COUNT);
    expect([...stateFeatures(obs)].slice(1, 4)).toEqual([0, 0, 0]);
    env.step({ kind: "foundation", at: [4, 4, 0] });
    const connected = env.step({ kind: "member", a: [4, 4, 0], b: [4, 4, 3], type: "ipe" }).observation;
    const [bias, connectedFraction, reach] = stateFeatures(connected);
    expect([bias, connectedFraction, reach]).toEqual([1, 1, 1]);
  });
});
