import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { AnalysisModel, AnalysisSection, StructuralModel } from '@dof/solver-contract';
import { exampleModel } from '../../game/examples';
import type { LevelId } from '../../game/model';
import { toStructuralModel } from '../../game/structuralModel';
import { createWasmSolver } from './wasmSolver';

/** Node cannot `fetch` a file path, so the tests read the module from disk. */
const fromDisk = () => readFile(new URL('./dof_solver.wasm', import.meta.url));
const solver = createWasmSolver(fromDisk);

const FIXED = [true, true, true, true, true, true] as const;
const steel: AnalysisSection = { id: 'steel', E: 210e9, G: 81e9, A: 7.49e-3, Iy: 4.47e-5, Iz: 4.47e-5, J: 7.03e-5 };

const cantilever: StructuralModel = {
  units: 'SI',
  nodes: [{ id: 'a', position: [0, 0, 0] }, { id: 'b', position: [3, 0, 0] }],
  members: [{ id: 'm', startNodeId: 'a', endNodeId: 'b' }],
  supports: [{ nodeId: 'a', restrained: FIXED }],
  loads: [{ nodeId: 'b', force: [0, 0, -1000], moment: [0, 0, 0] }],
  // Closed-form answers are linear; the contract defaults to nonlinear.
  analysis: { fidelity: 'linear' },
};

/** An unsymmetric section, so that mixing up local Y and Z shows. */
const ipe = { elasticModulus: 210e9, shearModulus: 81e9, area: 5.38e-3, inertiaY: 8.356e-5, inertiaZ: 6.04e-6, torsionConstant: 2.01e-7 };

describe('Rust WebAssembly solver, original contract', () => {
  it('matches the closed-form cantilever and the OpenSees reference value', async () => {
    const result = await solver.analyze(cantilever);
    if (result.status !== 'success') throw new Error(JSON.stringify(result));
    // Tip deflection P L^3 / (3 E I): the value the OpenSees adapter test expects.
    expect(result.displacements.b[2]).toBeCloseTo(-9.5877e-4, 7);
    expect(result.memberForces?.m.momentStart).toBeCloseTo(3000, 6);
    expect(result.memberForces?.m.shear).toBeCloseTo(1000, 6);
    expect(result.reactions?.a[2]).toBeCloseTo(1000, 6);
    expect(result.stability).toMatchObject({ stable: true, freeDofs: 6, mechanisms: 0, staticIndeterminacy: 0 });
  });

  it('reports a floating bar as six rigid-body mechanisms', async () => {
    const result = await solver.analyze({ ...cantilever, supports: [], loads: [] });
    if (result.status !== 'unstable') throw new Error(JSON.stringify(result));
    // Five motions move a node; the sixth spins the bar about its own axis.
    expect(result.stability.mechanisms).toBe(6);
    expect(result.stability.unstableNodeIds).toEqual(['a', 'b']);
  });

  it('treats a member pinned at both ends as axial and merges supports on a node', async () => {
    const result = await solver.analyze({
      units: 'SI',
      nodes: [{ id: 'a', position: [0, 0, 0] }, { id: 'b', position: [0, 0, 2] }, { id: 'lonely', position: [9, 9, 9] }],
      members: [{ id: 'm', startNodeId: 'a', endNodeId: 'b', startFixity: 'pinned', endFixity: 'pinned' }],
      supports: [
        { nodeId: 'a', restrained: [true, true, true, false, false, false] },
        { nodeId: 'b', restrained: [true, false, false, false, false, false] },
        { nodeId: 'b', restrained: [false, true, false, false, false, false] },
      ],
      loads: [{ nodeId: 'b', force: [0, 0, 5000], moment: [0, 0, 0] }],
    });
    if (result.status !== 'success') throw new Error(JSON.stringify(result));
    expect(result.memberForces?.m.axial).toBeCloseTo(5000, 6);
    expect(result.reactions?.a[2]).toBeCloseTo(-5000, 6);
    expect(result.displacements.lonely).toBeUndefined();
    expect(result.warnings.join(' ')).toContain('1 node(s) with no members');
  });

  it('returns an error result for a model that cannot be analysed', async () => {
    const result = await solver.analyze({ ...cantilever, members: [{ id: 'm', startNodeId: 'a', endNodeId: 'nowhere' }] });
    expect(result).toEqual({ status: 'error', message: expect.stringContaining('does not exist') });
  });

  it('uses the member properties, with local Y following the orientation as the contract defines', async () => {
    // Along X with local Y = global Z: a vertical load bends about local Z.
    const result = await solver.analyze({
      ...cantilever,
      members: [{ id: 'm', startNodeId: 'a', endNodeId: 'b', properties: ipe, orientation: [0, 0, 1] }],
    });
    if (result.status !== 'success') throw new Error(JSON.stringify(result));
    expect(result.displacements.b[2]).toBeCloseTo((-1000 * 27) / (3 * 210e9 * ipe.inertiaZ), 9);
    // Turned so local Y = global Y: the same load now bends about local Y.
    const turned = await solver.analyze({
      ...cantilever,
      members: [{ id: 'm', startNodeId: 'a', endNodeId: 'b', properties: ipe, orientation: [0, 1, 0] }],
    });
    if (turned.status !== 'success') throw new Error(JSON.stringify(turned));
    expect(turned.displacements.b[2]).toBeCloseTo((-1000 * 27) / (3 * 210e9 * ipe.inertiaY), 10);
  });

  it('maps six-axis connections onto the right local axes, including springs', async () => {
    // A rotational spring about local Z at the root adds P L^2 / k for a load along local Y.
    const k = 2e6;
    const spring = (axis: number) => {
      const laws = ['locked', 'locked', 'locked', 'locked', 'locked', 'locked'] as const;
      const stiffness = [0, 0, 0, 0, 0, 0] as [number, number, number, number, number, number];
      stiffness[axis] = k;
      return { laws: laws.map((law, i) => (i === axis ? 'elastic' : law)) as unknown as typeof laws, stiffness };
    };
    const rigid = (-1000 * 27) / (3 * 210e9 * ipe.inertiaZ);
    for (const [axis, extra] of [[5, (-1000 * 9) / k], [4, 0]] as const) {
      const result = await solver.analyze({
        ...cantilever,
        members: [{ id: 'm', startNodeId: 'a', endNodeId: 'b', properties: ipe, orientation: [0, 0, 1], startConnection: spring(axis) }],
      });
      if (result.status !== 'success') throw new Error(JSON.stringify(result));
      expect(result.displacements.b[2]).toBeCloseTo(rigid + extra, 9);
    }
  });

  it('applies self-weight from the weight per length, and the standard section weighs 577 N/m', async () => {
    const result = await solver.analyze({ ...cantilever, loads: [], analysis: { fidelity: 'linear', selfWeight: true } });
    if (result.status !== 'success') throw new Error(JSON.stringify(result));
    expect(result.reactions.a[2]).toBeCloseTo(577 * 3, 6);
    const light = await solver.analyze({
      ...cantilever,
      loads: [],
      members: [{ id: 'm', startNodeId: 'a', endNodeId: 'b', properties: { ...ipe, weightPerLength: 422 } }],
      analysis: { fidelity: 'linear', selfWeight: true },
    });
    if (light.status !== 'success') throw new Error(JSON.stringify(light));
    expect(light.reactions.a[2]).toBeCloseTo(422 * 3, 6);
  });

  it('carries cables with pretension, reports slack ones, and flags a displacement limit', async () => {
    const rod = { elasticModulus: 160e9, shearModulus: 0, area: 3.6e-4, inertiaY: 0, inertiaZ: 0, torsionConstant: 0 };
    const pretension = 25e3 / (160e9 * 3.6e-4);
    const model = {
      units: 'SI' as const,
      nodes: [{ id: 'w', position: [-3, 0, 0] as const }, { id: 'n', position: [0, 0, 0] as const }, { id: 'e', position: [3, 0, 0] as const }],
      members: [
        { id: 'left', kind: 'cable' as const, startNodeId: 'w', endNodeId: 'n', properties: rod, initialStrain: pretension },
        { id: 'right', kind: 'cable' as const, startNodeId: 'n', endNodeId: 'e', properties: rod, initialStrain: pretension },
      ],
      supports: [
        { nodeId: 'w', restrained: FIXED },
        { nodeId: 'e', restrained: FIXED },
        { nodeId: 'n', restrained: [false, true, true, true, true, true] as const },
      ],
      // 60 kN towards w is more than the 25 kN pretension can hold back.
      loads: [{ nodeId: 'n', force: [-60e3, 0, 0] as const, moment: [0, 0, 0] as const }],
    };
    const result = await solver.analyze(model);
    if (result.status !== 'success') throw new Error(JSON.stringify(result));
    // The cable towards the load goes slack; the other carries all of it.
    expect(result.memberForces.left).toMatchObject({ state: 'slack', axial: 0 });
    expect(result.memberForces.right).toMatchObject({ state: 'active' });
    expect(result.memberForces.right.axial).toBeCloseTo(60e3, 0);
    expect(result.components[0].reasonCodes).toContain('cable_slack');
    expect(result.analysis.fidelity).toBe('nonlinear');
    const limited = await solver.analyze({ ...model, analysis: { displacementLimit: 1e-6 } });
    if (limited.status !== 'success') throw new Error(JSON.stringify(limited));
    expect(limited.components[0]).toMatchObject({ state: 'marginal', reasonCodes: expect.arrayContaining(['excessive_deformation']) });
  });

  it('reports what the Rust solver cannot represent as unsupported', async () => {
    const cases: StructuralModel['members'][] = [
      [{ id: 'm', startNodeId: 'a', endNodeId: 'b', initialStrain: 1e-4 }],
      [{ id: 'm', startNodeId: 'a', endNodeId: 'b', kind: 'brace', startFixity: 'free' }],
      [{ id: 'm', startNodeId: 'a', endNodeId: 'b', startFixity: 'pinned', startConnection: { laws: ['locked', 'locked', 'locked', 'free', 'free', 'free'] } }],
      [{ id: 'm', startNodeId: 'a', endNodeId: 'b', startConnection: { laws: ['locked', 'locked', 'locked', 'locked', 'locked', 'elastic'] } }],
    ];
    for (const members of cases)
      expect(await solver.analyze({ ...cantilever, members })).toEqual({ status: 'unsupported', message: expect.any(String) });
  });

  it('analyses the reference examples through the game translation', async () => {
    for (const id of ['tower1', 'bridge1', 'pickup1'] satisfies LevelId[]) {
      const result = await solver.analyze(toStructuralModel(exampleModel(id)!).model);
      if (result.status !== 'success' && result.status !== 'unstable') throw new Error(`${id}: ${JSON.stringify(result)}`);
      expect(result.stability?.freeDofs).toBeGreaterThan(0);
    }
  });
});

/** A guyed mast: a beam column, a tension-only cable either side, self-weight. */
const mast: AnalysisModel = {
  version: 'turn-7',
  nodes: [
    { id: 'base', position: [0, 0, 0] },
    { id: 'top', position: [0, 0, 6] },
    { id: 'west', position: [-4, 0, 0] },
    { id: 'east', position: [4, 0, 0] },
  ],
  sections: [
    { ...steel, density: 7850, capacity: { compression: 5e5, momentY: 4e4, momentZ: 4e4 } },
    { id: 'rod', E: 210e9, A: 3e-4, density: 7850, capacity: { tension: 6e4 } },
  ],
  members: [
    { id: 'mast', startNodeId: 'base', endNodeId: 'top', sectionId: 'steel', start: { laws: ['rigid', 'rigid', 'rigid', 'rigid', 'free', 'free'] } },
    { id: 'guy-west', kind: 'cable', startNodeId: 'west', endNodeId: 'top', sectionId: 'rod' },
    { id: 'guy-east', kind: 'cable', startNodeId: 'east', endNodeId: 'top', sectionId: 'rod' },
  ],
  foundations: [
    { id: 'player-1', nodeId: 'base', restrained: FIXED },
    { id: 'player-2', nodeId: 'west', restrained: FIXED },
    { id: 'player-3', nodeId: 'east', restrained: FIXED },
  ],
  loads: [{ id: 'wind', nodeId: 'top', force: [8000, 0, 0] }],
};

describe('Rust WebAssembly solver, detailed contract', () => {
  it('resolves a guyed mast with a slack cable, signed reactions and utilisation', async () => {
    const result = await solver.analyzeDetailed(mast, { gravity: [0, 0, -9.81] });
    expect(result.analysis).toMatchObject({ status: 'ok', modelVersion: 'turn-7', fidelity: 'nonlinear', units: 'SI' });
    expect(result.analysis.runtimeMs).toBeGreaterThanOrEqual(0);
    expect(result.components).toHaveLength(1);
    const [component] = result.components;
    // The mast is hinged at its base, so it stands only because of the guys:
    // out of their plane nothing holds it.
    expect(component.status).toBe('unstable');
    expect(component.flags.mechanism).toBe(true);
    expect(result.foundations['player-1']).toMatchObject({ valid: false, reaction: null });

    // Fix the base and the wind is shared between the mast and the windward guy.
    const fixed: AnalysisModel = { ...mast, members: [{ ...mast.members[0], start: undefined }, ...mast.members.slice(1)] };
    const stable = await solver.analyzeDetailed(fixed, { gravity: [0, 0, -9.81] });
    expect(stable.components[0].status).toBe('stable');
    expect(stable.components[0].convergence.residual).toBeLessThan(1e-5);
    expect(stable.members['guy-west'].state).toBe('active');
    expect(stable.members['guy-east'].state).toBe('slack');
    expect(stable.members['guy-east'].forces?.start[0]).toBe(0);
    // The windward anchor is pulled up (uplift is a negative vertical reaction).
    expect(stable.foundations['player-2'].reaction![2]).toBeLessThan(0);
    // The slack guy carries no tension; its anchor holds half its own weight.
    const guyWeight = 7850 * 3e-4 * 9.81 * Math.hypot(4, 6);
    expect(stable.foundations['player-3'].reaction![0]).toBe(0);
    expect(stable.foundations['player-3'].reaction![2]).toBeCloseTo(guyWeight / 2, 6);
    // All reactions together balance the wind and the weight.
    const total = (axis: number) => Object.values(stable.foundations).reduce((sum, f) => sum + f.reaction![axis], 0);
    expect(total(0)).toBeCloseTo(-8000, 3);
    expect(total(2)).toBeCloseTo(-stable.components[0].appliedForce[2], 3);
    expect(stable.members.mast.utilization).toBeGreaterThan(0);
    expect(stable.members.mast.governingLimitState).toBe('axialBending');
  });

  it('gives the same answer for the same state, and leaves its input untouched', async () => {
    const before = JSON.stringify(mast);
    const first = await solver.analyzeDetailed(mast, { fidelity: 'linear' });
    const second = await solver.analyzeDetailed(mast, { fidelity: 'linear' });
    delete first.analysis.runtimeMs;
    delete second.analysis.runtimeMs;
    expect(second).toEqual(first);
    expect(JSON.stringify(mast)).toBe(before);
  });

  it('rejects input the solver does not understand instead of ignoring it', async () => {
    const withTypo = { ...mast, memberz: [] } as unknown as AnalysisModel;
    const result = await solver.analyzeDetailed(withTypo);
    expect(result.analysis.status).toBe('invalid');
    expect(result.analysis.reasonCodes).toEqual(['invalidInput']);
    expect(result.analysis.diagnostics[0].message).toContain('memberz');
  });

  it('rejects with an AbortError when the caller has aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(solver.analyzeDetailed(mast, {}, controller.signal)).rejects.toThrow();
  });

  it('reports a module that cannot be loaded as a result, and recovers', async () => {
    let attempts = 0;
    const flaky = createWasmSolver(() => (attempts++ === 0 ? Promise.reject(new Error('offline')) : fromDisk()));
    const failed = await flaky.analyzeDetailed(mast);
    expect(failed.analysis.reasonCodes).toEqual(['solverUnavailable']);
    expect((await flaky.analyzeDetailed(mast)).analysis.status).toBe('ok');
  });
});
