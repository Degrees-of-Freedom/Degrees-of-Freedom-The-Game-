import type { GoalEnv } from "./goalEnv";
import {
  ACTION_FEATURE_COUNT,
  STATE_FEATURE_COUNT,
  actionFeatures,
  kindBalancedPrior,
  stateContext,
  stateFeatures,
} from "./features";
import { RidgeBaseline } from "./baseline";
import { LinearSoftmaxPolicy } from "./policy";
import { createRandom, sampleIndex } from "./rng";

export interface TrainConfig {
  /** Total training episodes (rounded up to whole batches). */
  episodes: number;
  /** Episodes collected per policy update. */
  batchSize: number;
  /** Step size of the policy gradient update. */
  learningRate: number;
  /** Updates longer than this (L2) are scaled down, guarding against outliers. */
  maxUpdateNorm: number;
  /** Weight of the entropy bonus that keeps exploration alive. */
  entropyCoefficient: number;
  /** Return discount γ in (0, 1]. */
  discount: number;
  seed: number;
}

export const DEFAULT_TRAIN_CONFIG: TrainConfig = {
  episodes: 960,
  batchSize: 8,
  learningRate: 1,
  maxUpdateNorm: 2,
  entropyCoefficient: 0.01,
  discount: 0.99,
  seed: 1,
};

/** Training seeds start here so they never overlap evaluation seeds (10_000+). */
const TRAIN_SEED_BASE = 1_000_000;

export interface BatchMetrics {
  /** Episodes completed once this batch finished. */
  episodes: number;
  meanReturn: number;
  successRate: number;
  meanSteps: number;
  /** Mean policy entropy (nats) over the batch's decisions. */
  entropy: number;
}

export interface TrainResult {
  policy: LinearSoftmaxPolicy;
  history: BatchMetrics[];
}

interface Transition {
  /** ∇ log π(a|s): chosen features minus the expected features. */
  score: Float64Array;
  /** ∇ H(π(·|s)) with respect to the weights. */
  entropyGradient: Float64Array;
  entropy: number;
  state: Float64Array;
  reward: number;
}

function validate(config: TrainConfig): void {
  const positive = (name: string, value: number) => {
    if (!(value > 0) || !Number.isFinite(value))
      throw new RangeError(`${name} must be a positive finite number`);
  };
  positive("episodes", config.episodes);
  positive("batchSize", config.batchSize);
  positive("learningRate", config.learningRate);
  positive("maxUpdateNorm", config.maxUpdateNorm);
  if (!(config.discount > 0 && config.discount <= 1))
    throw new RangeError("discount must be in (0, 1]");
  if (config.entropyCoefficient < 0)
    throw new RangeError("entropyCoefficient cannot be negative");
}

/**
 * REINFORCE with a ridge-regression value baseline and an entropy bonus.
 *
 * Each batch samples whole episodes from the current policy. Each decision's
 * advantage is its discounted return minus the baseline. The policy ascends
 * Σ advantage · ∇log π + β · ∇H with plain gradient
 * steps. Advantages are not rescaled: normalising them (or the step) turns a
 * batch that saw no success into a full-size step along pure noise, which
 * drifts rarely sampled weights, such as the joint that completes a structure.
 */
export function train(
  env: GoalEnv,
  partial: Partial<TrainConfig> = {},
  initial: LinearSoftmaxPolicy = new LinearSoftmaxPolicy(),
  onBatch?: (metrics: BatchMetrics, policy: LinearSoftmaxPolicy) => void,
): TrainResult {
  const config = { ...DEFAULT_TRAIN_CONFIG, ...partial };
  validate(config);
  const policy = new LinearSoftmaxPolicy(Float64Array.from(initial.weights));
  const baseline = new RidgeBaseline(STATE_FEATURE_COUNT);
  const random = createRandom(config.seed);
  const history: BatchMetrics[] = [];
  let done = 0;

  while (done < config.episodes) {
    const batch: { transitions: Transition[]; solved: boolean }[] = [];
    for (let e = 0; e < config.batchSize; e++)
      batch.push(rollout(env, policy, TRAIN_SEED_BASE + config.seed * 100_003 + done + e, random));
    done += config.batchSize;

    // Discounted returns and advantages.
    const samples: { t: Transition; ret: number; advantage: number }[] = [];
    for (const { transitions } of batch) {
      let ret = 0;
      const returns = new Array<number>(transitions.length);
      for (let i = transitions.length - 1; i >= 0; i--) {
        ret = transitions[i].reward + config.discount * ret;
        returns[i] = ret;
      }
      transitions.forEach((t, i) =>
        samples.push({ t, ret: returns[i], advantage: returns[i] - baseline.predict(t.state) }),
      );
    }
    // Gradient of expected return: advantage-weighted score summed over each
    // episode's decisions, averaged over episodes. Advantages are left in
    // reward units: a batch with no real signal then gives a small step, while
    // a batch that found a solution gives a large one.
    const gradient = new Float64Array(ACTION_FEATURE_COUNT);
    for (const { t, advantage } of samples)
      for (let k = 0; k < gradient.length; k++)
        gradient[k] +=
          (advantage * t.score[k] + config.entropyCoefficient * t.entropyGradient[k]) /
          batch.length;
    const norm = Math.hypot(...gradient);
    const clip = norm > config.maxUpdateNorm ? config.maxUpdateNorm / norm : 1;
    for (let k = 0; k < gradient.length; k++)
      policy.weights[k] += config.learningRate * clip * gradient[k];

    baseline.update(samples.map((x) => x.t.state), samples.map((x) => x.ret));

    const metrics: BatchMetrics = {
      episodes: done,
      meanReturn: batch.reduce((s, b) => s + b.transitions.reduce((r, t) => r + t.reward, 0), 0) / batch.length,
      successRate: batch.filter((b) => b.solved).length / batch.length,
      meanSteps: samples.length / batch.length,
      entropy: samples.reduce((s, x) => s + x.t.entropy, 0) / samples.length,
    };
    history.push(metrics);
    onBatch?.(metrics, policy);
  }
  return { policy, history };
}

/** Play one episode by sampling the policy, recording what the update needs. */
function rollout(
  env: GoalEnv,
  policy: LinearSoftmaxPolicy,
  seed: number,
  random: () => number,
): { transitions: Transition[]; solved: boolean } {
  let obs = env.reset(seed);
  const transitions: Transition[] = [];
  let solved = false;
  for (;;) {
    const actions = env.legalActions();
    const ctx = stateContext(obs);
    const rows = actions.map((a) => actionFeatures(ctx, a));
    const probs = policy.probabilities(rows, kindBalancedPrior(actions));
    const chosen = sampleIndex(probs, random);

    const expected = new Float64Array(ACTION_FEATURE_COUNT);
    let entropy = 0;
    probs.forEach((p, i) => {
      if (p <= 0) return;
      entropy -= p * Math.log(p);
      for (let k = 0; k < expected.length; k++) expected[k] += p * rows[i][k];
    });
    const score = Float64Array.from(rows[chosen], (v, k) => v - expected[k]);
    const entropyGradient = new Float64Array(ACTION_FEATURE_COUNT);
    probs.forEach((p, i) => {
      if (p <= 0) return;
      const weight = -p * (Math.log(p) + entropy);
      for (let k = 0; k < entropyGradient.length; k++) entropyGradient[k] += weight * rows[i][k];
    });

    const state = stateFeatures(obs);
    const result = env.step(actions[chosen]);
    transitions.push({ score, entropyGradient, entropy, state, reward: result.reward });
    obs = result.observation;
    if (result.done || result.truncated) {
      solved = result.info.analysis.success;
      return { transitions, solved };
    }
  }
}
