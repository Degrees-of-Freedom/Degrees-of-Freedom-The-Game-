/**
 * Train a goal-mode agent and write the policy and learning curve to disk.
 *
 *   npm run train:goal -- --scenario single --episodes 1000 --seed 1
 *   npm run train:goal -- --scenario pickup1 --init rl-runs/single-seed1/policy.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { evaluate, PolicyAgent, RandomAgent } from "../agents";
import { GoalEnv } from "../goalEnv";
import { LinearSoftmaxPolicy } from "../policy";
import { createRandom } from "../rng";
import { GOAL_SCENARIOS, GOAL_SCENARIO_IDS, isGoalScenarioId } from "../scenarios";
import { DEFAULT_TRAIN_CONFIG, train, type BatchMetrics } from "../trainer";

const { values } = parseArgs({
  options: {
    scenario: { type: "string", default: "single" },
    episodes: { type: "string", default: String(DEFAULT_TRAIN_CONFIG.episodes) },
    batch: { type: "string", default: String(DEFAULT_TRAIN_CONFIG.batchSize) },
    lr: { type: "string", default: String(DEFAULT_TRAIN_CONFIG.learningRate) },
    seed: { type: "string", default: String(DEFAULT_TRAIN_CONFIG.seed) },
    eval: { type: "string", default: "50" },
    "check-every": { type: "string", default: "5" },
    out: { type: "string", default: "rl-runs" },
    init: { type: "string" },
  },
});

const scenarioId = values.scenario!;
if (!isGoalScenarioId(scenarioId)) {
  console.error(`Unknown scenario "${scenarioId}". Choose one of: ${GOAL_SCENARIO_IDS.join(", ")}`);
  process.exit(2);
}
const number = (name: string, text: string): number => {
  const n = Number(text);
  if (!Number.isFinite(n)) {
    console.error(`--${name} must be a number, got "${text}"`);
    process.exit(2);
  }
  return n;
};

const seed = number("seed", values.seed!);
const evalEpisodes = number("eval", values.eval!);
const checkEvery = number("check-every", values["check-every"]!);
const env = new GoalEnv(GOAL_SCENARIOS[scenarioId]);
const history: (BatchMetrics & { greedySuccess?: number })[] = [];

// Sampled training success understates the policy, and greedy performance can
// wobble late in training, so the best greedy checkpoint is kept as well.
const CHECK_EPISODES = 10;
const CHECK_FIRST_SEED = 20_000; // disjoint from training and final-evaluation seeds
let best: { policy: LinearSoftmaxPolicy; score: [number, number]; episodes: number } | null = null;

console.log(`Scenario ${scenarioId}: ${GOAL_SCENARIOS[scenarioId].description}`);
if (values.init) console.log(`Warm start from ${values.init}`);
const started = Date.now();
let batches = 0;
const { policy } = train(
  env,
  {
    episodes: number("episodes", values.episodes!),
    batchSize: number("batch", values.batch!),
    learningRate: number("lr", values.lr!),
    seed,
  },
  values.init ? LinearSoftmaxPolicy.fromJSON(JSON.parse(readFileSync(values.init, "utf8"))) : undefined,
  (m, current) => {
    batches++;
    let greedy = "";
    const row: BatchMetrics & { greedySuccess?: number } = m;
    if (checkEvery > 0 && batches % checkEvery === 0) {
      const check = evaluate(env, new PolicyAgent(current), CHECK_EPISODES, CHECK_FIRST_SEED);
      row.greedySuccess = check.successRate;
      const score: [number, number] = [check.successRate, check.meanReward];
      if (!best || score[0] > best.score[0] || (score[0] === best.score[0] && score[1] > best.score[1]))
        best = { policy: new LinearSoftmaxPolicy(Float64Array.from(current.weights)), score, episodes: m.episodes };
      greedy = `  greedy ${(check.successRate * 100).toFixed(0).padStart(3)}%`;
    }
    history.push(row);
    console.log(
      `episodes ${String(m.episodes).padStart(5)}  sampled ${(m.successRate * 100).toFixed(0).padStart(3)}%  ` +
        `return ${m.meanReturn.toFixed(2).padStart(6)}  steps ${m.meanSteps.toFixed(1).padStart(5)}  entropy ${m.entropy.toFixed(2)}${greedy}`,
    );
  },
);
console.log(`Trained in ${((Date.now() - started) / 1000).toFixed(1)} s`);

const baseline = evaluate(env, new RandomAgent(createRandom(seed)), evalEpisodes);
const finalPolicy = policy;
// `best` is assigned inside the training callback, which TypeScript cannot see.
const chosen = (best as { policy: LinearSoftmaxPolicy; episodes: number } | null) ?? { policy: finalPolicy, episodes: history.at(-1)?.episodes ?? 0 };
const trained = evaluate(env, new PolicyAgent(chosen.policy), evalEpisodes);
const final = evaluate(env, new PolicyAgent(finalPolicy), evalEpisodes);
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
console.log(`\nHeld-out evaluation over ${evalEpisodes} episodes`);
console.log(`  random   solved ${pct(baseline.successRate)}  mean reward ${baseline.meanReward.toFixed(2)}`);
console.log(`  final    solved ${pct(final.successRate)}  mean reward ${final.meanReward.toFixed(2)}  (policy after the last update)`);
console.log(
  `  best     solved ${pct(trained.successRate)}  mean reward ${trained.meanReward.toFixed(2)}  (checkpoint at episode ${chosen.episodes})` +
    (trained.meanSolvedCost === null ? "" : `  mean cost ${trained.meanSolvedCost.toFixed(0)}`),
);

const dir = join(values.out!, `${scenarioId}-seed${seed}`);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "policy.json"), JSON.stringify(chosen.policy, null, 2));
writeFileSync(join(dir, "policy-final.json"), JSON.stringify(finalPolicy, null, 2));
writeFileSync(
  join(dir, "history.csv"),
  ["episodes,sampledSuccess,meanReturn,meanSteps,entropy,greedySuccess", ...history.map((m) => `${m.episodes},${m.successRate},${m.meanReturn},${m.meanSteps},${m.entropy},${m.greedySuccess ?? ""}`)].join("\n") + "\n",
);
writeFileSync(join(dir, "evaluation.json"), JSON.stringify({ scenario: scenarioId, seed, random: baseline, best: trained, final, bestCheckpointEpisode: chosen.episodes }, null, 2));
console.log(`\nWrote ${dir}/{policy.json,policy-final.json,history.csv,evaluation.json}`);
