import { actionFeatures, ACTION_FEATURE_NAMES, kindBalancedPrior, stateContext } from "./features";
import { GoalEnv } from "./goalEnv";
import { GOAL_SCENARIOS, isGoalScenarioId } from "./scenarios";
import { BridgeRequestSchema } from "./schema";
import type { GoalAction, Observation, StepResult } from "./types";

export type BridgeResponse =
  | { id?: string | number; ok: true; result: unknown }
  | { id?: string | number; ok: false; error: string };

/**
 * Drives a `GoalEnv` from JSON requests, so an agent in any language (a Python
 * RL library, an LLM) can play the goal mode over a pipe. One session holds one
 * episode at a time. `handleLine` never throws: protocol and rule errors come
 * back as `{ ok: false, error }`.
 */
export class AgentBridge {
  private env: GoalEnv | null = null;
  private actions: GoalAction[] = [];
  private observation: Observation | null = null;

  handleLine(line: string): BridgeResponse {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return { ok: false, error: "Request is not valid JSON" };
    }
    const parsed = BridgeRequestSchema.safeParse(raw);
    const id =
      typeof raw === "object" && raw !== null && "id" in raw
        ? ((raw as { id?: string | number }).id)
        : undefined;
    if (!parsed.success)
      return { id, ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    try {
      return { id, ok: true, result: this.dispatch(parsed.data) };
    } catch (error) {
      return { id, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private dispatch({ method, params }: ReturnType<typeof BridgeRequestSchema.parse>): unknown {
    if (method === "reset") {
      const id = params.scenario ?? "single";
      if (!isGoalScenarioId(id)) throw new Error(`Unknown scenario ${id}`);
      this.env = new GoalEnv(GOAL_SCENARIOS[id]);
      this.observation = this.env.reset(params.seed ?? 0);
      return this.view(this.observation, params.features);
    }
    const env = this.requireEnv();
    if (method === "actions") return this.view(this.observation!, params.features);

    const action =
      params.action ??
      (params.actionIndex !== undefined ? this.actions[params.actionIndex] : undefined);
    if (!action) throw new Error("step needs a valid `action` or `actionIndex`");
    const result: StepResult = env.step(action);
    this.observation = result.observation;
    const over = result.done || result.truncated;
    return {
      reward: result.reward,
      done: result.done,
      truncated: result.truncated,
      info: result.info,
      ...(over ? { observation: result.observation, actions: [] } : this.view(result.observation, params.features)),
    };
  }

  private view(observation: Observation, withFeatures?: boolean) {
    const env = this.requireEnv();
    this.actions = env.legalActions();
    const ctx = stateContext(observation);
    return {
      scenario: env.scenario.id,
      observation,
      actions: this.actions,
      // A log-prior agents may add to their scores; see `kindBalancedPrior`.
      ...(withFeatures
        ? {
            featureNames: ACTION_FEATURE_NAMES,
            features: this.actions.map((a) => [...actionFeatures(ctx, a)]),
            prior: [...kindBalancedPrior(this.actions)],
          }
        : {}),
    };
  }

  private requireEnv(): GoalEnv {
    if (!this.env) throw new Error("Call reset first");
    return this.env;
  }
}
