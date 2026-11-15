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
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain('self-weight');
    expect(notes[1]).toContain('25 kN pretension');
    expect(toStructuralModel({ ...frame, members: frame.members.slice(0, 2) }).notes).toHaveLength(1);
    // Nonlinear analysis is opt-in: no option, no analysis object.
    expect(model.analysis).toBeUndefined();
    expect(toStructuralModel(frame, { fidelity: 'nonlinear' }).model.analysis).toEqual({ type: 'corotational' });
    expect(toStructuralModel(frame, { fidelity: 'linear' }).model.analysis).toEqual({ fidelity: 'linear' });
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

describe('corotational service translation', () => {
  it('includes physical member laws and explicit loads only when requested', () => {
    const linear = toStructuralModel(frame);
    const nonlinear = toStructuralModel(frame, true);
    expect(linear.model.analysis).toBeUndefined();
    expect(nonlinear.model.analysis).toEqual({ type: 'corotational' });
    expect(nonlinear.model.members[0].law?.kind).toBe('frame');
    expect(nonlinear.model.members[2].law?.kind).toBe('cable');
    expect(nonlinear.model.loads).toEqual(linear.model.loads);
    expect(nonlinear.notes.join(' ')).toContain('Self-weight');
  });
});

describe('live corotational editor request', () => {
  it.skipIf(!process.env.VITE_OPENSEES_URL)('returns nonlinear equilibrium through the adapter', async () => {
    const model: GameModel = { nextId: 2, members: [{ id: 1, type: 'shs', a: '0,0,0', b: '0,0,2' }], attrs: {
      '0,0,0': { found: true, joint: true }, '0,0,2': { joint: true, load: 1 },
    } };
    const solver = createOpenSeesSolver(process.env.VITE_OPENSEES_URL!);
    const result = await solver.analyze(toStructuralModel(model, true).model);
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.nonlinear?.segmentsPerFrame).toBeGreaterThan(0);
      expect(result.reactions?.['0,0,0']?.[2]).toBeCloseTo(1000, 1);
    }
  });
});
