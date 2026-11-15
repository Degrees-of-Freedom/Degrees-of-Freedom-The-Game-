import type { AnalysisSummary, RewardConfig } from "./types";
import type { VoxelAnalysis } from "../solver/voxel";
import type { GameModel } from "../game/model";
import { reach } from "./graph";

/**
 * Objectives a fully solved pick-up level reports: weights picked up, all parts
 * connected, stable, buckling, member checks, connections, foundations and
 * weight movement. A test pins this against the real analysis so a rules change
 * cannot silently skew the reward.
 */
export const PICKUP_OBJECTIVE_COUNT = 8;

export const DEFAULT_REWARD: RewardConfig = {
  reachWeight: 0.2,
  connectedWeight: 0.2,
  stableWeight: 0.2,
  objectiveWeight: 0.4,
  successBonus: 1,
  efficiencyBonus: 0.5,
  stepPenalty: 0.01,
  invalidPenalty: 0.05,
  unsolvedPenalty: 0.25,
};

/** Reduce the game's analysis to what the reward and agents need. */
export function summarizeAnalysis(
  analysis: VoxelAnalysis,
  model: GameModel,
  budget: number,
): AnalysisSummary {
  const targets = Object.keys(model.attrs).filter((k) => model.attrs[k].target);
  const floating = new Set(analysis.floating);
  return {
    error: analysis.error ?? null,
    targets: targets.length,
    // An errored analysis (nothing built, no foundation) connected nothing.
    connectedTargets: analysis.error
      ? 0
      : targets.filter((k) => !floating.has(k)).length,
    reach: reach(model),
    mechanism: analysis.mechanism,
    unstableShare: analysis.ctx?.NA ? Math.min(1, analysis.unstable.size / analysis.ctx.NA) : 0,
    unresolved: !!analysis.unresolved,
    objectivesPassed: analysis.objectives.filter((o) => o.ok).length,
    objectivesTotal: analysis.objectives.length,
    success: !!analysis.success && !analysis.error,
    cost: analysis.cost ?? 0,
    budget,
    stars: analysis.stars ?? 0,
  };
}

/**
 * Progress potential Φ(s) in [0, 1]. The per-step shaping reward is
 * Φ(s') − Φ(s), a potential difference, so it telescopes: shaping can speed up
 * learning but cannot change which policy is best.
 */
export function potential(a: AnalysisSummary, config: RewardConfig): number {
  if (a.error) return 0; // nothing supported yet, so reach is 0 too
  const connected = a.targets ? a.connectedTargets / a.targets : 0;
  // Graded: each joint that frees some nodes from a mechanism earns credit, so
  // a structure with several mechanisms gets a signal before all are fixed.
  const stable =
    a.connectedTargets > 0 && !a.unresolved
      ? a.mechanism
        ? Math.min(0.99, 1 - a.unstableShare)
        : 1
      : 0;
  // Several objectives pass vacuously while nothing is attached (a lone
  // foundation already passes 6 of 7), so scale them by how much is connected.
  const objectives =
    Math.min(1, a.objectivesPassed / PICKUP_OBJECTIVE_COUNT) * connected;
  return (
    config.reachWeight * a.reach +
    config.connectedWeight * connected +
    config.stableWeight * stable +
    config.objectiveWeight * objectives
  );
}

/** Bonus for solving, larger the more of the budget is left unspent. */
export function terminalReward(
  a: AnalysisSummary,
  outcome: "solved" | "unsolved" | "ongoing",
  config: RewardConfig,
): number {
  if (outcome === "ongoing") return 0;
  if (outcome === "unsolved") return -config.unsolvedPenalty;
  const unspent =
    Number.isFinite(a.budget) && a.budget > 0
      ? Math.max(0, 1 - a.cost / a.budget)
      : 0;
  return config.successBonus + config.efficiencyBonus * unspent;
}
