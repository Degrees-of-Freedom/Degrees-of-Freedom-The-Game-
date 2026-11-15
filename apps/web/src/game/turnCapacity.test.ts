import { describe, expect, it } from 'vitest';
import { analyzeTurn } from './turnAnalysis';
import { createTurnGame, type TurnState } from './turns';
import type { MemberType } from './model';
import type { CapacityCheck } from '../solver/voxelCapacity';

function verified(check: CapacityCheck) {
  expect(check.status).toBe('verified');
  if (check.status !== 'verified') throw Error(check.reason);
  return check;
}

function cantilever(type: MemberType, tip: string, load: number) {
  const state = createTurnGame(5);
  state.board = {
    members: [{ id: 1, type, a: '0,0,0', b: tip, owner: 'player-1' }],
    connections: [
      { memberId: 1, end: 'a', jointId: '0,0,0', profile: 'fixed', owner: 'player-1' },
      { memberId: 1, end: 'b', jointId: tip, profile: 'ball', owner: 'player-1' },
    ],
    joints: [{ id: '0,0,0', foundationOwner: 'player-1' }, { id: tip }],
    loads: [{ cardId: 'load-fixture', jointId: tip, owner: 'player-2', magnitude: load }],
  };
  return state;
}

describe('Shared table card-strength-1 evidence', () => {
  it.each([5, 50])('resolves an isolated timber beam under a %i kN gravity load', load => {
    const state = cantilever('glulam', '1,0,0', load);
    const result = analyzeTurn(state, 'card-gravity');
    const check = verified(result.capacity!.members[1]);
    // 2 m cantilever. The printed bending strength is 15.4 MPa and Wy = 5333 cm³.
    expect(check.station).toBe(0);
    expect(Math.abs(check.actions.My)).toBeCloseTo(2 * load, 8);
    expect(check.utilization).toBeCloseTo(2 * load / (5.333e-3 * 15400), 8);
    expect(check.utilization > 1.001).toBe(load === 50);
    const connection = verified(result.capacity!.connections['1:b']);
    expect(connection.utilization).toBeCloseTo(load / 350, 9);
    expect(Math.hypot(connection.actions.T, connection.actions.My, connection.actions.Mz)).toBeCloseTo(0, 9);
    expect(result.mechanism).toBe(false);
    expect(analyzeTurn(state).capacity).toBeUndefined();
  });

  it('detects an overloaded physical end independently of an adequate HEB section', () => {
    const state = cantilever('heb', '0,0,1', 800);
    const result = analyzeTurn(state, 'card-gravity');
    const member = verified(result.capacity!.members[1]);
    expect(member.actions.N).toBeCloseTo(-800, 8);
    expect(member.utilization).toBeCloseTo(800/(0.0149 * 355000), 8);
    expect(verified(result.capacity!.connections['1:a']).utilization).toBeCloseTo(800/700, 8);
    expect(verified(result.capacity!.connections['1:b']).utilization).toBeCloseTo(800/350, 8);
  });

  it('includes torsion from an eccentric applied load in both section and connector interactions', () => {
    const state = cantilever('heb', '1,0,0', 0.1);
    state.board.connections[1].profile = 'fixed';
    state.board.members.push({ id: 2, type: 'heb', a: '1,0,0', b: '1,1,0', owner: 'player-2' });
    state.board.joints.push({ id: '1,1,0' });
    state.board.connections.push({ memberId: 2, end: 'a', jointId: '1,0,0', profile: 'fixed', owner: 'player-2' },
      { memberId: 2, end: 'b', jointId: '1,1,0', profile: 'fixed', owner: 'player-2' });
    state.board.loads[0].jointId = '1,1,0';
    const report = analyzeTurn(state, 'card-gravity').capacity!;
    const root = verified(report.members[1]);
    expect(Math.abs(root.actions.T)).toBeCloseTo(0.2, 8);
    expect(Math.abs(root.actions.My)).toBeCloseTo(0.2, 8);
    const normal = 0.2/(1.678e-3 * 355000);
    const shear = 0.1/(0.00474 * 205000) + 0.2/18;
    expect(root.utilization).toBeCloseTo(Math.hypot(normal, shear), 8);
    expect(verified(report.connections['1:a']).utilization).toBeCloseTo(Math.hypot(0.1/700, Math.hypot(0.2, 0.2)/220), 8);
  });

  it('maps the critical cut to the dealt parent and never treats internal continuity as a card', () => {
    const state = cantilever('glulam', '2,0,0', 5);
    const port = 'port:1:1';
    state.board.members.push({ id: 2, type: 'shs', a: '0.5,0,0', b: '0.5,1,0', owner: 'player-2' });
    state.board.joints.push({ id: port, point: '0.5,0,0' });
    state.board.connections.push({ memberId: 2, end: 'a', jointId: port, profile: 'fixed', owner: 'player-2' });
    state.board.loads[0].jointId = port;
    const report = analyzeTurn(state, 'card-gravity').capacity!;
    expect(Object.keys(report.members).sort()).toEqual(['1', '2']);
    expect(Object.keys(report.connections).sort()).toEqual(['1:a', '1:b', '2:a']);
    const root = verified(report.members[1]);
    expect(root.station).toBe(0);
    expect(Math.abs(root.actions.My)).toBeCloseTo(5, 9);
  });

  it('preserves valid neighbours and withholds unsupported, singular, cable or slender capacities', () => {
    const state = cantilever('glulam', '1,0,0', 5);
    const cases: [MemberType, string, string, 'fixed' | 'ball', boolean][] = [
      ['shs', '2,0,0', '2,0,1', 'fixed', false],
      ['shs', '3,0,0', '3,0,1', 'ball', true],
      ['cable', '4,0,0', '4,0,1', 'ball', true],
      ['shs', '5,0,0', '5,0,8', 'fixed', true],
    ];
    for (const [index, [type, a, b, profile, supported]] of cases.entries()) {
      const id = index + 2;
      state.board.members.push({ id, a, b, type, owner: 'player-1' });
      const root: TurnState['board']['joints'][number] = { id: a };
      if (supported) root.foundationOwner = 'player-1';
      state.board.joints.push(root, { id: b });
      state.board.connections.push({ memberId: id, end: 'a', jointId: a, profile, owner: 'player-1' },
        { memberId: id, end: 'b', jointId: b, profile: 'ball', owner: 'player-1' });
    }
    const report = analyzeTurn(state, 'card-gravity').capacity!;
    expect(report.members[1].status).toBe('verified');
    for (const id of [2, 3, 4, 5]) {
      for (const check of [report.members[id], report.connections[`${id}:a`]]) {
        expect(check.status).toBe('unavailable');
        expect(check).not.toHaveProperty('utilization');
      }
    }
  });
});
