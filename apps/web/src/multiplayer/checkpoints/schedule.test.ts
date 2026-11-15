import { describe, expect, it } from 'vitest';
import { applyResult, changeInterval, commitTurn, createSchedule, finalize, freshness, parseScheduleState, toRequest, type CheckpointDue, type ScheduleState } from './schedule';
import type { CheckpointResult } from './types';

const start = (solveEveryTurns?: number) => createSchedule({ matchId: 'match', setupRevision: 'setup', solveEveryTurns });

function commit(state: ScheduleState, number: number, final = false) {
  return commitTurn(state, { turnId: `turn-${number}`, playerId: number % 2 ? 'p1' : 'p2' }, { final });
}

/** A result as the service would return it, without running anything. */
function outcome(state: ScheduleState, due: CheckpointDue, patch: Partial<CheckpointResult> = {}): CheckpointResult {
  const request = toRequest(state, due, { rulesVersion: 'rules', corrections: [], penalties: [], playerIds: ['p1', 'p2'] });
  return {
    format: 'dof-checkpoint-result', schemaVersion: 1, requestId: request.requestId, matchId: request.matchId,
    checkpointId: due.checkpointId, reason: due.reason, dueByInterval: due.dueByInterval, window: due.window,
    status: 'completed', authoritative: true, verified: true,
    provenance: { serviceVersion: '1', rulesVersion: 'rules', solverId: 'none', solverVersion: null, options: {} },
    settledThroughTurn: due.window.throughTurn, unsettledTurnIds: [], steps: [], penalties: [], corrections: [], activeCorrections: [], unresolved: [],
    current: { revision: `rev-${due.window.throughTurn}`, turnNumber: due.window.throughTurn, modelId: 'model', lineage: 'retrospectively-corrected', components: [], foundations: [], safetyReactions: [], totalGravity: 0 },
    final: null, events: [], solverCalls: 0, ...patch,
  };
}

/** Commit turns `from..to`, completing every due checkpoint; returns the turns that were due. */
function play(state: ScheduleState, from: number, to: number) {
  const dueAt: number[] = [];
  for (let number = from; number <= to; number++) {
    const committed = commit(state, number);
    state = committed.state;
    if (committed.due) { dueAt.push(number); state = applyResult(state, outcome(state, committed.due)); }
  }
  return { state, dueAt };
}

describe('checkpoint schedule', () => {
  it('is due after every third globally committed turn by default, passes included', () => {
    const { state, dueAt } = play(start(), 1, 7);
    expect(dueAt).toEqual([3, 6]);
    expect(state.lastVerified).toMatchObject({ throughTurn: 6, revision: 'rev-6' });
    expect(state.pendingTurns.map(t => t.turnId)).toEqual(['turn-7']);
  });

  it('gives each checkpoint the window since the last verified one', () => {
    let state = play(start(), 1, 5).state;
    const { due } = commit(state, 6);
    expect(due).toMatchObject({
      checkpointId: 'match:checkpoint:6', reason: 'interval', dueByInterval: true,
      window: { afterTurn: 3, throughTurn: 6, baselineRevision: 'rev-3', solveEveryTurns: 3, settingVersion: 0 },
      pendingTurnIds: ['turn-4', 'turn-5', 'turn-6'],
    });
    state = start();
    expect(commit(state, 1).due).toBeNull();
  });

  it('applies an interval change at the next committed turn and never from Settings', () => {
    let { state } = play(start(), 1, 4);
    state = changeInterval(state, 2);
    // Changing the setting does not make anything due by itself.
    expect(state.due).toBeNull();
    expect(state.settingLog).toEqual([{ settingVersion: 1, from: 3, to: 2, atTurn: 4 }]);
    const fifth = commit(state, 5);
    // Two turns since the attempt at turn 3.
    expect(fifth.due?.window).toMatchObject({ afterTurn: 3, throughTurn: 5, solveEveryTurns: 2, settingVersion: 1 });
  });

  it('solves on the next committed turn when a reduced interval is already exceeded', () => {
    let { state, dueAt } = play(start(6), 1, 4);
    expect(dueAt).toEqual([]);
    state = changeInterval(state, 2);
    expect(state.due).toBeNull();
    expect(commit(state, 5).due?.window.throughTurn).toBe(5);
  });

  it('delays the next checkpoint when the interval is raised', () => {
    let { state } = play(start(), 1, 3);
    state = changeInterval(state, 5);
    expect(play(state, 4, 9).dueAt).toEqual([8]);
  });

  it('rejects unsupported intervals and ignores an unchanged one', () => {
    const state = start();
    for (const value of [0, -1, 2.5, 13, Number.NaN]) expect(() => changeInterval(state, value)).toThrow(RangeError);
    expect(changeInterval(state, 3)).toBe(state);
    expect(() => createSchedule({ matchId: 'm', setupRevision: 's', solveEveryTurns: 0 })).toThrow();
  });

  it('resolves a final turn that is also due by interval as one checkpoint', () => {
    let { state } = play(start(), 1, 5);
    const last = commit(state, 6, true);
    expect(last.due).toMatchObject({ checkpointId: 'match:checkpoint:6', reason: 'final', dueByInterval: true });
    state = applyResult(last.state, outcome(last.state, last.due!));
    expect(state.finalized).toBe(true);
    // Asking for finalization again cannot produce a second checkpoint.
    expect(finalize(state).due).toBeNull();
    expect(() => commit(state, 7)).toThrow();
  });

  it('makes a final checkpoint for a match that ends between intervals', () => {
    const { state } = play(start(), 1, 4);
    const end = finalize(state);
    expect(end.due).toMatchObject({ checkpointId: 'match:checkpoint:4', reason: 'final', dueByInterval: false, window: { afterTurn: 3, throughTurn: 4 } });
    // Asking again before it has run names the same checkpoint.
    expect(finalize(end.state).due?.checkpointId).toBe(end.due?.checkpointId);
  });

  it('does not retry a failed checkpoint every turn, and keeps its turns pending', () => {
    let { state } = play(start(), 1, 2);
    const third = commit(state, 3);
    state = applyResult(third.state, outcome(third.state, third.due!, { status: 'failed', verified: false, current: null, settledThroughTurn: 0 }));
    expect(state.lastAttempt).toMatchObject({ throughTurn: 3, status: 'failed', verified: false });
    expect(state.lastVerified).toBeNull();
    expect(commit(state, 4).due).toBeNull();
    state = commit(state, 4).state;
    state = commit(state, 5).state;
    const sixth = commit(state, 6);
    // The next scheduled attempt covers every turn that is still unattributed.
    expect(sixth.due?.window).toMatchObject({ afterTurn: 0, throughTurn: 6, baselineRevision: 'setup' });
    expect(sixth.due?.pendingTurnIds).toHaveLength(6);
  });

  it('keeps the unsettled turns of a partial checkpoint pending', () => {
    let { state } = play(start(), 1, 2);
    const third = commit(state, 3);
    const partial = outcome(third.state, third.due!, { status: 'partial', verified: false, settledThroughTurn: 1, unsettledTurnIds: ['turn-2', 'turn-3'] });
    state = applyResult(third.state, { ...partial, current: { ...partial.current!, revision: 'rev-1', turnNumber: 1 } });
    expect(state.lastVerified).toMatchObject({ throughTurn: 1, revision: 'rev-1' });
    expect(state.pendingTurns.map(t => t.turnId)).toEqual(['turn-2', 'turn-3']);
  });

  it('never records a non-authoritative result as verified', () => {
    const third = commit(play(start(), 1, 2).state, 3);
    const state = applyResult(third.state, outcome(third.state, third.due!, { authoritative: false, verified: false }));
    expect(state.lastVerified).toBeNull();
    expect(state.pendingTurns).toHaveLength(3);
    expect(state.finalized).toBe(false);
  });

  it('keeps a cancelled checkpoint owed and ignores stale results', () => {
    const third = commit(play(start(), 1, 2).state, 3);
    const cancelled = applyResult(third.state, outcome(third.state, third.due!, { status: 'cancelled', verified: false, current: null }));
    expect(cancelled).toBe(third.state);
    expect(cancelled.due?.checkpointId).toBe('match:checkpoint:3');
    // A turn committed while a checkpoint is owed extends it instead of dropping it.
    const fourth = commit(cancelled, 4);
    expect(fourth.due).toMatchObject({ checkpointId: 'match:checkpoint:4', window: { afterTurn: 0, throughTurn: 4 } });
    // The late result of the superseded checkpoint changes nothing.
    expect(applyResult(fourth.state, outcome(third.state, third.due!))).toBe(fourth.state);
  });

  it('labels results truthfully between checkpoints', () => {
    let state = start();
    expect(freshness(state)).toMatchObject({ state: 'none', label: 'not yet analyzed', nextAnalysisInTurns: 3 });
    state = play(state, 1, 3).state;
    expect(freshness(state)).toMatchObject({ state: 'current', label: 'analyzed at turn 3', nextAnalysisInTurns: 3 });
    state = commit(state, 4).state;
    expect(freshness(state)).toMatchObject({
      state: 'stale', lastAnalyzedTurn: 3, currentTurn: 4, nextAnalysisInTurns: 2, pendingTurnIds: ['turn-4'],
      label: 'last analyzed at turn 3 — current structure not yet analyzed',
    });
  });

  it('survives persistence and rejects a damaged save', () => {
    const state = commit(play(start(), 1, 5).state, 6).state;
    expect(parseScheduleState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(() => parseScheduleState({ ...state, solveEveryTurns: 0 })).toThrow();
    expect(() => parseScheduleState({ ...state, extra: true })).toThrow();
  });
});
