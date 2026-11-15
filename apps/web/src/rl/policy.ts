import { z } from "zod";
import { ACTION_FEATURE_NAMES } from "./features";
import { sampleIndex, type Random } from "./rng";

/**
 * Softmax policy over a variable action set: π(a | s) ∝ exp(w · φ(s, a)).
 * One weight vector scores every candidate, so the policy is independent of
 * how many actions are legal.
 */
export class LinearSoftmaxPolicy {
  constructor(readonly weights: Float64Array = new Float64Array(ACTION_FEATURE_NAMES.length)) {
    if (weights.length !== ACTION_FEATURE_NAMES.length)
      throw new Error(`Expected ${ACTION_FEATURE_NAMES.length} weights, got ${weights.length}`);
  }

  /**
   * Action probabilities for a feature matrix with one row per candidate.
   * `prior` adds a fixed log-prior per candidate (see `kindBalancedPrior`).
   */
  probabilities(
    features: readonly Float64Array[],
    prior?: ArrayLike<number>,
  ): Float64Array {
    const logits = features.map((phi, i) => dot(this.weights, phi) + (prior?.[i] ?? 0));
    const peak = Math.max(...logits);
    const exp = logits.map((l) => Math.exp(l - peak));
    const total = exp.reduce((a, b) => a + b, 0);
    return Float64Array.from(exp, (e) => e / total);
  }

  sample(
    features: readonly Float64Array[],
    random: Random,
    prior?: ArrayLike<number>,
  ): number {
    return sampleIndex(this.probabilities(features, prior), random);
  }

  /** Highest-probability action; ties break to the earliest candidate. */
  greedy(features: readonly Float64Array[], prior?: ArrayLike<number>): number {
    let best = 0;
    let bestScore = -Infinity;
    features.forEach((phi, i) => {
      const score = dot(this.weights, phi) + (prior?.[i] ?? 0);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    return best;
  }

  toJSON(): StoredPolicy {
    return {
      version: 1,
      featureNames: [...ACTION_FEATURE_NAMES],
      weights: [...this.weights],
    };
  }

  static fromJSON(value: unknown): LinearSoftmaxPolicy {
    const stored = StoredPolicySchema.parse(value);
    return new LinearSoftmaxPolicy(Float64Array.from(stored.weights));
  }
}

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/**
 * Persisted form. Feature names are stored so a policy trained against an
 * older feature set is rejected instead of silently mis-scoring actions.
 */
export const StoredPolicySchema = z
  .object({
    version: z.literal(1),
    featureNames: z.array(z.string()),
    weights: z.array(z.number().finite()),
  })
  .superRefine((policy, ctx) => {
    const expected = ACTION_FEATURE_NAMES as readonly string[];
    const matches =
      policy.featureNames.length === expected.length &&
      policy.featureNames.every((name, i) => name === expected[i]);
    if (!matches || policy.weights.length !== expected.length)
      ctx.addIssue({
        code: "custom",
        message: "Policy was trained with a different feature set",
      });
  });
export type StoredPolicy = z.infer<typeof StoredPolicySchema>;
