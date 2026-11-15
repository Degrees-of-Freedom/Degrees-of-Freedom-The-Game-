import { describe, expect, it } from 'vitest';
import { readSession, writeSession } from './session';
import { analyzeCompletedTurn, toTurnVoxelInput } from './turnAnalysis';
import { buildTurnRequest } from './turnEvidence';
import { S } from '../solver/voxelSections';
import { activeTurnHand, createTurnGame, endTurn, stageElement, stageLoad } from './turns';

function memoryStorage() {
  const data = new Map<string, string>();
  const storage: Storage = {
    get length() { return data.size; },
    key: (index) => Array.from(data.keys())[index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
    clear: () => { data.clear(); },
  };
  return storage;
}

describe('Shared table analysis persistence', () => {
  it('restores the same archived loads, reactions, and lineage with the turn history', () => {
    let start = createTurnGame();
    for (let seed = 2; !activeTurnHand(start).some(card => card.kind === 'load'); seed++) start = createTurnGame(seed);
    const card = activeTurnHand(start).find(entry => entry.kind === 'load')!;
    const loaded = stageLoad(start, card.id, '5,3,1');
    if (!loaded.ok) throw new Error(loaded.reason);
    const first = analyzeCompletedTurn(loaded.state, () => 'match-test');
    expect(first.analysis.request.snapshot.loads).toMatchObject([{
      id: card.id, force: [0, 0, -card.magnitude * 1000], persistent: true,
    }]);
    expect(first.analysis.foundations[0].reaction).toMatchObject({
      validity: 'unverified', value: [0, 0, expect.any(Number), 0, 0, 0],
    });
    const turn = endTurn(loaded.state, start.turn, first.status, first.analysis);
    if (!turn.ok) throw new Error(turn.reason);
    const second = analyzeCompletedTurn(turn.state, () => { throw new Error('Match ID changed'); });
    expect(second.analysis.request.snapshot.parentRevisionId).toBe('turn-1');
    const next = endTurn(turn.state, turn.state.turn, second.status, second.analysis);
    if (!next.ok) throw new Error(next.reason);
    const storage = memoryStorage();
    expect(writeSession(storage, { mode: 'multiplayer', style: 'kit', turn: next.state })).toBe(true);
    const restored = readSession(storage);
    expect(restored).toMatchObject({ status: 'found', session: { turn: { turn: 3 } } });
    if (restored.status !== 'found') throw new Error('Session did not reload');
    expect(restored.session.turn?.reports.map(({ analysis }) => analysis)).toEqual([first.analysis, second.analysis]);
    const key = storage.key(0)!;
    const raw = storage.getItem(key)!;
    storage.setItem(key, raw.replace('"parentRevisionId":"turn-1"', '"parentRevisionId":"wrong"'));
    expect(readSession(storage)).toMatchObject({ status: 'invalid' });
  });

  it('loads the previous event format without manufacturing analysis history', () => {
    const storage = memoryStorage();
    storage.setItem('dof-runtime:session', JSON.stringify({
      version: 1, mode: 'multiplayer', style: 'kit',
      turn: { version: 1, seed: 1, events: [{ kind: 'end', turn: 1, status: 'stable' }] },
    }));
    const restored = readSession(storage);
    expect(restored).toMatchObject({ status: 'found', session: { turn: { turn: 2, reports: [{ status: 'stable' }] } } });
    if (restored.status !== 'found') throw new Error('Session did not reload');
    expect(restored.session.turn?.reports[0].analysis).toBeUndefined();
  });

  it('leaves new member ends distinct where they coincide with a joint', () => {
    const start = createTurnGame();
    const card = start.players[0].hand.find((entry) => entry.kind === 'element')!;
    const point = start.board.joints[0].id;
    const [x, y, z] = point.split(',').map(Number);
    const placed = stageElement(start, card.id, point, `${x + 1},${y},${z}`);
    if (!placed.ok) throw new Error(placed.reason);
    const { analysis } = analyzeCompletedTurn(placed.state, () => 'match-test');
    const snapshot = analysis.request.snapshot;
    const end = snapshot.members.at(-1)!.start;
    expect(end.position).toEqual(snapshot.joints.find(({ id }) => id === point)?.position);
    expect(snapshot.connections.some(({ endpointId }) => endpointId === end.id)).toBe(false);
    expect(toTurnVoxelInput(placed.state).members.at(-1)?.a).toBe(end.id);
  });
});

describe('Shared table analysis archive', () => {
  it('locates quarter-port and system repair joints by their stored point, not by their id', () => {
    const start = createTurnGame();
    // Ids like these are not grid keys. Reading a position from the id gave
    // NaN, the archive was rejected, and every later End turn was blocked.
    const turn = { ...start, board: { ...start.board, joints: [
      ...start.board.joints,
      { id: 'neutral:1:4:ground', point: '4.5,3.5,0' },
      { id: 'port:7:2', point: '2,3,1.5' },
    ] } };
    const { joints } = buildTurnRequest(turn, 'match-test').snapshot;
    expect(joints.find(joint => joint.id === 'neutral:1:4:ground')?.position).toEqual([4.5 * S, 3.5 * S, 0]);
    expect(joints.find(joint => joint.id === 'port:7:2')?.position).toEqual([2 * S, 3 * S, 1.5 * S]);
    expect(joints.every(joint => joint.position.every(Number.isFinite))).toBe(true);
    expect(() => analyzeCompletedTurn(turn, () => 'match-test')).not.toThrow();
  });
});
