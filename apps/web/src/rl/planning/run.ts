import { GoalEnv } from "../goalEnv";
import type { GoalAction, Observation } from "../types";
import { cloneModel, type Planner } from "./common";

export interface PlannerRun {
  planner: string;
  scenario: string;
  solved: boolean;
  cost: number;
  steps: number;
  invalidMoves: number;
  /** Time spent planning, not simulating. */
  planMs: number;
  actions: GoalAction[];
}

/**
 * Play a planner in the environment. It plans for the weights currently on the
 * board, executes the plan, waits while a later stage is pending and plans
 * again when new weights arrive. Success is the environment's verdict.
 */
export function runPlanner(
  env: GoalEnv,
  planner: Planner,
  seed = 0,
  /** Called with the state and the action about to be played, e.g. to record demonstrations. */
  onDecision?: (obs: Observation, action: GoalAction) => void,
): PlannerRun {
  let obs = env.reset(seed);
  const played: GoalAction[] = [];
  let planMs = 0;
  let invalidMoves = 0;
  let last = null as ReturnType<GoalEnv["step"]> | null;
  const queue: GoalAction[] = [];
  let rejectedPlans = 0;

  while (!last || !(last.done || last.truncated)) {
    if (!queue.length) {
      const started = performance.now();
      const plan = planner.plan(env.activeScenario, cloneModel(env.currentModel));
      planMs += performance.now() - started;
      queue.push(...plan.actions);
      if (!queue.length) {
        // Nothing left to build: wait for the next stage, or give up.
        const waiting = env.legalActions().some((a) => a.kind === "wait");
        queue.push(waiting ? { kind: "wait" } : { kind: "finish" });
      }
    }
    const action = queue.shift()!;
    onDecision?.(obs, action);
    played.push(action);
    last = env.step(action);
    obs = last.observation;
    if (last.info.invalid) {
      invalidMoves++;
      queue.length = 0; // the plan no longer matches the board; plan again
      // A planner that keeps proposing what the rules reject has nothing more to offer.
      if (++rejectedPlans >= 3) queue.push({ kind: "finish" });
    }
  }
  return {
    planner: planner.name,
    scenario: env.scenario.id,
    solved: last.info.analysis.success,
    cost: last.info.analysis.cost,
    steps: played.length,
    invalidMoves,
    planMs,
    actions: played,
  };
}
