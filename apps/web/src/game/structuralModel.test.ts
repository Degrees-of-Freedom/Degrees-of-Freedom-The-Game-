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

  it('makes ends rigid only at moment connections and releases bending elsewhere', () => {
    const fixed = { laws: ['locked', 'locked', 'locked', 'locked', 'locked', 'locked'] };
    const bendingFree = { laws: ['locked', 'locked', 'locked', 'locked', 'free', 'free'] };
    const [column, beam] = model.members;
    expect(column).toMatchObject({ id: '1', kind: 'beam', startConnection: bendingFree, endConnection: fixed });
    expect(beam).toMatchObject({ id: '2', kind: 'beam', startConnection: fixed, endConnection: fixed });
    expect(column.startFixity).toBeUndefined();
  });

  it('resolves catalog sections to SI properties', () => {
    // SHS 100x6: E 210e6 kN/m^2 -> 210 GPa, weight 0.176 kN/m -> 176 N/m.
    expect(model.members[0].properties).toEqual({
      elasticModulus: 210e9, shearModulus: 81e9, area: 2.24e-3,
      inertiaY: 3.2e-6, inertiaZ: 3.2e-6, torsionConstant: 5.13e-6, weightPerLength: 176,
    });
    // Glulam keeps its strong axis Iy (0.2 x 0.4 section) on local Y.
    const glulam = toStructuralModel({ nextId: 2, attrs: {}, members: [{ id: 1, a: '0,0,0', b: '1,0,0', type: 'glulam' }] });
    expect(glulam.model.members[0].properties).toMatchObject({ inertiaY: 1.0667e-3, inertiaZ: 2.667e-4 });
  });

  it('reproduces the voxel local axes through orientation', () => {
    const [column, beam] = model.members;
    expect(column.orientation).toEqual([0, 1, 0]); // vertical: voxel uses global Y
    expect(beam.orientation).toEqual([-0, 2, 0]); // Z x (1,0,0) = (0,1,0), scaled by length
  });

  it('sends cables as tension-only members with pretension as initial strain', () => {
    const cable = model.members[2];
    expect(cable).toMatchObject({ id: '3', kind: 'cable' });
    expect(cable.startConnection).toBeUndefined();
    // P0 25 kN / (E 160e6 kN/m^2 * A 3.6e-4 m^2)
    expect(cable.initialStrain).toBeCloseTo(25 / (160e6 * 3.6e-4), 12);
    expect(model.members[0].initialStrain).toBeUndefined();
    expect(cable.properties?.elasticModulus).toBe(160e9);
  });

  it('says what it does not carry', () => {
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('self-weight');
    expect(model.analysis).toBeUndefined();
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
  it('uses the configured service, the local one in development, and none otherwise', () => {
    expect(resolveSolver({ VITE_OPENSEES_URL: 'http://solver.test' }).id).toBe('opensees');
    expect(resolveSolver({ DEV: true }).id).toBe('opensees');
    expect(resolveSolver({ DEV: false })).toBe(unavailableSolver);
  });
});
