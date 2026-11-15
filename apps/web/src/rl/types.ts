import type { GameModel, GridPoint, Level, MemberType } from "../game/model";
import type { VoxelAnalysis } from "../solver/voxel";
import type { Random } from "./rng";

/**
 * Actions an agent may take in the goal ("Load in space") mode. The set is
 * add-only: placed pieces are never removed, which keeps episodes finite and
 * mirrors a player who builds toward the goal. The game's own placement rules
 * (`memberIssue`, `nodeItemIssue`) decide what is legal.
 */
export type GoalAction =
  | { kind: "foundation"; at: GridPoint }
  | { kind: "member"; a: GridPoint; b: GridPoint; type: MemberType }
  | { kind: "joint"; at: GridPoint }
  /** Let a step pass without building; only offered while a later stage is pending. */
  | { kind: "wait" }
  /** Declare the structure finished; ends the episode. */
  | { kind: "finish" };

export type GoalActionKind = GoalAction["kind"];

/**
 * A box (grid units, inclusive) that no member or node may touch. Keep-out
 * zones are a scenario rule for agents; the game's editor has no such rule.
 */
export interface KeepOutZone {
  id: string;
  min: GridPoint;
  max: GridPoint;
}

/** Weights that appear once `atStep` actions have been taken ("wait" stage). */
export interface LaterStage {
  atStep: number;
  /** Weights as [i, j, k, kN], like `Level.loads`. */
  weights: readonly [number, number, number, number][];
}

/** What one episode of a randomised scenario contains. */
export interface EpisodeLayout {
  /** Weights present from the start, as [i, j, k, kN]. */
  weights: readonly [number, number, number, number][];
  laterStages: readonly LaterStage[];
  zones: readonly KeepOutZone[];
}

/** A goal level plus the episode limits an agent plays under. */
export interface GoalScenario {
  id: string;
  description: string;
  level: Level;
  /** Hard cap on actions before the episode is truncated. */
  maxSteps: number;
  /** Member sections the agent may place (still limited by level supply). */
  memberTypes: readonly MemberType[];
  /** Draw loads from the seed rather than the level's fixed list. */
  randomLoads: boolean;
  /** Regions the structure must avoid. */
  zones?: readonly KeepOutZone[];
  /**
   * Later parts of the goal. The episode is solved only once every stage has
   * arrived and the whole structure passes, so an agent must hold a working
   * structure and then extend it.
   */
  laterStages?: readonly LaterStage[];
  /**
   * Draw weights, stages and zones from the episode seed instead of using the
   * fixed `laterStages`/`zones`/level loads, to test layouts not seen in training.
   */
  layout?: (random: Random) => EpisodeLayout;
}

/** Weights of the reward terms. See `reward.ts` for the exact definition. */
export interface RewardConfig {
  /** Share from the supported structure closing in on unconnected weights. */
  reachWeight: number;
  /** Share of the potential from targets connected to a foundation. */
  connectedWeight: number;
  /** Share from the structure being stable (no mechanism, solvable). */
  stableWeight: number;
  /** Share from passing the level's objective checks. */
  objectiveWeight: number;
  /** Bonus when the level is solved. */
  successBonus: number;
  /** Extra bonus scaled by unspent budget when the level is solved. */
  efficiencyBonus: number;
  /** Bonus for having the current stage solved when the next one arrives. */
  stageBonus: number;
  /** Cost of every action, encouraging short solutions. */
  stepPenalty: number;
  /** Cost of choosing an action the rules reject. */
  invalidPenalty: number;
  /** Extra cost when the episode ends unsolved (timeout or giving up). */
  unsolvedPenalty: number;
}

/** Compact, serialisable summary of one analysis for agents and logs. */
export interface AnalysisSummary {
  /** The analysis could not run (nothing built, no foundation). */
  error: string | null;
  targets: number;
  connectedTargets: number;
  /** Mean closeness of supported structure to each weight, in [0, 1]. */
  reach: number;
  mechanism: boolean;
  /** Share of analysed nodes that can move freely, in [0, 1]; 0 when stable. */
  unstableShare: number;
  unresolved: boolean;
  objectivesPassed: number;
  objectivesTotal: number;
  success: boolean;
  /** Level cost units spent so far, and the level budget. */
  cost: number;
  budget: number;
  stars: number;
}

export interface TargetStatus {
  key: string;
  at: GridPoint;
  kN: number;
  connected: boolean;
}

export interface Observation {
  step: number;
  maxSteps: number;
  /** Stages that have not arrived yet. */
  pendingStages: number;
  model: GameModel;
  targets: TargetStatus[];
  analysis: AnalysisSummary;
  /** Supply left for each member type the scenario allows, then joints and foundations. */
  remaining: Record<string, number>;
}

export interface StepInfo {
  /** Reason the chosen action was rejected, if it was. */
  invalid: string | null;
  analysis: AnalysisSummary;
  /** Potential-based part of the reward (Φ after − Φ before). */
  shaping: number;
  /** Terminal bonus/penalty part of the reward. */
  terminal: number;
}

export interface StepResult {
  observation: Observation;
  reward: number;
  /** The goal was met or the agent finished. */
  done: boolean;
  /** The step cap was reached. */
  truncated: boolean;
  info: StepInfo;
}

/** Full analysis is exposed for tools that need member forces. */
export type { VoxelAnalysis };
