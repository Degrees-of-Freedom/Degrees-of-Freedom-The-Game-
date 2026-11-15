import { expect, it } from 'vitest';
import { SCORED_CATALOGUE } from './cardCatalogue';
import { createTurnGame, endTurn, parseTurnState, stageConnection, stageElement, stageLoad } from './turns';
import { LEGACY_REPAIR_POLICY, REPAIR_POLICY } from './turnRepair';

function accepted(result: ReturnType<typeof endTurn>) {
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

// The first player spends two actual connector cards on the glulam. A second
// player's 50 kN load now has a verified 100 kN m root moment before repairs.
function loadedCantilever() {
  let state = createTurnGame(97, SCORED_CATALOGUE);
  state = accepted(stageElement(state, 'element-21', '1,3,0', '2,3,0'));
  state = accepted(stageConnection(state, 'connection-26', 3, 'a'));
  state = accepted(stageConnection(state, 'connection-20', 3, 'b'));
  return accepted(stageLoad(accepted(endTurn(state)), 'load-3', '2,3,0'));
}

it('carries part of an overloaded timber cantilever load through an explicit neutral brace', () => {
  const staged = loadedCantilever();
  let state = accepted(endTurn(staged));
  const report = state.reports[1];
  const repair = report.correction!;
  expect(report.penaltyDecision?.event?.issueIds).toEqual(['member-overload:3']);
  expect(repair?.pending, JSON.stringify(repair?.attempts)).toEqual([]);
  const prop = state.board.members.find(m => m.system)!;
  expect(prop).toMatchObject({ a: '2,3,0', b: '2,2,0', type: 'heb', owner: 'neutral',
    system: { policy: REPAIR_POLICY, issueId: 'member-overload:3', turn: 2 } });
  expect(state.board.loads).toEqual(staged.draft.loads);
  expect(state.board.connections.slice(0, staged.board.connections.length)).toEqual(staged.board.connections);
  const relief = repair.changes.find(c => c.id === 'member-overload:3')!;
  expect(relief.change).toBe('resolved');
  expect(relief.before?.utilization).toBeCloseTo(1.21761, 4);
  expect(relief.after.utilization).toBeLessThan(0.999);
  const neutral = repair.afterFoundations.find(f => f.owner === 'neutral')!.upwardKN!;
  expect(neutral).toBeGreaterThan(0);
  expect(repair.afterFoundations.reduce((sum,f) => sum + f.upwardKN!, 0)).toBeCloseTo(50, 7);
  while (!state.finished) state = accepted(endTurn(state));
  expect(state.finalScore?.totalGravityKN).toBe(50);
  expect(state.finalScore?.neutralShare).toBeCloseTo(100 * neutral / 50, 8);
  expect(state.finalScore?.awards[1].penaltyPoints).toBe(1);
  expect(parseTurnState(JSON.parse(JSON.stringify(state)))).toEqual(state);
});

it('replays the original instability-only policy without adding a retroactive overload repair', () => {
  const state = accepted(endTurn(loadedCantilever()));
  const events = state.events.map(e => {
    if (e.kind !== 'end') return e;
    const { correction: _newReceipt, ...end } = e;
    return { ...end, repairPolicy: LEGACY_REPAIR_POLICY };
  });
  const recovered = parseTurnState({ version: state.version, catalogue: state.catalogue, seed: state.seed, events });
  expect(recovered?.reports[1].penalty).toBe(-1);
  expect(recovered?.reports[1].correction).toBeUndefined();
  expect(recovered?.board.members.some(m => m.system)).toBe(false);
});

function systemFixture(top: string, weights: number[]) {
  let state = accepted(endTurn(createTurnGame(97, SCORED_CATALOGUE)));
  // Standalone strength fixture. The upper joint is an existing shared player
  // interface; a subsequent load is legal there. A neutral prop's private
  // collar/anchor would be inspection-only.
  const base = 'neutral:1:3:ground';
  const system = { policy: REPAIR_POLICY, definitionVersion: 'playtest-1', turn: 1,
    issueId: 'member-overload:1', objectId: 'neutral:1:3:prop' } as const;
  state.board = {
    members: [{ id: 3, type: 'heb', a: '1,3,0', b: top, owner: 'neutral', system }],
    joints: [{ id: base, point: '1,3,0', foundationOwner: 'neutral', system: { ...system, objectId: base } }, { id: top }],
    connections: [
      { memberId: 3, end: 'a', jointId: base, profile: 'fixed', owner: 'neutral', system: { ...system, objectId: 'neutral:1:3:foot' } },
      { memberId: 3, end: 'b', jointId: top, profile: 'ball', owner: 'neutral', system: { ...system, objectId: 'neutral:1:3:head' } },
    ],
    loads: weights.map((magnitude,i) => ({ owner: 'player-1', cardId: 'fixture-' + i, magnitude, jointId: top })),
  };
  state.nextId = 4;
  return state;
}

it('keeps an overloaded system ball pending when all three proposed braces clash', () => {
  const state = systemFixture('1,3,1', [50,50,50,50,50,50,5]);
  const original = structuredClone(state.board);
  const result = accepted(endTurn(accepted(stageLoad(state, 'load-3', '1,3,1'))));
  const report = result.reports[1], id = 'connection-overload:3:b';
  expect(report.penaltyDecision?.event?.issueIds).toEqual([id]);
  expect(report.issues?.changes.find(c => c.id === id)?.after.utilization).toBeCloseTo(355/350, 7);
  expect(report.correction?.attempts).toHaveLength(3);
  expect(report.correction?.pending).toEqual([id]);
  expect(report.correction?.attempts.every(a => a.memberId === 3 && a.issueId === id &&
    a.status === 'rejected' && a.reason.includes('intersect material'))).toBe(true);
  expect(result.board.members).toContainEqual(original.members[0]);
  expect(result.board.connections).toEqual(expect.arrayContaining(original.connections));
  expect(result.board.loads).toHaveLength(8);
});

it('relieves an overloaded fixed system connector without altering its law or consuming a card', () => {
  const state = systemFixture('2,3,0', [50,10,5]);
  const stage = accepted(stageLoad(state, 'load-3', '2,3,0'));
  const result = accepted(endTurn(stage));
  const report = result.reports[1], id = 'connection-overload:3:a';
  expect(report.penaltyDecision?.event?.issueIds).toEqual([id]);
  const correction = report.correction!;
  expect(correction.pending, JSON.stringify(correction.attempts)).toEqual([]);
  const change = correction.changes.find(c => c.id === id)!;
  expect(change.before?.utilization).toBeCloseTo(Math.hypot(115/700, 230/220), 8);
  expect(change.after.utilization).toBeLessThan(0.999);
  expect(change.change).toBe('resolved');
  expect(correction.attempts.find(a => a.status === 'verified')).toMatchObject({ memberId: 3, issueId: id, contact: '2,3,0' });
  expect(result.board.connections).toEqual(expect.arrayContaining(state.board.connections));
  expect(result.board.members).toEqual(expect.arrayContaining(state.board.members));
  expect(result.reports.filter(r => r.penalty === -1)).toHaveLength(1);
  expect(correction.afterFoundations.reduce((sum,s) => sum + s.upwardKN!, 0)).toBeCloseTo(115, 8);
});
