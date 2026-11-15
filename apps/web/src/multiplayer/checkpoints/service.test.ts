import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { DetailedAnalysisResult, DetailedSolver } from '@dof/solver-contract';
import { createWasmSolver } from '../../solver/wasm/wasmSolver';
import { beam, extend, gravityLoad, K0, scriptedMatch, setupModel } from './fixtures';
import { correctionInvariantViolations, toAnalysisModel } from './model';
import { applyResult, changeInterval, commitTurn, createSchedule, finalize, freshness, toRequest } from './schedule';
import { createCheckpointService } from './service';
import type { CheckpointMember, CheckpointModel, CheckpointRequest, CheckpointResult, CheckpointServiceConfig, PenaltyRecord, SafetyRestraint } from './types';

/**
 * The real Rust solver, compiled to WebAssembly and read from disk. Every
 * physical expectation below comes from it. The wrappers further down only
 * count calls, inject failures or abort; where one alters a result, the
 * service is configured as non-authoritative.
 */
const wasm = createWasmSolver(() => readFile(new URL('../../solver/wasm/dof_solver.wasm', import.meta.url)));

type Script = readonly (readonly [string, CheckpointModel | null])[];
type Wrap = (model: Parameters<DetailedSolver['analyzeDetailed']>[0], call: number, solve: () => Promise<DetailedAnalysisResult>) => Promise<DetailedAnalysisResult>;

/** A scripted match driven through the schedule exactly as the shell would. */
function table(script: Script, init: { interval?: number; config?: Partial<CheckpointServiceConfig>; wrap?: Wrap } = {}) {
  const match = scriptedMatch(setupModel(), script);
  const game = {
    calls: 0,
    /** Solver calls made by the end of each committed turn. */
    callsAfterTurn: [] as number[],
    schedule: createSchedule({ matchId: 'match', setupRevision: 'setup', solveEveryTurns: init.interval }),
    corrections: [] as readonly SafetyRestraint[],
    penalties: [] as PenaltyRecord[],
    results: [] as CheckpointResult[],
    requests: [] as CheckpointRequest[],
    match,
    service: undefined as unknown as ReturnType<typeof createCheckpointService>,
    request(due: NonNullable<ReturnType<typeof commitTurn>['due']>) {
      return toRequest(game.schedule, due, { rulesVersion: 'rules-1', corrections: game.corrections, penalties: game.penalties, playerIds: ['p1', 'p2'] });
    },
    async settle(due: ReturnType<typeof commitTurn>['due'], signal?: AbortSignal) {
      if (!due) return null;
      const request = game.request(due);
      game.requests.push(request);
      const result = await game.service.run(request, { signal });
      game.schedule = applyResult(game.schedule, result);
      if (result.authoritative && result.status !== 'cancelled') {
        game.corrections = result.activeCorrections;
        game.penalties = [...game.penalties, ...result.penalties];
      }
      game.results.push(result);
      return result;
    },
    /** Commit turns up to and including `through`. */
    async play(through: number, final = false) {
      let last: CheckpointResult | null = null;
      for (let index = game.schedule.completedTurns; index < through; index++) {
        const committed = commitTurn(game.schedule, match.turns[index], { final: final && index === through - 1 });
        game.schedule = committed.state;
        last = (await game.settle(committed.due)) ?? last;
        game.callsAfterTurn.push(game.calls);
      }
      return last;
    },
  };
  const solver: DetailedSolver = {
    id: wasm.id, name: wasm.name,
    analyzeDetailed(model, options, signal) {
      const call = ++game.calls;
      const solve = () => wasm.analyzeDetailed(model, options, signal);
      return init.wrap ? init.wrap(model, call, solve) : solve();
    },
  };
  game.service = createCheckpointService({ authoritative: true, ...init.config, solver, turns: match.turnAdapter, models: match.modelAdapter });
  return game;
}

/** What the solver adapter returns when the solver itself cannot run. */
function outage(): DetailedAnalysisResult {
  return {
    analysis: { solverVersion: 'outage', modelVersion: null, units: 'SI', status: 'invalid', reasonCodes: ['solverUnavailable'], diagnostics: [{ code: 'solverUnavailable', message: 'offline', ids: [] }] },
    components: [], nodes: {}, members: {}, foundations: {}, failureEvents: [],
  };
}

// --- Structures ------------------------------------------------------------

const setup = setupModel();
/** p1 hangs a loaded beam on a hinge: it can rotate about one axis. */
const hinged = extend(setup, 'hinged', {
  nodes: [{ id: 'a', position: [4, 0, 4] }],
  members: [beam('b1', 'p1', 'turn-1', 'p1:top', 'a', [true, false, true])],
  loads: [gravityLoad('l1', 'p1', 'turn-1', 'a', 5000)],
});
/** p2 then cantilevers a beam with far more load than its section can take. */
const overloaded = extend(hinged, 'overloaded', {
  nodes: [{ id: 'd', position: [6, 0, 4] }],
  members: [beam('b2', 'p2', 'turn-2', 'p2:top', 'd')],
  loads: [gravityLoad('l2', 'p2', 'turn-2', 'd', 30000)],
});
/** A sound girder between the two columns with a load at midspan. */
const bridged = extend(setup, 'bridged', {
  nodes: [{ id: 'mid', position: [5, 0, 4] }],
  members: [beam('g1', 'p1', 'turn-1', 'p1:top', 'mid'), beam('g2', 'p1', 'turn-1', 'mid', 'p2:top')],
  loads: [gravityLoad('l1', 'p1', 'turn-1', 'mid', 8000)],
});
const moreLoad = extend(bridged, 'more-load', { loads: [gravityLoad('l2', 'p2', 'turn-2', 'mid', 2000)] });
const cable: CheckpointMember = {
  id: 'c1', kind: 'cable', sectionId: 'cable', ownerId: 'p1', originTurnId: 'turn-1',
  start: { nodeId: 'p1:top', mask: [true, true, true] }, end: { nodeId: 'h', mask: [true, true, true] },
};
/** A weight on a cable that does not hang plumb: only a held translation can stop it swinging. */
const pendulum = extend(setup, 'pendulum', { nodes: [{ id: 'h', position: [2, 0, 2] }], members: [cable], loads: [gravityLoad('l1', 'p1', 'turn-1', 'h', 1000)] });

const kinds = (result: CheckpointResult) => result.corrections.map(c => c.target.kind);

describe('checkpoint cadence', () => {
  it('solves nothing on turns 1, 2, 4 and 5, and solves at turns 3 and 6', async () => {
    const game = table([['p1', bridged], ['p2', moreLoad], ['p1', null], ['p2', null], ['p1', null], ['p2', null]]);
    await game.play(6);
    const [one, two, three, four, five, six] = game.callsAfterTurn;
    expect([one, two]).toEqual([0, 0]);
    // The baseline and the two turns that changed the model; the pass is not solved.
    expect(three).toBe(3);
    expect([four, five]).toEqual([3, 3]);
    // Turns 4 to 6 are passes: only the baseline of the second window is solved.
    expect(six).toBe(4);
    expect(game.results.map(r => [r.checkpointId, r.status, r.verified])).toEqual([
      ['match:checkpoint:3', 'completed', true], ['match:checkpoint:6', 'completed', true],
    ]);
    expect(game.results[0].steps.map(s => s.evidence)).toEqual(['verified', 'verified', 'unchanged-model']);
    expect(game.penalties).toEqual([]);
    expect(freshness(game.schedule).state).toBe('current');
  });

  it('follows a changed interval without solving from the change itself', async () => {
    const game = table([['p1', bridged], ['p2', null], ['p1', null], ['p2', null], ['p1', null]], { interval: 2 });
    await game.play(2);
    expect(game.callsAfterTurn).toEqual([0, 2]);
    game.schedule = changeInterval(game.schedule, 3);
    expect(game.calls).toBe(2);
    await game.play(5);
    expect(game.callsAfterTurn).toEqual([0, 2, 2, 2, 3]);
    expect(game.results[1].window).toMatchObject({ afterTurn: 2, throughTurn: 5, solveEveryTurns: 3, settingVersion: 1 });
  });

  it('runs one checkpoint when the final turn is also due, and never a second', async () => {
    const game = table([['p1', bridged], ['p2', moreLoad], ['p1', null]]);
    const result = (await game.play(3, true))!;
    expect(game.results).toHaveLength(1);
    expect(result).toMatchObject({ reason: 'final', dueByInterval: true, status: 'completed', verified: true });
    expect(result.final?.validity).toBe('verified');
    expect(result.events.map(e => e.type)).toEqual(['checkpoint.completed', 'match.finalized']);
    expect(game.schedule.finalized).toBe(true);
    expect(finalize(game.schedule).due).toBeNull();
    // Repeating the identical request is answered from memory.
    const calls = game.calls;
    const again = await game.service.run(structuredClone(game.requests[0]));
    expect(again).toBe(result);
    expect(game.calls).toBe(calls);
  });
});

describe('replay and attribution', () => {
  it('charges each responsible original turn once, not the player who reached the checkpoint', async () => {
    const game = table([['p1', hinged], ['p2', overloaded], ['p1', null]]);
    const result = (await game.play(3))!;
    expect(result.penalties.map(p => [p.turnId, p.playerId, p.points])).toEqual([['turn-1', 'p1', 1], ['turn-2', 'p2', 1]]);
    // Turn 3 triggered the checkpoint and is charged nothing.
    expect(result.steps[2]).toMatchObject({ turnId: 'turn-3', evidence: 'unchanged-model', penaltyEventId: null });
    expect(result.steps[0].issues).toEqual([expect.objectContaining({ kind: 'instability', change: 'new', after: 1 })]);
    // Turn 2 overloaded two members but still costs one point.
    expect(result.steps[1].issues.map(i => [i.kind, i.change, i.key])).toEqual([
      ['overload', 'new', 'member:b2'], ['overload', 'new', 'member:p2:column'],
    ]);
    expect(result.penalties[1]).toMatchObject({ checkpointId: 'match:checkpoint:3', revision: 'overloaded', eventId: 'match:checkpoint:3:penalty:turn-2' });
    // The judged model is the corrected replay branch, named apart from the live revision.
    expect(result.penalties[1].modelId).toBe('overloaded+safety:rotation-end:b1:start:1');
    expect(result.current).toMatchObject({ revision: 'overloaded', lineage: 'retrospectively-corrected' });
    expect(result.events.map(e => [e.type, e.turnId, e.actorId])).toEqual([
      ['checkpoint.penalty', 'turn-1', 'p1'], ['checkpoint.penalty', 'turn-2', 'p2'],
      ['checkpoint.correction', 'turn-1', 'p1'], ['checkpoint.correction', 'turn-2', 'p2'],
      ['checkpoint.completed', null, null],
    ]);
  });

  it('does not repeat an unchanged issue, and charges a later turn that worsens it', async () => {
    // With no restraints allowed the hinge stays an open, unresolved issue.
    const sound = extend(hinged, 'sound', { nodes: [{ id: 'e', position: [10, 3, 4] }], members: [beam('b3', 'p2', 'turn-2', 'p2:top', 'e')] });
    const worse = extend(sound, 'worse', { nodes: [{ id: 'f', position: [4, 3, 4] }], members: [beam('b4', 'p2', 'turn-4', 'a', 'f', [true, false, true])] });
    const game = table([['p1', hinged], ['p2', sound], ['p1', null], ['p2', worse], ['p1', null], ['p2', null]], { config: { limits: { maxRestraintsPerTurn: 0 } } });
    const first = (await game.play(3))!;
    expect(first.penalties.map(p => p.turnId)).toEqual(['turn-1']);
    expect(first.corrections).toEqual([]);
    expect(first.unresolved).toEqual([expect.objectContaining({ code: 'instability-not-corrected', turnId: 'turn-1' })]);
    // Turn 2 built on a structure that was already unstable elsewhere and changed nothing about it.
    expect(first.steps[1]).toMatchObject({ evidence: 'verified', issues: [], penaltyEventId: null });
    const second = (await game.play(6))!;
    expect(second.penalties.map(p => [p.turnId, p.playerId])).toEqual([['turn-4', 'p2']]);
    expect(second.steps[0].issues).toEqual([expect.objectContaining({ kind: 'instability', change: 'worsened', before: 1, after: 2 })]);
    expect(game.penalties).toHaveLength(2);
  });

  it('never charges a turn twice when a window is replayed', async () => {
    const game = table([['p1', hinged], ['p2', overloaded], ['p1', null]]);
    const first = (await game.play(3))!;
    const replay = await game.service.run({ ...game.request({ checkpointId: first.checkpointId, reason: 'interval', dueByInterval: true, window: first.window, pendingTurnIds: [] }), corrections: [], requestId: 'replay' });
    expect(replay.penalties).toEqual([]);
    expect(replay.steps.map(s => s.penaltyAlreadyRecorded)).toEqual([true, true, false]);
    // The corrections come out identical: their ids are permanent.
    expect(replay.corrections.map(c => c.id)).toEqual(first.corrections.map(c => c.id));
  });

  it('cannot prove blame from an unknown baseline', async () => {
    // A double that withholds the classification of the setup state.
    const game = table([['p1', hinged]], {
      interval: 1, config: { authoritative: false },
      wrap: async (model, _call, solve) => {
        const result = await solve();
        if (model.version !== 'setup') return result;
        return { ...result, components: result.components.map(c => ({ ...c, status: 'unknown' as const, resultsValid: false })) };
      },
    });
    const result = (await game.play(1))!;
    expect(result.steps[0]).toMatchObject({ evidence: 'unknown', issues: [], penaltyEventId: null });
    expect(result.penalties).toEqual([]);
    expect(result.unresolved.map(u => u.code)).toContain('unknown-component');
    // A double is never a verified checkpoint.
    expect(result).toMatchObject({ status: 'completed', authoritative: false, verified: false });
    expect(game.schedule.lastVerified).toBeNull();
  });

  it('stops at a failed replay solve and leaves that turn and later ones pending', async () => {
    const game = table([['p1', bridged], ['p2', hinged], ['p1', null]], {
      wrap: (model, _call, solve) => model.version === 'hinged'
        ? Promise.resolve(outage())
        : solve(),
    });
    const result = (await game.play(3))!;
    expect(result).toMatchObject({ status: 'partial', verified: false, settledThroughTurn: 1, unsettledTurnIds: ['turn-2', 'turn-3'], penalties: [] });
    expect(result.unresolved).toEqual([expect.objectContaining({ code: 'solver-failed', turnId: 'turn-2' })]);
    expect(game.schedule.lastVerified).toMatchObject({ throughTurn: 1, revision: 'bridged' });
    expect(game.schedule.pendingTurns.map(t => t.turnId)).toEqual(['turn-2', 'turn-3']);
    // No retry on the very next turn.
    expect(game.schedule.lastAttempt).toMatchObject({ throughTurn: 3, status: 'partial' });
  });

  it('bounds its work and reports the rest of the window as pending', async () => {
    const game = table([['p1', hinged], ['p2', overloaded], ['p1', null]], { config: { limits: { maxSolves: 4 } } });
    const result = (await game.play(3))!;
    expect(game.calls).toBe(4);
    expect(result).toMatchObject({ status: 'partial', settledThroughTurn: 1, unsettledTurnIds: ['turn-2', 'turn-3'] });
    expect(result.penalties.map(p => p.turnId)).toEqual(['turn-1']);
    expect(result.unresolved.map(u => u.code)).toEqual(['work-limit']);
  });

  it('fails without solving when the turn adapter does not supply the window', async () => {
    const game = table([['p1', bridged], ['p2', null]], { interval: 2 });
    game.match.turns.pop();
    const committed = commitTurn(commitTurn(game.schedule, { turnId: 'turn-1', playerId: 'p1' }).state, { turnId: 'turn-2', playerId: 'p2' });
    game.schedule = committed.state;
    const result = (await game.settle(committed.due))!;
    expect(result).toMatchObject({ status: 'failed', current: null, solverCalls: 0 });
    expect(result.unresolved[0].code).toBe('turn-window-mismatch');
  });
});

describe('interruption', () => {
  const script: Script = [['p1', hinged], ['p2', overloaded], ['p1', null]];

  it('discards an interrupted replay and reproduces the result on retry', async () => {
    const controller = new AbortController();
    const game = table(script, { wrap: (_model, call, solve) => { if (call === 5) controller.abort(); return solve(); } });
    const committed = [0, 1, 2].reduce((state, index) => commitTurn(state.state, game.match.turns[index]), { state: game.schedule, due: null as ReturnType<typeof commitTurn>['due'] });
    game.schedule = committed.state;
    const interrupted = (await game.settle(committed.due, controller.signal))!;
    expect(interrupted).toMatchObject({ status: 'cancelled', verified: false, penalties: [], corrections: [], events: [], current: null, settledThroughTurn: 0 });
    expect(interrupted.unsettledTurnIds).toEqual(['turn-1', 'turn-2', 'turn-3']);
    // The whole window is still owed and nothing was recorded.
    expect(game.schedule.due?.checkpointId).toBe('match:checkpoint:3');
    expect(game.schedule.pendingTurns).toHaveLength(3);
    expect(game.penalties).toEqual([]);

    const retried = (await game.settle(game.schedule.due))!;
    const uninterrupted = (await table(script).play(3))!;
    expect(retried.status).toBe('completed');
    expect({ ...retried, solverCalls: 0 }).toEqual({ ...uninterrupted, solverCalls: 0 });
    expect(game.penalties.map(p => p.turnId)).toEqual(['turn-1', 'turn-2']);
  });

  it('cancels through the service, and shares one run between identical requests', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const game = table(script, { wrap: async (_model, call, solve) => { if (call === 2) await gate; return solve(); } });
    const committed = [0, 1, 2].reduce((state, index) => commitTurn(state.state, game.match.turns[index]), { state: game.schedule, due: null as ReturnType<typeof commitTurn>['due'] });
    game.schedule = committed.state;
    const request = game.request(committed.due!);
    const first = game.service.run(request), second = game.service.run(request);
    expect(second).toBe(first);
    game.service.cancel(request.checkpointId);
    release();
    expect((await first).status).toBe('cancelled');
    // A request that is already aborted never reaches the solver.
    const calls = game.calls;
    const aborted = new AbortController();
    aborted.abort();
    expect((await game.service.run({ ...request, requestId: 'aborted' }, { signal: aborted.signal })).status).toBe('cancelled');
    expect(game.calls).toBe(calls);
  });
});

describe('minimum local correction', () => {
  it('locks exactly the released rotations a mechanism needs, and nothing else', async () => {
    const one = (await table([['p1', hinged]], { interval: 1 }).play(1))!;
    expect(one.corrections.map(c => c.id)).toEqual(['safety:rotation-end:b1:start:1']);
    expect(one.corrections[0]).toMatchObject({
      frame: 'member-local', reason: 'instability', originTurnId: 'turn-1', originPlayerId: 'p1', checkpointId: 'match:checkpoint:1', permanent: true,
    });
    const doubleHinge = extend(setup, 'double-hinge', {
      nodes: [{ id: 'a', position: [4, 0, 4] }],
      members: [beam('b1', 'p1', 'turn-1', 'p1:top', 'a', [true, false, false])],
      loads: [gravityLoad('l1', 'p1', 'turn-1', 'a', 5000)],
    });
    const two = (await table([['p1', doubleHinge]], { interval: 1 }).play(1))!;
    expect(two.steps[0].issues[0]).toMatchObject({ kind: 'instability', after: 2 });
    expect(two.corrections.map(c => c.id)).toEqual(['safety:rotation-end:b1:start:1', 'safety:rotation-end:b1:start:2']);
    expect(two.unresolved).toEqual([]);
  });

  it('uses a translational restraint only where rotation cannot help', async () => {
    const result = (await table([['p1', pendulum]], { interval: 1 }).play(1))!;
    expect(kinds(result)).toEqual(['translation-joint']);
    expect(result.corrections[0]).toMatchObject({ id: 'safety:translation-joint:h:0', frame: 'global', reason: 'instability' });
    expect(result.current?.components.every(c => c.verified)).toBe(true);
  });

  it('holds a spring that has no lateral stiffness with one translational restraint', async () => {
    const spring = extend(setup, 'spring', {
      nodes: [{ id: 's', position: [0, 3, 4] }],
      members: [{ id: 'sp', kind: 'spring', stiffness: 0.25 * K0, ownerId: 'p1', originTurnId: 'turn-1', start: { nodeId: 'p1:top', mask: [true, true, true] }, end: { nodeId: 's', mask: [true, true, true] } }],
      loads: [gravityLoad('l1', 'p1', 'turn-1', 's', 1000)],
    });
    const result = (await table([['p1', spring]], { interval: 1 }).play(1))!;
    expect(kinds(result)).toEqual(['translation-joint']);
    expect(result.unresolved).toEqual([]);
  });

  it('keeps the original model intact: no member, foundation, load or section is added or changed', async () => {
    const game = table([['p1', hinged], ['p2', overloaded], ['p1', null]]);
    const result = (await game.play(3))!;
    expect(kinds(result)).toEqual(['rotation-end', 'translation-joint']);
    const original = toAnalysisModel(overloaded, []), corrected = toAnalysisModel(overloaded, result.activeCorrections);
    expect(correctionInvariantViolations(original.model, corrected.model)).toEqual([]);
    expect(corrected.model.members).toHaveLength(original.model.members.length);
    expect(corrected.model.sections).toEqual(original.model.sections);
    expect(corrected.model.loads).toEqual(original.model.loads);
    // The player's mask is untouched; the lock lives only in the correction layer.
    expect(overloaded.members.find(m => m.id === 'b1')?.start.mask).toEqual([true, false, true]);
    expect(original.model.members.find(m => m.id === 'b1')?.start?.laws?.[4]).toBe('free');
    expect(corrected.model.members.find(m => m.id === 'b1')?.start?.laws?.[4]).toBe('rigid');
    // The one extra restraint entry holds a single translation of one joint.
    const extra = corrected.model.foundations.filter(f => !original.model.foundations.some(o => o.id === f.id));
    expect(extra).toEqual([{ id: 'safety-restraint:d', nodeId: 'd', restrained: [false, false, true, false, false, false] }]);
    // The checker itself notices forbidden edits.
    expect(correctionInvariantViolations(original.model, { ...original.model, loads: [] })).toEqual(['loads changed']);
    expect(correctionInvariantViolations(original.model, { ...original.model, foundations: [...original.model.foundations, { id: 'prop', nodeId: 'd', restrained: [true, true, true, true, true, true] }] })).toEqual(['unexpected restraint entry prop']);
  });

  it('verifies stability, equilibrium and capacities of the corrected structure with the solver', async () => {
    const game = table([['p1', hinged], ['p2', overloaded], ['p1', null]]);
    const result = (await game.play(3))!;
    const corrected = await wasm.analyzeDetailed(toAnalysisModel(overloaded, result.activeCorrections).model);
    expect(corrected.components.map(c => c.status)).toEqual(['stable', 'stable']);
    for (const component of corrected.components) {
      expect(component.convergence.converged).toBe(true);
      component.appliedForce.forEach((force, axis) => expect(force + component.reactionForce![axis]).toBeCloseTo(0, 5));
    }
    const utilizations = Object.values(corrected.members).map(m => m.utilization ?? 0);
    expect(Math.max(...utilizations)).toBeLessThanOrEqual(1);
    // Compatibility: the locked rotation has no relative motion.
    expect(corrected.members.b1.connections?.start.relativeMotion[4]).toBeCloseTo(0, 12);
    // Before correction the same model was overloaded threefold.
    const uncorrected = await wasm.analyzeDetailed(toAnalysisModel(overloaded, result.activeCorrections.filter(c => c.reason !== 'overload')).model);
    expect(uncorrected.members.b2.utilization).toBeGreaterThan(2.9);
  });

  it('reports an overload it may not correct instead of upgrading the section', async () => {
    const heavy = extend(setup, 'heavy', { nodes: [{ id: 'd', position: [6, 0, 4] }], members: [beam('b2', 'p2', 'turn-1', 'p2:top', 'd')], loads: [gravityLoad('l2', 'p2', 'turn-1', 'd', 30000)] });
    const result = (await table([['p2', heavy]], { interval: 1, config: { limits: { maxRestraintsPerTurn: 0 } } }).play(1))!;
    expect(result.corrections).toEqual([]);
    expect(result.penalties.map(p => p.playerId)).toEqual(['p2']);
    expect(result.unresolved).toEqual([expect.objectContaining({ code: 'overload-not-corrected', turnId: 'turn-1' })]);
    // The move and its load are kept and the result stays a completed, truthful checkpoint.
    expect(result.status).toBe('completed');
    expect(result.current?.totalGravity).toBeCloseTo(30000, 6);
  });

  it('keeps corrections in force at the next checkpoint without adding more', async () => {
    const later = extend(overloaded, 'later', { loads: [gravityLoad('l3', 'p1', 'turn-4', 'p1:top', 1000)] });
    const game = table([['p1', hinged], ['p2', overloaded], ['p1', null], ['p2', later], ['p1', null], ['p2', null]]);
    const first = (await game.play(3))!;
    const second = (await game.play(6))!;
    expect(second.corrections).toEqual([]);
    expect(second.penalties).toEqual([]);
    expect(second.activeCorrections).toEqual(first.activeCorrections);
    expect(second.current?.safetyReactions.map(r => r.validity)).toEqual(['verified', 'verified']);
    expect(second.current?.components.every(c => c.verified)).toBe(true);
  });

  it('reports a stored correction whose target is absent instead of forcing it or changing a move', async () => {
    const game = table([['p1', bridged]], { interval: 1 });
    game.corrections = [{
      id: 'safety:rotation-end:gone:start:1', eventId: 'old:correction', target: { kind: 'rotation-end', memberId: 'gone', end: 'start', axis: 1 },
      frame: 'member-local', reason: 'instability', originTurnId: 'turn-0', originPlayerId: 'p1', checkpointId: 'old', revision: 'setup', permanent: true,
    }];
    const result = (await game.play(1))!;
    expect(result.status).toBe('completed');
    expect(result.unresolved).toEqual([expect.objectContaining({ code: 'correction-target-missing', memberIds: ['gone'] })]);
    // The live model is analysed as committed.
    expect(result.current?.modelId).toBe('bridged');
    expect(result.current?.safetyReactions).toEqual([]);
  });

  it('gives a spring the authored stiffness whatever its length, in the exact ratio of the two cards', () => {
    const spring = (id: string, to: string, stiffness: number): CheckpointMember => ({
      id, kind: 'spring', stiffness, ownerId: 'p1', originTurnId: 'turn-1', start: { nodeId: 'p1:top', mask: [true, true, true] }, end: { nodeId: to, mask: [true, true, true] },
    });
    const model = extend(setup, 'springs', {
      nodes: [{ id: 'near', position: [0, 3, 4] }, { id: 'far', position: [0, 0, 11] }],
      members: [spring('soft', 'near', 0.25 * K0), spring('stiff', 'far', 0.5 * K0)],
    });
    const { sections, members } = toAnalysisModel(model, []).model;
    const axial = (id: string, length: number) => {
      const section = sections.find(s => s.id === `spring:${id}`)!;
      expect(members.find(m => m.id === id)).toMatchObject({ kind: 'brace', sectionId: `spring:${id}` });
      return section.E * section.A / length;
    };
    expect(axial('soft', 3)).toBeCloseTo(0.25 * K0, 6);
    expect(axial('stiff', 7)).toBeCloseTo(0.5 * K0, 6);
    expect(axial('stiff', 7) / axial('soft', 3)).toBeCloseTo(2, 12);
  });
});

describe('safety reactions and the final score', () => {
  it('records safety reactions apart from player reactions and keeps total gravity as the denominator', async () => {
    const game = table([['p1', hinged], ['p2', overloaded], ['p1', null]]);
    const result = (await game.play(3, true))!;
    const current = result.current!;
    expect(current.totalGravity).toBeCloseTo(35000, 6);
    const support = current.safetyReactions.find(r => r.restraintId === 'safety:translation-joint:d:2')!;
    expect(support).toMatchObject({ unit: 'N', validity: 'verified', scored: false });
    expect(support.value).toBeCloseTo(30000, 3);
    // The locked hinge transmits the cantilever moment of the 5 kN load on a 4 m arm.
    const lock = current.safetyReactions.find(r => r.restraintId === 'safety:rotation-end:b1:start:1')!;
    expect(lock.unit).toBe('N·m');
    expect(Math.abs(lock.value!)).toBeCloseTo(20000, -1);
    // Corrected-model equilibrium: player foundations and the safety restraint together carry W.
    const vertical = current.foundations.reduce((sum, f) => sum + f.reaction![2], 0);
    expect(vertical + support.value!).toBeCloseTo(current.totalGravity, 3);
    // The safety restraint earns nobody anything: p2's own foundation carries none of p2's load.
    const [p1, p2] = result.final!.players;
    expect(result.final).toMatchObject({ validity: 'verified', totalGravity: current.totalGravity });
    expect(p1.attraction).toBeCloseTo(5000, 3);
    expect(p1.sharePercent).toBeCloseTo(100 * 5000 / 35000, 6);
    expect(p2.attraction).toBeCloseTo(0, 3);
    expect(p1.sharePercent! + p2.sharePercent!).toBeLessThan(100);
    expect([p1.penaltyPoints, p2.penaltyPoints]).toEqual([1, 1]);
    expect(p1.score).toBeCloseTo(p1.sharePercent! - 1, 9);
    expect(p2.score).toBeCloseTo(-1, 3);
  });

  it('subtracts historical penalties from the final share only', async () => {
    const game = table([['p1', hinged], ['p2', null], ['p1', null], ['p2', bridgedOnHinged()], ['p1', null]]);
    await game.play(3);
    expect(game.results[0].final).toBeNull();
    const final = (await game.play(5, true))!;
    expect(final.reason).toBe('final');
    expect(final.penalties).toEqual([]);
    const [p1, p2] = final.final!.players;
    // p1's point comes from the first checkpoint, two checkpoints ago.
    expect([p1.penaltyPoints, p2.penaltyPoints]).toEqual([1, 0]);
    expect(p1.score).toBeCloseTo(p1.sharePercent! - 1, 9);
    expect(p1.sharePercent! + p2.sharePercent!).toBeCloseTo(100, 6);
  });

  it('falls back to verified components and says which scope is unresolved', async () => {
    const both = extend(hinged, 'both', { loads: [gravityLoad('l2', 'p2', 'turn-2', 'p2:top', 15000)] });
    const game = table([['p1', hinged], ['p2', both]], { interval: 2, config: { limits: { maxRestraintsPerTurn: 0 } } });
    const result = (await game.play(2, true))!;
    expect(result.current!.components.map(c => [c.status, c.verified])).toEqual([['unstable', false], ['stable', true]]);
    expect(result.unresolved.map(u => u.code)).toEqual(['instability-not-corrected']);
    const [p1, p2] = result.final!.players;
    expect(result.final).toMatchObject({ validity: 'verified-components-only' });
    // W still counts the load on the unverified part; p1 gets nothing from it.
    expect(result.final!.totalGravity).toBeCloseTo(20000, 6);
    expect(p1).toMatchObject({ attraction: 0, sharePercent: 0, penaltyPoints: 1, score: -1 });
    expect(p2.sharePercent).toBeCloseTo(75, 6);
    expect(p2.score).toBeCloseTo(75, 6);
  });

  it('gives no score, not a zero score, when the final model cannot be analysed', async () => {
    const game = table([['p1', bridged]], {
      interval: 1,
      wrap: (model, _call, solve) => model.version === 'bridged'
        ? Promise.resolve(outage())
        : solve(),
    });
    const result = (await game.play(1, true))!;
    expect(result.status).toBe('partial');
    expect(result.final).toMatchObject({ validity: 'unavailable', totalGravity: null });
    expect(result.final!.players).toEqual([
      { playerId: 'p1', attraction: null, sharePercent: null, penaltyPoints: 0, score: null },
      { playerId: 'p2', attraction: null, sharePercent: null, penaltyPoints: 0, score: null },
    ]);
    expect(game.schedule.finalized).toBe(false);
    expect(result.events.map(e => e.type)).not.toContain('match.finalized');
  });
});

/** The hinged structure with a sound girder added between the columns. */
function bridgedOnHinged(): CheckpointModel {
  return extend(hinged, 'hinged-bridged', {
    nodes: [{ id: 'mid', position: [5, 0, 4] }],
    members: [beam('g1', 'p2', 'turn-4', 'p1:top', 'mid'), beam('g2', 'p2', 'turn-4', 'mid', 'p2:top')],
    loads: [gravityLoad('l4', 'p2', 'turn-4', 'mid', 8000)],
  });
}
