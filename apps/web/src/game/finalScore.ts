import { z } from "zod";
import { RUST_TURN_ENGINE, type TurnState } from "./turns";
import type { StructureEvaluation } from "../evaluator/results";
import { CABLE_FORMULATION, RELEASE_SOLVER, RELEASE_SOLVERS, isReleaseSolver, verifiedResponse } from "../evaluator/evidence";
import { analysisLoadJoint } from "./turnPorts";

export const SCORE_POLICY = "signed-card-gravity-v1";
export const TIE_TOLERANCE = 0.01;
export const NEUTRAL_OWNER = "neutral";

const supportEvidence = z.strictObject({
  jointId: z.string().min(1),
  upwardKN: z.number().finite().nullable(),
});
const residual = z.number().finite().nonnegative();
const residualsSchema = z.strictObject({
  force: residual, moment: residual, nodalBalance: residual, memberLaw: residual,
  compatibility: residual, releasedAction: residual,
});
const componentEvidence = z.strictObject({
  nodes: z.array(z.string().min(1)).max(2048),
  memberIds: z.array(z.number().int()).max(2048),
  verified: z.boolean(),
  reason: z.string().min(1).max(512),
  residuals: residualsSchema.optional(),
  nonlinear: z.strictObject({force: residual, moment: residual, residual}).optional(),
  foundations: z.array(supportEvidence).max(2048),
});
const receiptSchema = z.strictObject({
  policy: z.literal(SCORE_POLICY),
  solver: z.enum(["voxel-linear-frame-v1", CABLE_FORMULATION, ...RELEASE_SOLVERS]),
  modelId: z.string(),
  components: z.array(componentEvidence).min(1).max(2048),
});
export type ScoreReceipt = z.infer<typeof receiptSchema>;
type ScopeEvidence = z.infer<typeof componentEvidence>;
type FinalBoard = TurnState["board"];

/** Deterministic model fingerprint binds the saved receipt to the replayed
 * catalogue, reference topology, loads, seat order and originating final turn. */
function modelId(turn: TurnState) {
  const signature = JSON.stringify([turn.catalogue, turn.seed, turn.turn, turn.players.map(p => p.id), turn.board]);
  let hash = 2166136261;
  for (let i = 0; i < signature.length; i++) hash = Math.imul(hash ^ signature.charCodeAt(i), 16777619);
  return `${turn.seed}/${turn.turn}/${(hash >>> 0).toString(16)}`;
}

function unknownScope(turn: TurnState, reason: string): ScopeEvidence {
  const board = turn.board;
  return {
    nodes: [...new Set([...board.joints.map(j => j.id), ...board.loads.map(l => analysisLoadJoint(turn, l.jointId))])],
    memberIds: board.members.map(m => m.id),
    verified: false,
    reason,
    foundations: board.joints.filter(j => j.foundationOwner).map(j => ({ jointId: j.id, upwardKN: null })),
  };
}

/** Only an independently checked component contributes signed physical reactions. */
function solverFor(turn: TurnState) {
  return turn.catalogue === "grow-dusk-release-1" || turn.engine === RUST_TURN_ENGINE ? RELEASE_SOLVER :
    turn.board.members.some(m => m.restLengthM !== undefined) ? CABLE_FORMULATION : "voxel-linear-frame-v1";
}

export function finalReceipt(turn: TurnState, analysis: StructureEvaluation | null): ScoreReceipt {
  const combo = analysis?.combos[0];
  const ctx = analysis?.ctx;
  const scopes = combo?.components;
  const board = turn.board;
  const receipt = (components: ScopeEvidence[]): ScoreReceipt => ({
    policy: SCORE_POLICY, solver: solverFor(turn), modelId: modelId(turn), components,
  });
  if (!ctx || !combo || !scopes?.length) {
    return receipt([unknownScope(turn, analysis?.error ?? "Final card-gravity response unavailable.")]);
  }
  const components = scopes.map(scope => {
    const foundations = board.joints.filter(j => j.foundationOwner && scope.nodes.includes(j.id));
    let verified = scope.status === "computed" && verifiedResponse(scope.verification);
    const forces = foundations.map(j => {
      const index = ctx.idx.get(j.id);
      const upward = index === undefined ? undefined : combo.reac?.[ctx.aid[index]]?.[2];
      if (upward === undefined || !Number.isFinite(upward)) verified = false;
      return { jointId: j.id, upwardKN: upward ?? null };
    });
    return {
      nodes: scope.nodes, memberIds: scope.memberIds, verified,
      reason: verified ? (scope.excessiveDeformation ? "Verified nonlinear equilibrium with excessive displacement."
        : scope.verification?.status === "verified-nonlinear" ? "Verified nonlinear equilibrium." : scope.verification?.status === "verified-cable" ? "Verified cable equilibrium and frame response." : "Verified linear frame response.") : scope.verification?.reason ?? scope.reason ?? "Response unavailable.",
      ...(scope.verification?.residuals && { residuals: scope.verification.residuals }),
      ...(scope.verification?.nonlinear && { nonlinear: scope.verification.nonlinear }),
      foundations: forces.map(f => ({ jointId: f.jointId, upwardKN: verified ? f.upwardKN : null })),
    };
  });
  const result = receipt(components);
  return readFinalReceipt(turn, result) ?? receipt([unknownScope(turn, "Incomplete final reaction evidence.")]);
}

/** Validate the receipt against the reconstructed board without rerunning
 * physics, consuming cards or silently updating a finalized result. */
export function readFinalReceipt(turn: TurnState, raw: unknown): ScoreReceipt | null {
  const parsed = receiptSchema.safeParse(raw);
  if (!parsed.success || parsed.data.modelId !== modelId(turn)) return null;
  const { board } = turn;
  // A Rust receipt keeps the id of the release solver that wrote it.
  const expected = solverFor(turn);
  if (parsed.data.solver !== expected && !(expected === RELEASE_SOLVER && isReleaseSolver(parsed.data.solver))) return null;
  const foundations = new Map(board.joints.filter(j => j.foundationOwner).map(j => [j.id, j.foundationOwner]));
  const seen = new Set<string>();
  const seenSupports = new Set<string>();
  for (const scope of parsed.data.components) {
    if (scope.verified && isReleaseSolver(parsed.data.solver)) {
      if (!scope.nonlinear || Math.max(...Object.values(scope.nonlinear)) > 1e-5) return null;
    } else if (scope.verified) {
      const r = scope.residuals;
      if (!r || Math.max(r.force, r.moment, r.nodalBalance, r.memberLaw, r.releasedAction) > 1e-5 ||
        r.compatibility > 1e-9) return null;
    }
    for (const key of scope.nodes) {
      if (seen.has(key)) return null;
      seen.add(key);
    }
    const weight = board.loads.reduce((sum, l) => sum + (scope.nodes.includes(analysisLoadJoint(turn,l.jointId)) ? l.magnitude : 0), 0);
    let sumUp = 0;
    for (const support of scope.foundations) {
      if (!foundations.has(support.jointId) || !scope.nodes.includes(support.jointId) || seenSupports.has(support.jointId)) return null;
      if ((support.upwardKN !== null) !== scope.verified) return null;
      seenSupports.add(support.jointId);
      if (support.upwardKN !== null) sumUp += support.upwardKN;
    }
    if (scope.verified && Math.abs(sumUp - weight) > 1e-5 * Math.max(weight, 1e-3)) return null;
  }
  if (seenSupports.size !== foundations.size || board.loads.some(l => !seen.has(analysisLoadJoint(turn,l.jointId)))) return null;
  return parsed.data;
}

export interface PlayerAward {
  playerId: string;
  awardedShare: number;
  penaltyPoints: number;
  finalScore: number;
}
export interface FinalScore {
  receipt: ScoreReceipt;
  awards: PlayerAward[];
  winners: string[];
  totalGravityKN: number;
  unknownGravityKN: number;
  neutralShare: number;
  partial: boolean;
}

const savedFinal = z.strictObject({
  receipt: receiptSchema, awards: z.array(z.strictObject({
    playerId: z.string(), awardedShare: z.number().finite(), penaltyPoints: z.number().int().nonnegative(), finalScore: z.number().finite(),
  })).max(4), winners: z.array(z.string()).max(4), totalGravityKN: z.number().finite(),
  unknownGravityKN: z.number().finite(), neutralShare: z.number().finite(), partial: z.boolean(),
});

/** A replayed Rust award keeps the solver id of the saved award it
 * reproduces, when that id is an accepted release solver: the record still
 * names the solver that wrote it. The evidence itself is compared in full. */
export function withSavedReleaseSolver(score: FinalScore, saved: unknown): FinalScore {
  const id = (saved as { receipt?: { solver?: unknown } } | null | undefined)?.receipt?.solver;
  return score.receipt.solver === RELEASE_SOLVER && isReleaseSolver(id) ? { ...score, receipt: { ...score.receipt, solver: id } } : score;
}

export function recoverFinalScore(turn: TurnState, raw: unknown): FinalScore | null {
  const stored = savedFinal.safeParse(raw);
  if (!stored.success) return null;
  const receipt = readFinalReceipt(turn, stored.data.receipt);
  if (!receipt) return null;
  const expected = awardFinalScore(turn, receipt);
  // Compare the canonical schema projection, insensitive to imported object key order.
  return JSON.stringify(savedFinal.parse(expected)) === JSON.stringify(stored.data) ? expected : null;
}

export function awardFinalScore(turn: TurnState, receipt: ScoreReceipt): FinalScore {
  const { board } = turn;
  const totalGravityKN = board.loads.reduce((sum, l) => sum + l.magnitude, 0);
  const share = (kn: number) => totalGravityKN === 0 ? 0 : 100 * kn / totalGravityKN;
  const owner = new Map(board.joints.map(j => [j.id, j.foundationOwner]));
  const credited = new Map<string, number>();
  let unknownGravityKN = 0;
  for (const scope of receipt.components) {
    if (!scope.verified) {
      unknownGravityKN += board.loads.reduce((sum, l) => sum + (scope.nodes.includes(analysisLoadJoint(turn,l.jointId)) ? l.magnitude : 0), 0);
      continue;
    }
    for (const { jointId, upwardKN } of scope.foundations) {
      const id = owner.get(jointId);
      if (id && upwardKN !== null) credited.set(id, (credited.get(id) ?? 0) + upwardKN);
    }
  }
  const awards = turn.players.map(player => {
    const awardedShare = share(credited.get(player.id) ?? 0);
    const penaltyPoints = turn.reports.reduce((sum, r) => sum + (r.playerId === player.id ? Math.abs(r.penalty) : 0), 0);
    return { playerId: player.id, awardedShare, penaltyPoints, finalScore: awardedShare - penaltyPoints };
  });
  const highest = Math.max(...awards.map(a => a.finalScore));
  // At the inclusive boundary decimal scores can differ by a few binary ulps.
  const roundoff = 2 * Number.EPSILON * Math.max(1, Math.abs(highest));
  const winners = awards.filter(a => highest - a.finalScore <= TIE_TOLERANCE + roundoff).map(a => a.playerId);
  return { receipt, awards, winners, totalGravityKN, unknownGravityKN, neutralShare: share(credited.get(NEUTRAL_OWNER) ?? 0),
    partial: receipt.components.some(scope => !scope.verified) };
}
