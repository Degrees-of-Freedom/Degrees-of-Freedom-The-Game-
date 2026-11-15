import { describe, expect, it } from 'vitest';
import { exampleModel } from './examples';
import type { GameModel, LevelId } from './model';
import { toStructuralModel } from './structuralModel';
import { solverFor, solverForSettings, wasmSolver } from '../solver';
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
    expect(notes.some((note) => note.includes('Cables'))).toBe(true);
    expect(notes.some((note) => note.includes('self-weight'))).toBe(true);
    expect(toStructuralModel({ ...frame, members: frame.members.slice(0, 2) }).notes.some((note) => note.includes('Cables'))).toBe(false);
  });

  it('fixes foundations and applies point loads downwards in newtons', () => {
    expect(model.supports).toEqual([
      { nodeId: '0,0,0', restrained: [true, true, true, true, true, true] },
    ]);
    expect(model.loads).toEqual([
      { nodeId: '1,0,2', force: [0, 0, -50_000], moment: [0, 0, 0] },
    ]);
  });

  it('opts into corotational catalogue sections and a tension-only rest length', () => {
    const model = toStructuralModel(frame, true).model;
    expect(model.analysis?.type).toBe('corotational');
    expect(model.members[0].law).toMatchObject({ kind: 'frame', elasticModulus: 210e9 });
    const cable = model.members[2].law;
    if (cable?.kind !== 'cable') throw new Error('Expected a cable law');
    expect(cable.elasticModulus * cable.area * (4 / cable.restLength - 1)).toBeCloseTo(25_000, 5);
    expect(toStructuralModel(frame).model.members[2].law).toBeUndefined();
  });

  it('preserves partial restraint masks and directional loads in SI units', () => {
    const translated = toStructuralModel({ ...frame, attrs: {
      ...frame.attrs,
      '0,0,0': { found: true, restraint: [true, false, true, false, false, true] },
      '1,0,2': { load: 12, loadDirection: '-Y', joint: true },
    } }).model;
    expect(translated.supports).toEqual([{ nodeId: '0,0,0', restrained: [true, false, true, false, false, true] }]);
    expect(translated.loads).toEqual([{ nodeId: '1,0,2', force: [0, -12000, 0], moment: [0, 0, 0] }]);
  });

  it('discloses the axial-only approximation for a beam pinned at both ends', () => {
    const game: GameModel = { members: [{ id: 1, a: '0,0,0', b: '0,0,2', type: 'shs' }], attrs: { '0,0,0': { found: true } }, nextId: 2 };
    expect(toStructuralModel(game).notes.some((note) => note.includes('axial-only'))).toBe(true);
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
  it('uses the in-browser Rust solver or the OpenSees service at the chosen address', () => {
    expect(solverFor('rust', 'http://solver.test')).toBe(wasmSolver);
    expect(solverFor('rust', 'http://solver.test', false)).toBe(unavailableSolver);
    const opensees = solverFor('opensees', 'http://solver.test');
    expect(opensees.id).toBe('opensees');
    // The same address gives the same adapter, so a check is not reset on every render.
    expect(solverForSettings({ solver: 'opensees', openSeesUrl: 'http://solver.test' })).toBe(opensees);
    expect(solverFor('opensees', 'http://other.test')).not.toBe(opensees);
  });
});
