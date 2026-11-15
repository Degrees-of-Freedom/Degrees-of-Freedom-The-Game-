/**
 * When a checkpoint is due.
 *
 * Pure functions over a persistable state. Nothing here solves anything: a
 * committed turn either yields a due checkpoint for the caller to run, or it
 * does not. Placement, drawing, inspection and pointer movement never reach
 * this module, so they cannot cause a solve.
 *
 * Rules (criteria section 3):
 * - Committed player turns are counted across the table; a pass counts.
 * - A checkpoint is due when the turns since the last ATTEMPT reach the
 *   interval, and always when the match ends. A final turn that is also due
 *   by interval gives one checkpoint, not two.
 * - Changing the interval never starts a solve. It applies at the next
 *   committed turn; a reduced interval that is already exceeded is due then.
 * - A failed attempt still moves the attempt marker, so failure does not
 *   retry every turn. The verified marker moves only on verified work, and
 *   turns that were not settled stay pending for the next checkpoint.
 */

import { z } from 'zod';
import { DEFAULT_SOLVE_EVERY_TURNS, SOLVE_EVERY_TURNS_RANGE, type CheckpointRequest, type CheckpointResult, type PenaltyRecord, type SafetyRestraint } from './types';

const id = z.string().min(1);
const count = z.number().int().nonnegative();
const interval = z.number().int().min(SOLVE_EVERY_TURNS_RANGE.min).max(SOLVE_EVERY_TURNS_RANGE.max);
const due = z.strictObject({
  checkpointId: id,
  reason: z.enum(['interval', 'final']),
  dueByInterval: z.boolean(),
  window: z.strictObject({ afterTurn: count, throughTurn: count, baselineRevision: id, solveEveryTurns: interval, settingVersion: count }),
  /** Turns the checkpoint must attribute, oldest first. */
  pendingTurnIds: z.array(id),
});
const scheduleSchema = z.strictObject({
  format: z.literal('dof-checkpoint-schedule'),
  schemaVersion: z.literal(1),
  matchId: id,
  setupRevision: id,
  solveEveryTurns: interval,
  /** Rises by one with every interval change. */
  settingVersion: count,
  /** Public log of interval changes. */
  settingLog: z.array(z.strictObject({ settingVersion: count, from: interval, to: interval, atTurn: count })),
  completedTurns: count,
  /** Committed turns no verified checkpoint has attributed yet. */
  pendingTurns: z.array(z.strictObject({ turnId: id, turnNumber: count, playerId: id })),
  lastAttempt: z.strictObject({ checkpointId: id, throughTurn: count, settingVersion: count, status: z.enum(['completed', 'partial', 'failed']), verified: z.boolean() }).nullable(),
  lastVerified: z.strictObject({ checkpointId: id, throughTurn: count, revision: id }).nullable(),
  /** A checkpoint that is owed and has no recorded outcome yet. Survives quit and reload. */
  due: due.nullable(),
  finalized: z.boolean(),
});

export type ScheduleState = z.infer<typeof scheduleSchema>;
export type CheckpointDue = z.infer<typeof due>;

/** Validate a persisted schedule. Throws on anything malformed. */
export const parseScheduleState = (value: unknown): ScheduleState => scheduleSchema.parse(value);

export function isSupportedInterval(value: unknown): value is number {
  return interval.safeParse(value).success;
}

export function createSchedule(init: { matchId: string; setupRevision: string; solveEveryTurns?: number }): ScheduleState {
  return scheduleSchema.parse({
    format: 'dof-checkpoint-schedule', schemaVersion: 1,
    matchId: init.matchId, setupRevision: init.setupRevision,
    solveEveryTurns: init.solveEveryTurns ?? DEFAULT_SOLVE_EVERY_TURNS,
    settingVersion: 0, settingLog: [], completedTurns: 0, pendingTurns: [],
    lastAttempt: null, lastVerified: null, due: null, finalized: false,
  });
}

/**
 * Record a new interval from Settings. Returns the state unchanged for the
 * current value and throws a `RangeError` for an unsupported one. Never makes
 * a checkpoint due: the new value is first consulted by `commitTurn`.
 */
export function changeInterval(state: ScheduleState, solveEveryTurns: number): ScheduleState {
  if (!isSupportedInterval(solveEveryTurns)) {
    throw new RangeError(`solveEveryTurns must be a whole number from ${SOLVE_EVERY_TURNS_RANGE.min} to ${SOLVE_EVERY_TURNS_RANGE.max}.`);
  }
  if (solveEveryTurns === state.solveEveryTurns) return state;
  const settingVersion = state.settingVersion + 1;
  return {
    ...state, solveEveryTurns, settingVersion,
    settingLog: [...state.settingLog, { settingVersion, from: state.solveEveryTurns, to: solveEveryTurns, atTurn: state.completedTurns }],
  };
}

function makeDue(state: ScheduleState, reason: 'interval' | 'final', dueByInterval: boolean): CheckpointDue {
  return {
    checkpointId: `${state.matchId}:checkpoint:${state.completedTurns}`,
    reason, dueByInterval,
    window: {
      afterTurn: state.lastVerified?.throughTurn ?? 0,
      throughTurn: state.completedTurns,
      baselineRevision: state.lastVerified?.revision ?? state.setupRevision,
      solveEveryTurns: state.solveEveryTurns,
      settingVersion: state.settingVersion,
    },
    pendingTurnIds: state.pendingTurns.map(turn => turn.turnId),
  };
}

const sinceAttempt = (state: ScheduleState) => state.completedTurns - (state.lastAttempt?.throughTurn ?? 0);

/**
 * Count one successfully committed player turn. Cancelled drafts, readiness
 * and retries must not be passed here. `final` marks the turn that ends the
 * match. Returns the checkpoint that is now due, or `null`.
 */
export function commitTurn(
  state: ScheduleState,
  turn: { turnId: string; playerId: string },
  options: { final?: boolean } = {},
): { state: ScheduleState; due: CheckpointDue | null } {
  if (state.finalized) throw new Error('The match is finalized; no further turn can be committed.');
  if (state.pendingTurns.some(pending => pending.turnId === turn.turnId)) throw new Error(`Turn ${turn.turnId} is already committed.`);
  const completedTurns = state.completedTurns + 1;
  const next: ScheduleState = { ...state, completedTurns, pendingTurns: [...state.pendingTurns, { ...turn, turnNumber: completedTurns }] };
  const byInterval = sinceAttempt(next) >= next.solveEveryTurns;
  // A checkpoint that is still owed is extended to this turn, never dropped.
  if (!options.final && !byInterval && !state.due) return { state: next, due: null };
  const owed = makeDue(next, options.final || state.due?.reason === 'final' ? 'final' : 'interval', byInterval || !!state.due?.dueByInterval);
  return { state: { ...next, due: owed }, due: owed };
}

/**
 * The final checkpoint of a match that ends without a further turn. Returns
 * `null` once the match is finalized, so asking twice cannot solve twice.
 * Quit is not a match end and must not call this.
 */
export function finalize(state: ScheduleState): { state: ScheduleState; due: CheckpointDue | null } {
  if (state.finalized) return { state, due: null };
  const owed = makeDue(state, 'final', !!state.due?.dueByInterval || (state.pendingTurns.length > 0 && sinceAttempt(state) >= state.solveEveryTurns));
  return { state: { ...state, due: owed }, due: owed };
}

/** Assemble the service request for a due checkpoint from stored match data. */
export function toRequest(
  state: ScheduleState, owed: CheckpointDue,
  stored: { rulesVersion: string; corrections: readonly SafetyRestraint[]; penalties: readonly PenaltyRecord[]; playerIds: readonly string[] },
): CheckpointRequest {
  return {
    requestId: `${owed.checkpointId}:v${owed.window.settingVersion}:from${owed.window.afterTurn}`,
    matchId: state.matchId, checkpointId: owed.checkpointId, reason: owed.reason, dueByInterval: owed.dueByInterval,
    window: owed.window, ...stored,
  };
}

/**
 * Record the outcome of the owed checkpoint. A result for any other
 * checkpoint is a stale callback and is ignored, as is a cancelled run: the
 * checkpoint stays owed and can be run again after resume.
 */
export function applyResult(state: ScheduleState, result: CheckpointResult): ScheduleState {
  if (!state.due || result.checkpointId !== state.due.checkpointId || result.matchId !== state.matchId) return state;
  if (result.status === 'cancelled') return state;
  const settled = result.authoritative && result.current !== null && result.settledThroughTurn >= state.due.window.afterTurn;
  const advanced = settled && result.current !== null && (result.status === 'completed' || result.settledThroughTurn > state.due.window.afterTurn);
  return {
    ...state,
    due: null,
    lastAttempt: {
      checkpointId: result.checkpointId, throughTurn: state.due.window.throughTurn,
      settingVersion: state.due.window.settingVersion, status: result.status, verified: result.verified,
    },
    lastVerified: advanced && result.current
      ? { checkpointId: result.checkpointId, throughTurn: result.settledThroughTurn, revision: result.current.revision }
      : state.lastVerified,
    pendingTurns: advanced ? state.pendingTurns.filter(turn => turn.turnNumber > result.settledThroughTurn) : state.pendingTurns,
    finalized: state.finalized || (result.reason === 'final' && result.verified),
  };
}

export interface Freshness {
  /** `current`: analysed at the latest turn. `stale`: analysed earlier. `none`: never analysed. */
  state: 'current' | 'stale' | 'none';
  lastAnalyzedTurn: number | null;
  currentTurn: number;
  /** Text for result panels; never claims an unanalysed structure is stable. */
  label: string;
  /** Committed turns until the next scheduled analysis; 0 when one is owed now. */
  nextAnalysisInTurns: number;
  pendingTurnIds: string[];
}

/** How current the last verified analysis is, for labelling results truthfully. */
export function freshness(state: ScheduleState): Freshness {
  const last = state.lastVerified?.throughTurn ?? null;
  const current = last !== null && last === state.completedTurns;
  return {
    state: current ? 'current' : last === null ? 'none' : 'stale',
    lastAnalyzedTurn: last,
    currentTurn: state.completedTurns,
    label: current ? `analyzed at turn ${last}`
      : last === null ? 'not yet analyzed'
      : `last analyzed at turn ${last} — current structure not yet analyzed`,
    nextAnalysisInTurns: state.due ? 0 : Math.max(1, state.solveEveryTurns - sinceAttempt(state)),
    pendingTurnIds: state.pendingTurns.map(turn => turn.turnId),
  };
}
