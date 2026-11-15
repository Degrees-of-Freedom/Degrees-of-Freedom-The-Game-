import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { AnalysisLoadCase, AnalysisModel, AnalysisOptions, AnalysisSection, StructuralModel } from '@dof/solver-contract';
import { exampleModel } from '../../game/examples';
import type { LevelId } from '../../game/model';
import { toStructuralModel } from '../../game/structuralModel';
import { createWasmSolver } from './wasmSolver';
import { handleRequest, type WorkerLike } from './workerProtocol';

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
};

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
    expect(result.displacements.lonely).toEqual([0, 0, 0, 0, 0, 0]);
    expect(result.warnings.join(' ')).toContain('1 node(s) with no members');
  });

  it('returns an error result for a model that cannot be analysed', async () => {
    const result = await solver.analyze({ ...cantilever, members: [{ id: 'm', startNodeId: 'a', endNodeId: 'nowhere' }] });
    expect(result).toEqual({ status: 'error', message: expect.stringContaining('does not exist') });
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

describe('Rust WebAssembly solver, deflection and load cases', () => {
  const fixedMast: AnalysisModel = { ...mast, members: [{ ...mast.members[0], start: undefined }, ...mast.members.slice(1)] };

  it('reports stations along a beam and none along a cable', async () => {
    const result = await solver.analyzeDetailed(fixedMast, { fidelity: 'linear', subdivisions: 4 });
    const deflection = result.members.mast.deflection!;
    expect(deflection.stations.map((s) => s.at)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(deflection.length).toBeCloseTo(6, 12);
    // The end stations are the nodes.
    expect(deflection.stations[4].displacement).toEqual(result.nodes.top.displacement);
    expect(deflection.maxFromChord).toBeGreaterThan(0);
    expect(result.members['guy-west'].deflection).toBeNull();
  });

  it('gives each load case the result of a separate call', async () => {
    const options: AnalysisOptions = { fidelity: 'linear', gravity: [0, 0, -9.81] };
    const calm: AnalysisLoadCase = { id: 'calm', loads: [] };
    const gust: AnalysisLoadCase = { id: 'gust', loadFactor: 1.5 };
    const { cases, runtimeMs } = await solver.analyzeCases(fixedMast, [calm, gust], options);
    expect(runtimeMs).toBeGreaterThanOrEqual(0);
    expect(cases.map((c) => c.id)).toEqual(['calm', 'gust']);
    const separate = [
      await solver.analyzeDetailed({ ...fixedMast, loads: [] }, options),
      await solver.analyzeDetailed(fixedMast, { ...options, loadFactor: 1.5 }),
    ];
    for (const [i, { result }] of cases.entries()) {
      delete separate[i].analysis.runtimeMs;
      expect(result).toEqual(separate[i]);
    }
  });

  it('gives every case the rejection when the request as a whole is rejected', async () => {
    const { cases } = await solver.analyzeCases(mast, [{ id: 'a' }, { id: 'a' }]);
    expect(cases).toHaveLength(2);
    for (const { result } of cases) expect(result.analysis.reasonCodes).toEqual(['invalidInput']);
  });
});

/**
 * A stand-in for the browser worker: it runs the real module in-process,
 * through the same message handler as `solverWorker.ts`. `hang` swallows the
 * answer, as a worker stuck in a long analysis would.
 */
function fakeWorkers(behaviour: 'answer' | 'hang' = 'answer') {
  const log = { spawned: 0, terminated: 0 };
  /** Called when a worker reports that an analysis has started. */
  const events: { onStarted?: () => void } = {};
  const spawn = (): WorkerLike => {
    log.spawned++;
    const cache = {};
    let alive = true;
    const worker: WorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage(message) {
        setTimeout(() =>
          void handleRequest(message, cache, (reply) => {
            if (!alive) return;
            if (reply.kind === 'started') setTimeout(() => events.onStarted?.());
            if (behaviour === 'hang' && reply.kind !== 'started') return;
            worker.onmessage?.({ data: reply });
          }),
        );
      },
      terminate() {
        alive = false;
        log.terminated++;
      },
    };
    return worker;
  };
  return { spawn, log, events };
}

describe('Rust WebAssembly solver on a worker', () => {
  it('gives the same results as the inline solver, reusing one worker', async () => {
    const { spawn, log } = fakeWorkers();
    const onWorker = createWasmSolver({ source: fromDisk, worker: spawn });
    const [a, b] = await Promise.all([
      onWorker.analyzeDetailed(mast, { fidelity: 'linear' }),
      onWorker.analyzeDetailed(mast, { fidelity: 'nonlinear' }),
    ]);
    const inline = await solver.analyzeDetailed(mast, { fidelity: 'linear' });
    for (const result of [a, inline]) delete result.analysis.runtimeMs;
    expect(a).toEqual(inline);
    expect(b.analysis.fidelity).toBe('nonlinear');
    expect(log).toEqual({ spawned: 1, terminated: 0 });
  });

  it('stops an analysis that exceeds the time limit and recovers on a fresh worker', async () => {
    const hanging = fakeWorkers('hang');
    const slow = createWasmSolver({ source: fromDisk, worker: hanging.spawn, timeLimitMs: 30 });
    const result = await slow.analyzeDetailed(mast);
    expect(result.analysis.status).toBe('invalid');
    expect(result.analysis.reasonCodes).toEqual(['timeLimitExceeded']);
    expect(result.analysis.diagnostics[0].message).toContain('30 ms');
    expect(hanging.log).toEqual({ spawned: 1, terminated: 1 });
    // Every case of a timed-out multi-case call carries the timeout.
    const { cases } = await slow.analyzeCases(mast, [{ id: 'x' }, { id: 'y' }]);
    expect(cases.map((c) => c.result.analysis.reasonCodes[0])).toEqual(['timeLimitExceeded', 'timeLimitExceeded']);
    expect(hanging.log).toEqual({ spawned: 2, terminated: 2 });
  });

  it('terminates the worker when the caller aborts mid-analysis', async () => {
    const hanging = fakeWorkers('hang');
    const solverOnWorker = createWasmSolver({ source: fromDisk, worker: hanging.spawn, timeLimitMs: 60_000 });
    const controller = new AbortController();
    const pending = solverOnWorker.analyzeDetailed(mast, {}, controller.signal);
    hanging.events.onStarted = () => controller.abort();
    await expect(pending).rejects.toThrow();
    expect(hanging.log.terminated).toBe(1);
  });

  it('lets queued calls run after an aborted one', async () => {
    const { spawn, log } = fakeWorkers();
    const onWorker = createWasmSolver({ source: fromDisk, worker: spawn });
    const controller = new AbortController();
    const first = onWorker.analyzeDetailed(mast, {}, controller.signal);
    const second = onWorker.analyzeDetailed(mast, { fidelity: 'linear' });
    controller.abort();
    await expect(first).rejects.toThrow();
    expect((await second).analysis.status).toBe('ok');
    expect(log.spawned).toBeLessThanOrEqual(2);
  });
});
