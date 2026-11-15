import { describe, expect, it } from "vitest";
import { solveLinear, RidgeBaseline } from "./baseline";
import { ACTION_FEATURE_NAMES, kindBalancedPrior } from "./features";
import { LinearSoftmaxPolicy } from "./policy";
import { createRandom } from "./rng";
import type { GoalAction } from "./types";

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => Float64Array.from({ length: ACTION_FEATURE_NAMES.length }, (_, k) => (i === k ? 1 : 0)));

describe("LinearSoftmaxPolicy", () => {
  it("is uniform with zero weights and sums to one", () => {
    const p = new LinearSoftmaxPolicy().probabilities(rows(4));
    expect([...p].every((x) => Math.abs(x - 0.25) < 1e-12)).toBe(true);
  });

  it("prefers higher-scoring actions and is numerically stable for huge logits", () => {
    const w = new Float64Array(ACTION_FEATURE_NAMES.length);
    w[1] = 1000;
    const policy = new LinearSoftmaxPolicy(w);
    const p = policy.probabilities(rows(3));
    expect(p[1]).toBeCloseTo(1, 10);
    expect(policy.greedy(rows(3))).toBe(1);
  });

  it("samples reproducibly from a seeded generator", () => {
    const policy = new LinearSoftmaxPolicy();
    const draw = (seed: number) => {
      const random = createRandom(seed);
      return Array.from({ length: 20 }, () => policy.sample(rows(5), random));
    };
    expect(draw(3)).toEqual(draw(3));
  });

  it("round-trips through JSON and rejects a policy from another feature set", () => {
    const w = Float64Array.from({ length: ACTION_FEATURE_NAMES.length }, (_, i) => i / 10);
    const stored = JSON.parse(JSON.stringify(new LinearSoftmaxPolicy(w)));
    expect([...LinearSoftmaxPolicy.fromJSON(stored).weights]).toEqual([...w]);
    expect(() => LinearSoftmaxPolicy.fromJSON({ ...stored, featureNames: ["x"] })).toThrow(/different feature set/);
    expect(() => LinearSoftmaxPolicy.fromJSON({ ...stored, weights: [1] })).toThrow();
    expect(() => LinearSoftmaxPolicy.fromJSON({ ...stored, weights: stored.weights.map(() => null) })).toThrow();
  });

  it("rejects a weight vector of the wrong length", () => {
    expect(() => new LinearSoftmaxPolicy(new Float64Array(2))).toThrow(/Expected/);
  });
});

describe("kindBalancedPrior", () => {
  it("gives each kind equal mass and `finish` one action's worth", () => {
    const actions: GoalAction[] = [
      { kind: "finish" },
      { kind: "foundation", at: [0, 0, 0] },
      { kind: "foundation", at: [1, 0, 0] },
      { kind: "joint", at: [0, 0, 0] },
      ...Array.from({ length: 6 }, (_, i): GoalAction => ({ kind: "member", a: [0, 0, 0], b: [0, 0, i + 1], type: "shs" })),
    ];
    const p = new LinearSoftmaxPolicy().probabilities(
      actions.map(() => new Float64Array(ACTION_FEATURE_NAMES.length)),
      kindBalancedPrior(actions),
    );
    const mass = (kind: string) => actions.reduce((s, a, i) => s + (a.kind === kind ? p[i] : 0), 0);
    expect(mass("foundation")).toBeCloseTo(mass("member"), 10);
    expect(mass("joint")).toBeCloseTo(mass("member"), 10);
    // The three present kinds share weight 1 in total; finish has weight 1/N.
    const finishWeight = 1 / actions.length;
    expect(mass("finish")).toBeCloseTo(finishWeight / (1 + finishWeight), 10);
  });
});

describe("RidgeBaseline", () => {
  it("solves small linear systems", () => {
    const x = solveLinear([Float64Array.of(2, 1), Float64Array.of(1, 3)], [5, 10]);
    expect(x[0]).toBeCloseTo(1, 10);
    expect(x[1]).toBeCloseTo(3, 10);
    expect(() => solveLinear([Float64Array.of(1, 1), Float64Array.of(2, 2)], [1, 2])).toThrow(/Singular/);
  });

  it("recovers a linear value function", () => {
    const baseline = new RidgeBaseline(3, 1e-9);
    const random = createRandom(1);
    const states = Array.from({ length: 200 }, () => Float64Array.of(1, random(), random()));
    baseline.update(states, states.map((s) => 2 + 3 * s[1] - 1 * s[2]));
    expect(baseline.predict(Float64Array.of(1, 0.5, 0.25))).toBeCloseTo(2 + 1.5 - 0.25, 4);
  });
});
