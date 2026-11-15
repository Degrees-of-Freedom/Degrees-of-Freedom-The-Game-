/**
 * Run planners (and optionally a saved policy) on goal scenarios and print a
 * table of whether each solved it, at what cost, and how long it took.
 *
 *   npm run compare:goal -- --scenarios single,staged --policy rl-runs/staged-seed1/policy.json
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { evaluate, PolicyAgent } from "../agents";
import { GoalEnv } from "../goalEnv";
import { LinearSoftmaxPolicy } from "../policy";
import { ErosionPlanner } from "../planning/erosionPlanner";
import { GraphPlanner } from "../planning/graphPlanner";
import { PortfolioPlanner } from "../planning/portfolioPlanner";
import type { Planner } from "../planning/common";
import { runPlanner } from "../planning/run";
import { GOAL_SCENARIO_IDS, GOAL_SCENARIOS, isGoalScenarioId } from "../scenarios";

const { values } = parseArgs({
  options: {
    scenarios: { type: "string", default: GOAL_SCENARIO_IDS.filter((id) => id !== "pickupR").join(",") },
    policy: { type: "string" },
  },
});

const ids = values.scenarios!.split(",").filter(Boolean);
const unknown = ids.filter((id) => !isGoalScenarioId(id));
if (unknown.length) {
  console.error(`Unknown scenario(s): ${unknown.join(", ")}. Choose from: ${GOAL_SCENARIO_IDS.join(", ")}`);
  process.exit(2);
}
const policy = values.policy
  ? new PolicyAgent(LinearSoftmaxPolicy.fromJSON(JSON.parse(readFileSync(values.policy, "utf8"))))
  : null;

const rows: string[][] = [["scenario", "solver", "solved", "cost", "steps", "invalid", "seconds"]];
for (const id of ids) {
  if (!isGoalScenarioId(id)) continue;
  const env = new GoalEnv(GOAL_SCENARIOS[id]);
  const planners: Planner[] = [new GraphPlanner(), new ErosionPlanner(), new PortfolioPlanner()];
  for (const planner of planners) {
    const run = runPlanner(env, planner, 0);
    rows.push([id, planner.name, String(run.solved), String(run.cost), String(run.steps), String(run.invalidMoves), (run.planMs / 1000).toFixed(1)]);
  }
  if (policy) {
    const started = performance.now();
    const result = evaluate(env, policy, 1, 0);
    rows.push([id, "policy", String(result.successRate === 1), String(result.meanSolvedCost ?? "-"), result.meanSteps.toFixed(0), "-", ((performance.now() - started) / 1000).toFixed(1)]);
  }
}
const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
for (const row of rows) console.log(row.map((cell, c) => cell.padEnd(widths[c])).join("  "));
