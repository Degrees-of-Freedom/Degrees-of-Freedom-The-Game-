import { initialModel } from "../game/layout";
import { parseNodeKey, type GameModel } from "../game/model";
import { analyzeVoxel } from "../solver/voxel";
import { ActionEnumerator, applyAction } from "./actions";
import { DEFAULT_REWARD, potential, summarizeAnalysis, terminalReward } from "./reward";
import { createRandom } from "./rng";
import type {
  AnalysisSummary,
  GoalAction,
  GoalScenario,
  LaterStage,
  Observation,
  RewardConfig,
  StepResult,
} from "./types";

/**
 * Headless "Load in space" game for agents. It reuses the game's placement
 * rules and structural analysis, with no React, store or renderer, so it runs
 * in Node and under test. The interface is Gym-like: `reset` then `step`
 * until `done` or `truncated`. Episodes are deterministic for a given seed.
 */
export class GoalEnv {
  private model: GameModel = { members: [], attrs: {}, nextId: 1 };
  private summary!: AnalysisSummary;
  /** Weights with a path to a foundation, from the latest analysis. */
  private connected = new Set<string>();
  private stepCount = 0;
  private finished = true;
  private cachedActions: GoalAction[] | null = null;
  /** Stages that have not arrived yet. */
  private pending: LaterStage[] = [];
  /** The latest analysis passed every check, ignoring pending stages. */
  private stageSolved = false;

  private readonly enumerator: ActionEnumerator;

  constructor(
    readonly scenario: GoalScenario,
    private readonly reward: RewardConfig = DEFAULT_REWARD,
  ) {
    this.enumerator = new ActionEnumerator(scenario.level, {
      memberTypes: scenario.memberTypes,
      zones: scenario.zones,
    });
  }

  /** Start a new episode. Only random scenarios use the seed for their loads. */
  reset(seed = 0): Observation {
    const { level, randomLoads } = this.scenario;
    this.model = initialModel(level, randomLoads ? createRandom(seed) : undefined);
    this.stepCount = 0;
    this.finished = false;
    this.cachedActions = null;
    this.pending = [...(this.scenario.laterStages ?? [])];
    this.summary = this.analyze();
    return this.observe();
  }

  /** Legal actions for the current state; stable order, `finish` first. */
  legalActions(): GoalAction[] {
    this.requireActive();
    this.cachedActions ??= this.enumerator.enumerate(this.model, {
      canWait: this.pending.length > 0,
    });
    return this.cachedActions;
  }

  /** Apply an action. Illegal actions leave the model unchanged and are penalised. */
  step(action: GoalAction): StepResult {
    this.requireActive();
    const before = potential(this.summary, this.reward);
    const rejected = this.rejection(action);
    let invalid: string | null = rejected;
    if (!rejected) {
      const result = applyAction(this.scenario.level, this.model, action, this.scenario.zones);
      invalid = result.issue;
      if (!invalid && action.kind === "wait" && !this.pending.length)
        invalid = "There is nothing to wait for";
      if (!invalid) {
        this.model = result.model;
        this.cachedActions = null;
        this.summary = this.analyze();
      }
    }
    this.stepCount++;

    // The potential gained is measured before any new stage arrives, so a new
    // weight's drop in progress is not charged to the action just taken.
    const shaping = potential(this.summary, this.reward) - before;
    let stageBonus = 0;
    const arrived = this.pending.filter((s) => s.atStep <= this.stepCount);
    if (arrived.length) {
      // Holding a working structure when the next part arrives is rewarded.
      if (this.stageSolved) stageBonus = this.reward.stageBonus;
      this.pending = this.pending.filter((s) => s.atStep > this.stepCount);
      this.addWeights(arrived.flatMap((s) => s.weights));
      this.cachedActions = null;
      this.summary = this.analyze();
    }

    const solved = this.summary.success;
    const gaveUp = action.kind === "finish";
    const truncated = !solved && !gaveUp && this.stepCount >= this.scenario.maxSteps;
    this.finished = solved || gaveUp || truncated;
    const outcome = solved ? "solved" : this.finished ? "unsolved" : "ongoing";

    const terminal = terminalReward(this.summary, outcome, this.reward) + stageBonus;
    const reward =
      shaping +
      terminal -
      this.reward.stepPenalty -
      (invalid ? this.reward.invalidPenalty : 0);
    return {
      observation: this.observe(),
      reward,
      done: solved || gaveUp,
      truncated,
      info: { invalid, analysis: this.summary, shaping, terminal },
    };
  }

  /** The model as the game would hold it. Callers must not mutate it. */
  get currentModel(): Readonly<GameModel> {
    return this.model;
  }

  private rejection(action: GoalAction): string | null {
    if (
      action.kind === "member" &&
      !this.scenario.memberTypes.includes(action.type)
    )
      return `${action.type} is not available in this scenario`;
    return null;
  }

  private analyze(): AnalysisSummary {
    const { level } = this.scenario;
    const analysis = analyzeVoxel(this.model, level);
    const floating = new Set(analysis.floating);
    this.connected = new Set(
      analysis.error
        ? []
        : Object.keys(this.model.attrs).filter(
            (k) => this.model.attrs[k].target && !floating.has(k),
          ),
    );
    const summary = summarizeAnalysis(analysis, this.model, level.budget);
    this.stageSolved = summary.success;
    // Solved means every stage has arrived and the whole structure passes.
    return { ...summary, success: summary.success && this.pending.length === 0 };
  }

  private addWeights(weights: readonly (readonly number[])[]): void {
    for (const [i, j, k, kN] of weights)
      this.model.attrs[`${i},${j},${k}`] = { load: kN, locked: true, target: true };
  }

  private observe(): Observation {
    const { level, memberTypes } = this.scenario;
    const weights = Object.entries(this.model.attrs).filter(([, a]) => a.target);
    const remaining: Record<string, number> = {};
    const used = (pred: (t: string) => boolean) =>
      this.model.members.filter((m) => pred(m.type)).length;
    for (const type of [...memberTypes, "joint", "found"] as const) {
      const supply = level.inv === null ? Infinity : (level.inv[type] ?? 0);
      remaining[type] =
        supply -
        (type === "joint"
          ? Object.values(this.model.attrs).filter((a) => a.joint).length
          : type === "found"
            ? Object.values(this.model.attrs).filter((a) => a.found && !a.locked).length
            : used((t) => t === type));
    }
    return {
      step: this.stepCount,
      maxSteps: this.scenario.maxSteps,
      pendingStages: this.pending.length,
      model: structuredClone(this.model),
      targets: weights.map(([key, attrs]) => ({
        key,
        at: parseNodeKey(key),
        kN: attrs.load ?? 0,
        connected: this.connected.has(key),
      })),
      analysis: this.summary,
      remaining,
    };
  }

  private requireActive(): void {
    if (this.finished)
      throw new Error("Episode is over; call reset() to start another.");
  }
}

