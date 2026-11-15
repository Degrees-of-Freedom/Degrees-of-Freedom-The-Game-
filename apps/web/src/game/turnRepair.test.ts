import { expect, it } from 'vitest';
import { SCORED_CATALOGUE } from './cardCatalogue';
import { activeTurnHand, createTurnGame, endTurn, parseTurnState, stageConnection, stageElement, stageLoad } from './turns';
import { inspectIssues } from './turnIssues';
import { toTurnVoxelInput } from './turnAnalysis';

function accepted(result: ReturnType<typeof endTurn>) {
  if (!result.ok) throw Error(result.reason);
  return result.state;
}

it('commits the seed-7 ball mechanism, its original penalty and one verified permanent local load path', () => {
  let turn = createTurnGame(7, SCORED_CATALOGUE);
  turn = accepted(stageElement(turn, 'element-6', 'port:1:1', 'port:2:1'));
  turn = accepted(stageConnection(turn, 'connection-13', 3, 'a'));
  turn = accepted(stageLoad(turn, 'load-18', 'port:1:1'));
  const original = structuredClone(turn.draft);
  const committed = accepted(endTurn(turn));
  const report = committed.reports[0];
  expect(report.penalty).toBe(-1);
  expect(report.issues!.changes.find(c => c.id === 'instability:3')?.after.active).toBe(true);
  const receipt = report.correction!;
  expect(receipt.pending, JSON.stringify(receipt.attempts)).toEqual([]);
  const attempt = receipt.attempts.find(a => a.status === 'verified')!;
  expect(attempt.contact).toBe('port:3:2');
  expect(receipt.attempts[0]).toMatchObject({ status: 'rejected', reason: expect.stringContaining('intersect material') });
  expect(attempt.ground).toBe('3,2,0');
  const prop = committed.board.members.find(m => m.id === attempt.propId)!;
  expect(prop).toMatchObject({ owner: 'neutral', type: 'shs', system: { turn: 1, issueId: 'instability:3' } });
  expect(committed.board.members).toContainEqual(original.members[0]);
  expect(committed.board.connections).toContainEqual(original.connections[0]);
  expect(committed.board.loads).toEqual(original.loads);
  expect(receipt.repairChecks.every(f => f.validity === 'verified' && !f.active)).toBe(true);
  expect(receipt.afterFoundations.find(f => f.owner === 'neutral')?.upwardKN).toBeTypeOf('number');
  expect(inspectIssues(committed).findings.find(f => f.id === 'instability:3')?.active).toBe(false);
  const passed = accepted(endTurn(committed));
  expect(passed.board).toEqual(committed.board);
  expect(passed.reports[1].penalty).toBe(0);
  expect(parseTurnState(JSON.parse(JSON.stringify(passed)))).toEqual(passed);
  const tampered = JSON.parse(JSON.stringify(passed));
  tampered.events.find((e: { correction?: unknown }) => e.correction).correction.attempts[1].ground = '3,4,0';
  expect(parseTurnState(tampered)).toBeNull();
  delete tampered.events.find((e: { correction?: unknown }) => e.correction).correction;
  expect(parseTurnState(tampered)).toBeNull();
});

it('uses an explicit neutral fitting on an unattached seed-1 member end and leaves the other end free', () => {
  let state = createTurnGame(1, SCORED_CATALOGUE);
  const card = activeTurnHand(state).find(c => c.kind === 'element')!;
  state = accepted(stageElement(state, card.id, '2,2,1','2,2,2'));
  state = accepted(endTurn(state));
  expect(state.reports[0].correction?.pending).toEqual([]);
  const sleeve = state.board.connections.find(c => c.memberId === 3 && c.system)!;
  expect(sleeve).toMatchObject({ end: 'a', profile: 'fixed', owner: 'neutral' });
  expect(state.board.connections.some(c => c.memberId === 3 && c.end === 'b')).toBe(false);
  const model = toTurnVoxelInput(state);
  expect(model.members.find(m => m.id === 3)?.a).toBe(sleeve.jointId);
  expect(model.attrs[sleeve.jointId].found).toBeUndefined();
  const anchor = state.board.joints.find(j => j.foundationOwner === 'neutral')!;
  expect(anchor.id).not.toBe(anchor.point);
  const hand = activeTurnHand(state);
  const load = hand.find(c => c.kind === 'load')!;
  for (const id of [anchor.id, sleeve.jointId])
    expect(stageLoad(state, load.id, id)).toMatchObject({ ok: false, reason: expect.stringMatching(/inspection-only/) });
  expect(stageConnection(state, hand.find(c => c.kind === 'connection')!.id, 4, 'a')).toMatchObject({ ok: false, reason: expect.stringMatching(/inspection-only/) });
  const originalProp = structuredClone(state.board.members.find(m => m.id === 4));
  state = accepted(stageConnection(state, hand.find(c => c.kind === 'connection')!.id, 3, 'b'));
  state = accepted(stageLoad(state, load.id, '2,2,2'));
  while (!state.finished) state = accepted(endTurn(state));
  expect(state.board.members.find(m => m.id === 4)).toEqual(originalProp);
  expect(state.finalScore!.unknownGravityKN).toBe(0);
  expect(state.finalScore!.neutralShare).toBeCloseTo(100, 7);
  expect(state.finalScore!.awards.map(a => a.awardedShare)).toEqual([0,0]);
  expect(state.finalScore!.awards[0].penaltyPoints).toBe(1);
  expect(parseTurnState(JSON.parse(JSON.stringify(state)))).toEqual(state);
});

it('exhausts the three local candidates without tying into or changing an unrelated supported structure', () => {
  let state = createTurnGame(1, SCORED_CATALOGUE);
  // Two existing cantilevers intercept both local routes below the loose
  // beam. They retain their IDs, end laws, load, and supported reactions.
  for (const [id, b] of [[3, '1,2,1'], [4, '2,3,1']] as const) {
    state.board.members.push({ id, type: 'shs', owner: 'player-2', a: '1,3,1', b });
    state.board.connections.push({ memberId: id, end: 'a', owner: 'player-2', jointId: '1,3,1', profile: 'fixed' });
  }
  state.board.loads.push({ cardId: 'fixture', owner: 'player-2', jointId: '1,3,1', magnitude: 10 });
  state.nextId = 5;
  state = accepted(stageElement(state, activeTurnHand(state).find(c => c.kind === 'element')!.id, '1,3,2','2,3,2'));
  const original = structuredClone(state.board);
  const committed = accepted(endTurn(state));
  const report = committed.reports[0];
  expect(report.penalty).toBe(-1);
  expect(report.correction?.pending).toEqual(['instability:5']);
  expect(report.correction?.attempts).toHaveLength(3);
  expect(report.correction!.attempts.every(a => a.status === 'rejected' && /intersect material/.test(a.reason))).toBe(true);
  expect(report.correction!.beforeFoundations).toEqual(report.correction!.afterFoundations);
  expect(report.correction!.afterFoundations.find(f => f.jointId === '1,3,0')?.upwardKN).toBeCloseTo(10, 8);
  expect(committed.board).toEqual({ ...original, members: [...original.members, ...state.draft.members] });
  expect(committed.nextId).toBe(state.nextId);
  const passed = accepted(endTurn(committed));
  expect(passed.board).toEqual(committed.board);
  expect(passed.reports[1].penalty).toBe(0);
  expect(passed.reports[1].correction).toBeUndefined();
});

it('rejects a geometrically clear brace when the independently analyzed load path overloads another member', () => {
  let state = createTurnGame(7, SCORED_CATALOGUE);
  state.nextId = 4;
  // A deck-sized 50 kN load on a 2 m timber cantilever. The candidate
  // cannot be accepted merely because it eliminates the new ball mechanism.
  state.board.members.push({ id: 3, type: 'glulam', owner: 'player-2', a: '1,3,0', b: '2,3,0' });
  state.board.joints.push({ id: '2,3,0' });
  state.board.connections.push({ memberId: 3, end: 'a', jointId: '1,3,0', profile: 'fixed', owner: 'player-2' },
    { memberId: 3, end: 'b', jointId: '2,3,0', profile: 'ball', owner: 'player-2' });
  state.board.loads.push({ cardId: 'fixture', owner: 'player-2', jointId: '2,3,0', magnitude: 50 });
  state = accepted(stageElement(state, 'element-6', '2,3,0', '2,5,0'));
  state = accepted(stageConnection(state, 'connection-13', 4, 'a'));
  const turn = accepted(endTurn(state));
  const attempts = turn.reports[0].correction!.attempts;
  expect(attempts.some(a => a.status === 'rejected' && a.reason.includes('member-overload:3')), JSON.stringify(attempts)).toBe(true);
  expect(turn.board.loads).toEqual(state.board.loads);
});
