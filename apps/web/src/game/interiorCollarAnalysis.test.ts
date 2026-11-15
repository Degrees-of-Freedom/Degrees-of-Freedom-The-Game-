import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseStructuralAnalysisRequest, parseStructuralAnalysisResult } from '@dof/solver-contract';
import { CANTILEVER_CATALOGUE } from './cardCatalogue';
import { analyzeTurn, prepareReleaseSolver, toTurnEvaluatorInput } from './turnAnalysis';
import { buildTurnRequest, recordTurnAnalysis } from './turnEvidence';
import { analyzeConnectivity } from './connectivity';
import { inspectIssues } from './turnIssues';
import { turnJoints } from './turnPorts';
import { createTurnGame, projectTurnModel, type TurnState } from './turns';
import { displacementAt } from '../evaluator/results';
import { ITEMS } from '../evaluator/sections';
import { sharedJointPermissions } from '../viewer/jointPermissions';
import { toTurnStructuralModel } from './turnStructuralModel';

beforeAll(() => prepareReleaseSolver(() => readFile(new URL('../solver/wasm/dof_solver.wasm', import.meta.url))));

/** Independent ideal-support reference isolates the two free arms from column
 * flexibility. The production setup-column response is covered separately by
 * turn rules/replay fixtures; this reference must not fix a column top in play. */
function fixture(quarter: 1 | 2 | 3): TurnState {
  const turn = createTurnGame(41, CANTILEVER_CATALOGUE);
  turn.board = {
    members: [{ id: 3, type: 'heb', a: '0,2,1', b: '4,2,1', owner: 'player-1',
      cardId: 'frame-fixture', interiorTargets: { [`q${quarter}`]: 'anchor' } }],
    joints: [{ id: 'anchor', point: `${quarter},2,1`, foundationOwner: 'player-1' }],
    connections: [{ memberId: 3, end: `q${quarter}`, jointId: 'anchor', profile: 'fixed',
      owner: 'player-1', cardId: 'collar-fixture' }],
    loads: [{ owner: 'player-1', cardId: 'left-fixture', jointId: 'endpoint:3:a', magnitude: 3 },
      { owner: 'player-2', cardId: 'right-fixture', jointId: 'endpoint:3:b', magnitude: 5 }],
  };
  turn.nextId = 4;
  return turn;
}

describe('Shared table fixed interior collar analysis', () => {
  it.each([1, 2, 3] as const)('keeps both arms continuous at original quarter %i and matches independent mechanics', q => {
    const turn = fixture(q), input = toTurnEvaluatorInput(turn);
    expect(input.members).toHaveLength(2);
    expect(input.members.map(m => [m.a, m.b])).toEqual([
      ['endpoint:3:a', 'anchor'], ['anchor', 'endpoint:3:b'],
    ]);
    expect(input.members.every(m => m.endA === 'fixed' && m.endB === 'fixed')).toBe(true);
    expect(Object.keys(input.attrs)).not.toContain(`port:3:${q}`);
    const result = analyzeTurn(turn, 'card-gravity'), combo = result.combos[0], ctx = result.ctx!;
    expect(result.error).toBeFalsy();
    expect(combo.components?.[0].verification?.status).toBe('verified-nonlinear');
    const at = (id: string) => ctx.aid[ctx.idx.get(id)!];
    const left = displacementAt(combo, at('endpoint:3:a'))!, right = displacementAt(combo, at('endpoint:3:b'))!;
    const EI = ITEMS.heb.E * ITEMS.heb.Iy;
    // The release uses a shear-flexible beam. Include the independent
    // Timoshenko shear term as well as the Euler–Bernoulli bending term.
    const GAv = ITEMS.heb.G * ITEMS.heb.Avz;
    expect(left[2]).toBeCloseTo(-3 * ((2*q)**3 / (3*EI) + (2*q)/GAv), 7);
    expect(right[2]).toBeCloseTo(-5 * ((8-2*q)**3 / (3*EI) + (8-2*q)/GAv), 7);
    expect(Array.from(displacementAt(combo, at('anchor'))!)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(combo.reac![at('anchor')][2]).toBeCloseTo(8, 5);
    expect(combo.reac![at('anchor')][4]).toBeCloseTo(3*2*q - 5*(8-2*q), 3);
    expect(result.capacity?.connections[`3:q${q}`]).toMatchObject({ status: 'verified', station: q/4 });
    expect(analyzeConnectivity(projectTurnModel(turn), turn).groundedMembers.has(3)).toBe(true);
  });

  it('does not connect or split an intended interior contact until its card is fitted', () => {
    const turn = fixture(1);
    turn.board.connections = [];
    const input = toTurnEvaluatorInput(turn);
    expect(input.members).toHaveLength(1);
    expect(input.members[0]).toMatchObject({ a: 'endpoint:3:a', b: 'endpoint:3:b' });
    expect(analyzeConnectivity(projectTurnModel(turn), turn).groundedMembers.has(3)).toBe(false);
    expect(analyzeTurn(turn, 'card-gravity').capacity?.connections).toEqual({});
  });

  it('resolves chained source aliases to one analytical node without losing either original station', () => {
    const turn = fixture(1);
    turn.board.members.push({ id: 4, type: 'heb', a: '1,0,1', b: '1,4,1', owner: 'player-2',
      cardId: 'cross-frame', interiorTargets: { q2: 'port:3:1' } });
    turn.board.connections.push({ memberId: 4, end: 'q2', jointId: 'port:3:1', profile: 'fixed', owner: 'player-2' });
    const input = toTurnEvaluatorInput(turn);
    expect(input.members).toHaveLength(4);
    expect(Object.keys(input.attrs).filter(id => id.startsWith('port:'))).toEqual([]);
    expect(input.members.filter(m => m.a === 'anchor' || m.b === 'anchor')).toHaveLength(4);
    expect(turnJoints(turn).map(j => j.id)).toContain('port:3:1');
    expect(turnJoints(turn).map(j => j.id)).toContain('port:4:2');
  });

  it('keeps one persistent collar overload identity, including direct source loads', () => {
    const turn = fixture(1);
    turn.board.loads.push({ owner: 'player-1', cardId: 'direct-source', jointId: 'port:3:1', magnitude: 800 });
    const result = analyzeTurn(turn, 'card-gravity');
    const findings = inspectIssues(turn, result).findings.filter(f => f.category === 'connection-overload');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ id: 'connection-overload:3:q1', end: 'q1', validity: 'verified', active: true });
    const check = result.capacity!.connections['3:q1'];
    expect(check.status === 'verified' && check.actions.Vz).toBeCloseTo(808, 5);
  });

  it('attributes a fitted endpoint load to the collar source while excluding direct receiving-joint loads', () => {
    const turn = fixture(1);
    turn.board.members.push({ id: 4, type: 'heb', a: '1,2,1', b: '1,3,1', owner: 'player-2', cardId: 'branch' });
    turn.board.connections.push({ memberId: 4, end: 'a', jointId: 'port:3:1', profile: 'fixed', owner: 'player-2' });
    turn.board.loads.push({ cardId: 'branch-end-load', jointId: 'endpoint:4:a', owner: 'player-2', magnitude: 7 },
      { cardId: 'host-load', jointId: 'anchor', owner: 'player-1', magnitude: 11 });
    const check = analyzeTurn(turn, 'card-gravity').capacity!.connections['3:q1'];
    expect(check.status === 'verified' && check.actions.Vz).toBeCloseTo(15, 5);
  });

  it('carries a nested source load across each collar once', () => {
    const turn = fixture(1);
    turn.board.members.push({ id: 4, type: 'heb', a: '1,0,1', b: '1,4,1', owner: 'player-2',
      cardId: 'cross-frame', interiorTargets: { q2: 'port:3:1' } });
    turn.board.connections.push({ memberId: 4, end: 'q2', jointId: 'port:3:1', profile: 'fixed', owner: 'player-2' });
    turn.board.loads.push({ cardId: 'nested-load', jointId: 'port:4:2', owner: 'player-2', magnitude: 7 });
    const checks = analyzeTurn(turn, 'card-gravity').capacity!.connections;
    const nested = checks['4:q2'], outer = checks['3:q1'];
    expect(nested.status === 'verified' && Math.hypot(nested.actions.N, nested.actions.Vy, nested.actions.Vz)).toBeCloseTo(7, 5);
    expect(outer.status === 'verified' && outer.actions.Vz).toBeCloseTo(15, 5);
  });

  it('archives an explicit collar source instead of disguising it as a member end', () => {
    const turn = fixture(1), request = buildTurnRequest(turn, 'collar-match');
    expect(request.snapshot.connections).toEqual([]);
    expect(request.snapshot.loads.map(load => load.target)).toEqual([
      { kind: 'endpoint', id: 'endpoint:3:a' }, { kind: 'endpoint', id: 'endpoint:3:b' },
    ]);
    expect(request.snapshot.selfWeight).toEqual({ enabled: false });
    expect(request.snapshot.collars).toMatchObject([{ id: 'connection:port:3:1',
      definitionVersion: 'fixed-interior-collar-1', source: { memberId: '3', quarter: 1, jointId: 'port:3:1' }, jointId: 'anchor' }]);
    const wrong = structuredClone(request);
    wrong.snapshot.collars![0].source.quarter = 2;
    expect(() => parseStructuralAnalysisRequest(wrong)).toThrow(/exact original station/);
    expect(() => toTurnStructuralModel(turn)).toThrow(/does not translate interior collars/);
    turn.board.joints = turnJoints(turn);
    expect(sharedJointPermissions(turn.board).find(j => j.id === 'port:3:1')).toMatchObject({
      components: ['locked', 'locked', 'locked', 'locked', 'locked', 'locked'],
      attachments: ['Member 3 25% · Fixed / moment'],
    });
  });

  it('validates collar card uniqueness and result scope without reusing an endpoint identity', () => {
    const turn = fixture(1), request = buildTurnRequest(turn, 'collar-match');
    const repeated = structuredClone(request);
    repeated.snapshot.collars!.push({ ...repeated.snapshot.collars![0], id: 'another-collar' });
    expect(() => parseStructuralAnalysisRequest(repeated)).toThrow(/multiple collars|deployed more than once/);
    const archive = recordTurnAnalysis(turn, analyzeTurn(turn, 'card-gravity'), 'stable', '2026-11-15T00:00:00Z', 'collar-match');
    const unavailable = { validity: 'unavailable' as const, reason: 'not-archived' };
    archive.connections.push({ connectionId: 'connection:port:3:1', componentId: archive.components[0].id,
      force: unavailable, relativeMotion: unavailable, utilization: unavailable });
    expect(() => parseStructuralAnalysisResult(archive)).not.toThrow();
    archive.components[0].jointIds = archive.components[0].jointIds.filter(id => id !== 'port:3:1');
    expect(() => parseStructuralAnalysisResult(archive)).toThrow(/outside component/);
  });
});
