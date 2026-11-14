import { describe, expect, it } from 'vitest';
import { exampleModel } from './examples';
import type { GameModel, LevelId } from './model';
import { toStructuralModel } from './structuralModel';
import { resolveSolver } from '../solver';
import { createOpenSeesSolver } from '../solver/opensees';
import { unavailableSolver } from '../solver/unavailable';

const frame: GameModel = {
  nextId: 4,
  members: [
    { id: 1, a: '0,0,0', b: '0,0,2', type: 'shs' },
    { id: 2, a: '0,0,2', b: '1,0,2', type: 'ipe' },
    { id: 3, a: '1,0,2', b: '1,0,0', type: 'cable' },
  ],
  attrs: {
    '0,0,0': { found: true },
    '0,0,2': { joint: true },
    '1,0,2': { load: 50, joint: true },
  },
};

describe('game model to solver contract', () => {
  const { model, notes } = toStructuralModel(frame);

  it('places nodes on the 2 m grid with Z vertical', () => {
    expect(model.units).toBe('SI');
    expect(model.nodes).toContainEqual({ id: '0,0,2', position: [0, 0, 4] });
    expect(model.nodes).toContainEqual({ id: '1,0,2', position: [2, 0, 4] });
    expect(model.nodes).toHaveLength(4);
  });

  it('makes ends rigid only at moment connections', () => {
    const [column, beam] = model.members;
    expect(column).toMatchObject({ id: '1', startFixity: 'pinned', endFixity: 'fixed' });
    expect(beam).toMatchObject({ id: '2', startFixity: 'fixed', endFixity: 'fixed' });
  });

  it('pins cables even at a moment connection and says what that loses', () => {
    expect(model.members[2]).toMatchObject({ startFixity: 'pinned', endFixity: 'pinned' });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('Cables');
    expect(toStructuralModel({ ...frame, members: frame.members.slice(0, 2) }).notes).toEqual([]);
  });

  it('fixes foundations and applies point loads downwards in newtons', () => {
    expect(model.supports).toEqual([
      { nodeId: '0,0,0', restrained: [true, true, true, true, true, true] },
    ]);
    expect(model.loads).toEqual([
      { nodeId: '1,0,2', force: [0, 0, -50_000], moment: [0, 0, 0] },
    ]);
  });

  it('refers only to nodes it defines, for every reference example', () => {
    for (const id of ['tower1', 'bridge1', 'pickup1'] satisfies LevelId[]) {
      const translated = toStructuralModel(exampleModel(id)!).model;
      const ids = new Set(translated.nodes.map((node) => node.id));
      const referenced = [
        ...translated.members.flatMap((m) => [m.startNodeId, m.endNodeId]),
        ...translated.supports.map((s) => s.nodeId),
        ...translated.loads.map((l) => l.nodeId),
      ];
      expect(referenced.every((nodeId) => ids.has(nodeId))).toBe(true);
    }
  });

  // Opt-in check against a running service:
  //   VITE_OPENSEES_URL=http://127.0.0.1:8000 npm test
  const liveUrl: string | undefined = import.meta.env.VITE_OPENSEES_URL;
  it.skipIf(!liveUrl)('gets a stability report for the reference examples from a live service', async () => {
    const solver = createOpenSeesSolver(liveUrl!);
    for (const id of ['tower1', 'bridge1', 'pickup1'] satisfies LevelId[]) {
      const result = await solver.analyze(toStructuralModel(exampleModel(id)!).model);
      if (result.status !== 'success' && result.status !== 'unstable')
        throw new Error(`${id}: ${JSON.stringify(result)}`);
      expect(result.stability?.freeDofs).toBeGreaterThan(0);
    }
    // A lone unsupported bar is six rigid-body mechanisms.
    const floating = await solver.analyze(
      toStructuralModel({ nextId: 2, attrs: {}, members: [{ id: 1, a: '0,0,0', b: '1,0,0', type: 'shs' }] }).model,
    );
    expect(floating.status).toBe('unstable');
  });
});

describe('solver selection', () => {
  it('uses the in-browser solver unless an OpenSees service is asked for', () => {
    expect(resolveSolver({ VITE_OPENSEES_URL: 'http://solver.test' }).id).toBe('opensees');
    expect(resolveSolver({ VITE_SOLVER: 'opensees' }).id).toBe('opensees');
    expect(resolveSolver({}).id).toBe('dof-wasm');
    expect(resolveSolver({}, false)).toBe(unavailableSolver);
  });
});
