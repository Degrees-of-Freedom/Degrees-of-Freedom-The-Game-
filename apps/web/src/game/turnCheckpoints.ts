import { DEFAULT_SOLVE_EVERY_TURNS, SOLVE_EVERY_TURNS_RANGE } from "../multiplayer/checkpoints/types";
import { correctJointReleases } from "./nodeRepair";
import { assessTurnOutcome, type IssueMemory } from "./turnIssues";
import { decidePenalty } from "./turnPenalty";
import type { JointCorrection } from "./jointCorrections";
import { NODE_REPAIR_POLICY } from "./turnRepair";
import type { TurnReport, TurnState } from "./turns";

export const TURN_CHECKPOINT_POLICY = "turn-checkpoints-1" as const;
type Board = TurnState["board"];
type Draft = TurnState["draft"];
export type CheckpointReport = Omit<TurnReport, "status"> & {status: TurnReport["status"] | "pending"};

/** Public physical snapshots, never hands/decks. The original connection
 * printings and later system fittings stay in separate versioned layers. */
export interface PendingTurn {
  turn: number;
  playerId: string;
  boardBefore: Board;
  boardAfter: Board;
  draft: Draft;
  nextId: number;
}

export interface CheckpointAnalysis {
  turn: number;
  board: Board;
  nextId: number;
  modelId: string;
  status: Exclude<CheckpointReport["status"], "pending">;
}

export interface TurnCheckpointReceipt {
  id: string;
  policy: typeof TURN_CHECKPOINT_POLICY;
  repairPolicy: typeof NODE_REPAIR_POLICY;
  afterTurn: number;
  throughTurn: number;
  interval: number;
  settingVersion: number;
  final: boolean;
  attributedTurns: number[];
  unresolvedTurns: number[];
  penaltyIds: string[];
  correctionIds: string[];
}

export interface TurnCheckpoints {
  policy: typeof TURN_CHECKPOINT_POLICY;
  interval: number;
  settingVersion: number;
  settingLog: {version: number; interval: number; atTurn: number}[];
  completedTurns: number;
  lastAttemptTurn: number;
  lastVerifiedTurn: number;
  lastVerified?: CheckpointAnalysis;
  lastAnalysis?: CheckpointAnalysis;
  pending: PendingTurn[];
  receipts: TurnCheckpointReceipt[];
  memory: IssueMemory;
}

function assertInterval(interval: number) {
  if (!Number.isInteger(interval) || interval < SOLVE_EVERY_TURNS_RANGE.min || interval > SOLVE_EVERY_TURNS_RANGE.max)
    throw new RangeError(`Analysis interval must be a whole number from ${SOLVE_EVERY_TURNS_RANGE.min} to ${SOLVE_EVERY_TURNS_RANGE.max}.`);
}

export function createTurnCheckpoints(interval = DEFAULT_SOLVE_EVERY_TURNS): TurnCheckpoints {
  assertInterval(interval);
  return {policy:TURN_CHECKPOINT_POLICY, interval, settingVersion:0, settingLog:[], completedTurns:0,
    lastAttemptTurn:0, lastVerifiedTurn:0, pending:[], receipts:[], memory:{}};
}

/** Call only from a recorded settings event. It never solves or creates an
 * owed checkpoint. The new interval is evaluated at the next accepted End. */
export function changeTurnCheckpointInterval(checkpoints: TurnCheckpoints, interval: number) {
  assertInterval(interval);
  if (interval === checkpoints.interval) return checkpoints;
  const settingVersion = checkpoints.settingVersion + 1;
  return {...checkpoints, interval, settingVersion, settingLog:[...checkpoints.settingLog,
    {version:settingVersion, interval, atTurn:checkpoints.completedTurns}]};
}

/** After legality validation, retain the completed player transaction without
 * assessing it. A pass is a completed turn. Drawing/cancellation are not. */
export function queueTurnCheckpoint(state: TurnState, boardAfter: Board, checkpoints = createTurnCheckpoints(), final = false) {
  if (state.turn !== checkpoints.completedTurns + 1)
    throw new Error("The checkpoint turn does not follow its completed-turn history.");
  const playerId = state.players[state.playerIndex].id;
  const pending: PendingTurn = {turn:state.turn, playerId, boardBefore:state.board,
    boardAfter, draft:state.draft, nextId:state.nextId};
  const queued: TurnCheckpoints = {...checkpoints, completedTurns:state.turn,
    pending:[...checkpoints.pending,pending]};
  return {checkpoints:queued,
    due:final || queued.completedTurns - queued.lastAttemptTurn >= queued.interval,
    report:{turn:state.turn, playerId, status:"pending" as const, penalty:0 as const,
      reason:"Turn committed. Structural assessment is pending the next checkpoint."}};
}

const emptyDraft = (): Draft => ({members:[],connections:[],loads:[]});
function withCorrections(board: Board, corrections: JointCorrection[]): Board {
  return corrections.length ? {...board,jointCorrections:corrections} : board;
}

function correctedStatus(stability: (boolean | null)[] | undefined, fallback: CheckpointAnalysis["status"]): CheckpointAnalysis["status"] {
  if (!stability?.length) return fallback;
  if (stability.every(active => active === false)) return "stable";
  if (stability.some(active => active === false)) return "partial";
  return stability.some(active => active === true) ? "unstable" : "unresolved";
}

/** Attribute a due window oldest-first on each originating physical model.
 * Fittings accepted at one origin affect every later origin in the window.
 * Each turn is attributed at its first attempt only. Unknown results remain
 * explicit and cannot acquire a retroactive penalty at a later checkpoint.
 * The caller commits reports, board, receipt and emptied pending queue in the
 * same durable transaction. Calling again on the settled state is a no-op. */
export function resolveTurnCheckpoint(state: TurnState, checkpoints: TurnCheckpoints, final = false) {
  if (!checkpoints.pending.length) return {checkpoints, board:state.board, reports:state.reports as CheckpointReport[], receipt:undefined};
  const id = `${TURN_CHECKPOINT_POLICY}/${state.seed}/${checkpoints.completedTurns}`;
  if (checkpoints.receipts.some(receipt => receipt.id === id))
    throw new Error("An already recorded checkpoint cannot attribute a second pending window.");
  let corrections = [...(state.board.jointCorrections ?? [])];
  let reports: CheckpointReport[] = [...state.reports];
  let memory = checkpoints.memory;
  let lastVerified = checkpoints.lastVerified;
  let lastAnalysis = checkpoints.lastAnalysis;
  const attributed: CheckpointReport[] = [];
  for (const origin of checkpoints.pending) {
    const playerIndex = state.players.findIndex(player => player.id === origin.playerId);
    if (playerIndex < 0) throw new Error("A pending checkpoint turn has no matching player.");
    const turn: TurnState = {...state, turn:origin.turn, playerIndex, nextId:origin.nextId,
      board:withCorrections(origin.boardBefore,corrections), draft:origin.draft,
      reports:reports.filter(report => report.turn < origin.turn) as TurnReport[]};
    const outcome = assessTurnOutcome(turn,memory);
    const penaltyDecision = decidePenalty(turn,outcome.issues);
    const frozen: TurnState = {...turn, board:withCorrections(origin.boardAfter,corrections), draft:emptyDraft()};
    const repair = correctJointReleases(frozen,outcome.issues,origin.turn);
    corrections = [...((repair?.state ?? frozen).board.jointCorrections ?? [])];
    memory = repair?.receipt.memory ?? outcome.issues.memory;
    const report: CheckpointReport = {turn:origin.turn,playerId:origin.playerId,status:outcome.status,
      reason:{stable:"Verified component equilibrium.", unstable:"A physical instability was witnessed.",
        partial:"Only part of the structure has verified equilibrium.", unresolved:"Equilibrium could not be verified."}[outcome.status],
      penalty:penaltyDecision.event?.amount ?? 0,issues:outcome.issues,penaltyDecision,
      ...(repair && {correction:repair.receipt})};
    attributed.push(report);
    reports = [...reports.filter(previous => previous.turn !== origin.turn),report].sort((a,b) => a.turn-b.turn);
    const stability = repair?.receipt.changes.filter(change => change.category === "instability").map(change => change.after.active);
    const postStatus = correctedStatus(stability,outcome.status);
    lastAnalysis = {turn:origin.turn, board:withCorrections(origin.boardAfter,corrections),nextId:origin.nextId,
      modelId:repair?.receipt.afterModelId ?? outcome.issues.afterModelId,status:postStatus};
    if (postStatus === "stable") lastVerified = lastAnalysis;
  }
  const receipt: TurnCheckpointReceipt = {id,policy:TURN_CHECKPOINT_POLICY,repairPolicy:NODE_REPAIR_POLICY,
    afterTurn:checkpoints.lastAttemptTurn,throughTurn:checkpoints.completedTurns,interval:checkpoints.interval,
    settingVersion:checkpoints.settingVersion,final,attributedTurns:attributed.map(report => report.turn),
    unresolvedTurns:attributed.filter(report => report.status === "unresolved" || report.status === "partial").map(report => report.turn),
    penaltyIds:attributed.flatMap(report => report.penaltyDecision?.event ? [report.penaltyDecision.event.id] : []),
    correctionIds:corrections.filter(correction => correction.system.turn > checkpoints.lastAttemptTurn).map(correction => correction.system.objectId)};
  return {board:withCorrections(checkpoints.pending.at(-1)!.boardAfter,corrections),reports,receipt,
    checkpoints:{...checkpoints,pending:[],lastAttemptTurn:checkpoints.completedTurns,lastVerified,lastAnalysis,
      lastVerifiedTurn:lastVerified?.turn ?? 0,memory,receipts:[...checkpoints.receipts,receipt]} satisfies TurnCheckpoints};
}

/** Label checkpoint freshness from persisted history, without launching a solve.
 * lastAnalysis.board is the only compatible board for its overlays. */
export function turnCheckpointFreshness(checkpoints: TurnCheckpoints) {
  const last = checkpoints.lastAnalysis;
  const current = !!last && last.turn === checkpoints.completedTurns && !checkpoints.pending.length;
  return {state:current ? "current" as const : last ? "stale" as const : "none" as const,
    lastAnalyzedTurn:last?.turn ?? null,lastVerifiedTurn:checkpoints.lastVerified?.turn ?? null,
    nextAnalysisInTurns:Math.max(0,checkpoints.interval-(checkpoints.completedTurns-checkpoints.lastAttemptTurn)),
    pendingTurns:checkpoints.pending.map(turn => turn.turn),
    label:current ? `Analysed at turn ${last.turn}` : last ? `Last analysed at turn ${last.turn}; current structure awaits its checkpoint.`
      : "Not yet analysed. Current structure awaits its first checkpoint."};
}

type CheckpointTurn = Pick<TurnState,"turn" | "finished"> & {checkpoints?:TurnCheckpoints};
export function nextAnalysisInTurns(state: CheckpointTurn) {
  if (state.finished) return 0;
  const checkpoints = state.checkpoints ?? createTurnCheckpoints();
  return Math.min(17-state.turn,Math.max(1,checkpoints.interval-(checkpoints.completedTurns-checkpoints.lastAttemptTurn)));
}

/** Includes the current player turn's End. A final pass always flushes. */
export function checkpointDueForTurn(state: CheckpointTurn) {
  return !state.finished && (state.turn === 16 || nextAnalysisInTurns(state) === 1);
}
