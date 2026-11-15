import { describe, expect, it } from 'vitest';
import { SCORED_CATALOGUE } from './cardCatalogue';
import { assessTurnIssues, compareIssues, inspectIssues, ISSUE_POLICY, type IssueFinding } from './turnIssues';
import { createTurnGame, endTurn, parseTurnState, stageConnection, stageElement, stageLoad, type TurnState } from './turns';

function accepted(result: ReturnType<typeof endTurn>) {
  if (!result.ok) throw Error(result.reason);
  return result.state;
}

describe('scored whole-structure issue comparison', () => {
  it('uses an exact neutral pin motion on the staged off-grid frame and replays the assessment once', () => {
    let turn = createTurnGame(7, SCORED_CATALOGUE);
    turn = accepted(stageElement(turn, 'element-6', 'port:1:1', 'port:2:1'));
    expect(assessTurnIssues(turn).changes.find(c => c.id === 'instability:3')?.after.reason).toContain('translation');
    turn = accepted(stageConnection(turn, 'connection-13', 3, 'a'));
    turn = accepted(stageLoad(turn, 'load-18', 'port:1:1'));
    const original = JSON.stringify(turn);
    const assessment = assessTurnIssues(turn);
    expect(assessment.changes.filter(c => c.eligible).map(c => c.id)).toEqual(['instability:3']);
    const issue = assessment.changes.find(c => c.eligible)!;
    expect(issue.after.contactNodes).toEqual(['port:1:1']);
    expect(issue.after.reason).toContain('rotation');
    expect(issue.after.memberIds).toEqual([3]);
    expect(assessment.beforeModelId).not.toBe(assessment.afterModelId);
    expect(JSON.stringify(turn)).toBe(original);
    const next = accepted(endTurn(turn));
    expect(next.reports[0].issues).toEqual(assessment);
    expect(parseTurnState(JSON.parse(JSON.stringify(next)))).toEqual(next);
    const persistent = assessTurnIssues(next, assessment.memory);
    expect(persistent.changes.filter(c => c.eligible)).toEqual([]);
    expect(persistent.changes.find(c => c.id === issue.id)?.change).toBe('persistent');
    const corrupt = JSON.parse(JSON.stringify(next));
    corrupt.events.at(-1).issues.changes[0].eligible = !corrupt.events.at(-1).issues.changes[0].eligible;
    expect(parseTurnState(corrupt)).toBeNull();
  });

  it('checks remote overload on player 1’s fixed beam when player 2 stages a gravity load', () => {
    const state = createTurnGame(7, SCORED_CATALOGUE);
    state.playerIndex = 1;
    state.board = {
      members: [{ id: 1, type: 'glulam', owner: 'player-1', a: '0,0,0', b: '1,0,0' }],
      joints: [{ id: '0,0,0', foundationOwner: 'player-1' }, { id: '1,0,0' }],
      connections: [
        { memberId: 1, end: 'a', owner: 'player-1', profile: 'fixed', jointId: '0,0,0' },
        { memberId: 1, end: 'b', owner: 'player-1', profile: 'ball', jointId: '1,0,0' },
      ],
      loads: [{ cardId: 'fixture-load-a', jointId: '1,0,0', magnitude: 5, owner: 'player-1' }],
    };
    state.draft.loads.push({ cardId: 'fixture-load-b', jointId: '1,0,0', magnitude: 45, owner: 'player-2' });
    const result = assessTurnIssues(state).changes.filter(c => c.eligible);
    expect(result.map(c => c.id)).toEqual(['member-overload:1']);
    expect(result[0].before?.utilization).toBeCloseTo(0.122, 3);
    expect(result[0].after.utilization).toBeCloseTo(1.218, 3);
    expect(result[0].after.station).toBe(0);
  });

  it('reports an unloaded double-ball mechanism, withholding unknown forces', () => {
    const state = createTurnGame(1, SCORED_CATALOGUE);
    for (const c of state.board.connections) if (c.memberId === 1) c.profile = 'ball';
    const findings = inspectIssues(state).findings;
    expect(findings.find(f => f.id === 'instability:1')).toMatchObject({ validity: 'verified', active: true });
    expect(findings.find(f => f.id === 'instability:2')).toMatchObject({ validity: 'verified', active: false });
    expect(findings.find(f => f.id === 'member-overload:1')).toMatchObject({ validity: 'unknown', active: null });
  });

  it('carries a known mechanism across a rigid merge and reordering without charging a second time', () => {
    const state = createTurnGame(1, SCORED_CATALOGUE);
    state.board.members.push({ id: 3, a: '1,1,2', b: '2,1,2', type: 'shs', owner: 'player-1' });
    state.board.connections.push({ memberId: 3, end: 'b', jointId: '2,1,2', profile: 'fixed', owner: 'player-1' });
    state.board.joints.push({ id: '2,1,2' });
    const before = inspectIssues(state);
    const merged: TurnState = { ...state, draft: { loads: [], members: [
      { id: 4, a: '2,1,2', b: '3,1,2', type: 'shs', owner: 'player-2' }],
      connections: [{ memberId: 4, end: 'a', jointId: '2,1,2', profile: 'fixed', owner: 'player-2' }] } };
    const after = inspectIssues(merged);
    const changes = compareIssues(before, after);
    expect(changes.changes.filter(c => c.eligible)).toEqual([]);
    expect(changes.changes.find(c => c.id === 'instability:4')?.change).toBe('persistent');
    expect(compareIssues(before, { ...after, findings: [...after.findings].reverse() }).changes.filter(c => c.eligible)).toEqual([]);
    expect(compareIssues(after, before).changes.filter(c => c.eligible)).toEqual([]);
    const unknownPrior = { ...before, findings: before.findings.map(f => f.id === 'instability:3'
      ? { ...f, validity: 'unknown' as const, active: null } : f) };
    expect(compareIssues(unknownPrior, after).changes.find(c => c.id === 'instability:4')?.change).toBe('unknown');
  });

  it('preserves hysteresis, last charged level and uncertain intervals', () => {
    const finding = (u: number | null): IssueFinding => ({
      id: 'member-overload:8', category: 'member-overload', memberId: 8, memberIds: [8],
      reason: u === null ? 'outside verified scope' : 'bending',
      ...(u === null ? { active: null, validity: 'unknown' } : { active: u > 1.001, validity: 'verified', utilization: u }),
    });
    const scope = (u: number | null) => ({ policy: ISSUE_POLICY, modelId: String(u), findings: [finding(u)] });
    const initial = compareIssues(scope(0.8), scope(1.002));
    expect(initial.changes[0].change).toBe('new');
    const jitter = compareIssues(scope(1.002), scope(1.000), initial.memory);
    expect(jitter.changes[0].change).toBe('improved');
    const worsened = compareIssues(scope(1.000), scope(1.102), jitter.memory);
    expect(worsened.changes[0].change).toBe('worsened');
    const lost = compareIssues(scope(1.102), scope(null), worsened.memory);
    expect(lost.changes[0].change).toBe('unknown');
    const back = compareIssues(scope(null), scope(1.9), lost.memory);
    expect(back.changes[0].eligible).toBe(false);
    expect(compareIssues(scope(1.9), scope(1.901), back.memory).changes[0].eligible).toBe(false);
    expect(compareIssues(scope(1.9), scope(0.998), back.memory).changes[0].change).toBe('resolved');
  });
});
