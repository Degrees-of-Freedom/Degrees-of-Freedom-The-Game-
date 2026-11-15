import { describe, expect, it, vi } from 'vitest';
import type { AnalysisResult, SolverAdapter, StabilityReport } from '@dof/solver-contract';
import { LEVELS } from './levels';
import type { GameModel } from './model';
import { analyzeGame } from './analysis';
import { unavailableSolver } from '../solver/unavailable';
import {
  createSolvers,
  MULTIPLAYER_REASON,
  NOT_CONFIGURED_REASON,
  runSolver,
  type RunContext,
  type SolverDescriptor,
} from './solvers';

const portal: GameModel = {
  nextId: 4,
  members: [
    { id: 1, a: '0,0,0', b: '0,0,2', type: 'shs' },
    { id: 2, a: '0,0,2', b: '1,0,2', type: 'shs' },
    { id: 3, a: '1,0,2', b: '1,0,0', type: 'shs' },
  ],
  attrs: {
    '0,0,0': { found: true, joint: true },
    '1,0,0': { found: true, joint: true },
    '0,0,2': { joint: true },
    '1,0,2': { joint: true, load: 10 },
  },
};

const report: StabilityReport = {
  stable: true, freeDofs: 6, mechanisms: 0, translationalMechanisms: 0, rotationalMechanisms: 0,
  staticIndeterminacy: 0, unstableNodeIds: [], modes: [],
};
const body = (fidelity: 'linear' | 'nonlinear', runtimeMs: number) => ({
  analysis: { fidelity, solver: 'stub', runtimeMs, reasonCodes: [] },
  components: [], displacements: {}, reactions: {}, memberForces: {}, stability: report, warnings: [],
});

/** Adapter that answers with a fixed result and records the models it received. */
function stubAdapter(result: (fidelity: 'linear' | 'nonlinear') => AnalysisResult) {
  const analyze = vi.fn(async (model: Parameters<SolverAdapter['analyze']>[0]) =>
    result(model.analysis?.fidelity ?? 'nonlinear'),
  );
  return { adapter: { id: 'stub', name: 'Stub', analyze } satisfies SolverAdapter, analyze };
}

/** Clock that moves 5 ms on every reading. */
const steppedClock = () => {
  let t = 100;
  return () => (t += 5);
};

const context = (overrides: Partial<RunContext> = {}): RunContext => ({
  model: portal,
  level: LEVELS.sandbox,
  contractCompatible: true,
  evaluate: () => analyzeGame(portal, LEVELS.sandbox),
  ...overrides,
});

const find = (solvers: SolverDescriptor[], id: string) => solvers.find((s) => s.id === id)!;

describe('solver registry', () => {
  it('describes voxel and both OpenSees fidelities', () => {
    const { adapter } = stubAdapter(() => ({ status: 'error', message: 'unused' }));
    const solvers = createSolvers(adapter);
    expect(solvers.map((s) => s.id)).toEqual(['voxel', 'opensees-linear', 'opensees-nonlinear']);
    expect(solvers.map((s) => s.remote)).toEqual([false, true, true]);
    for (const solver of solvers) expect(solver.label.length).toBeGreaterThan(0);
  });

  it('sends the chosen fidelity explicitly and reports the service compute time', async () => {
    const { adapter, analyze } = stubAdapter((fidelity) => ({ status: 'success', ...body(fidelity, fidelity === 'linear' ? 7 : 42) }));
    const solvers = createSolvers(adapter);
    const linear = await runSolver(find(solvers, 'opensees-linear'), context(), undefined, steppedClock());
    const nonlinear = await runSolver(find(solvers, 'opensees-nonlinear'), context(), undefined, steppedClock());

    expect(analyze.mock.calls.map(([model]) => model.analysis)).toEqual([{ fidelity: 'linear' }, { type: 'corotational' }]);
    expect(linear).toMatchObject({ solverId: 'opensees-linear', verdict: 'stable', computeMs: 7, wallMs: 5 });
    expect(nonlinear).toMatchObject({ verdict: 'stable', computeMs: 42 });
    expect(linear.native?.kind).toBe('contract');
  });

  it('times the voxel call with the supplied clock', async () => {
    const { adapter } = stubAdapter(() => ({ status: 'error', message: 'unused' }));
    const run = await runSolver(find(createSolvers(adapter), 'voxel'), context(), undefined, steppedClock());
    // Readings: wall start, compute start, compute end, wall end.
    expect(run.computeMs).toBe(5);
    expect(run.wallMs).toBe(15);
    expect(run.verdict).toBe('stable');
    expect(run.native?.kind).toBe('voxel');
  });

  it('maps unstable and unresolved bodies to their verdicts, never to stable', async () => {
    for (const status of ['unstable', 'unresolved'] as const) {
      const { adapter } = stubAdapter((fidelity) => ({ status, message: 'why', ...body(fidelity, 3) }));
      const run = await runSolver(find(createSolvers(adapter), 'opensees-nonlinear'), context());
      expect(run).toMatchObject({ verdict: status, message: 'why', computeMs: 3 });
    }
  });

  it('reports a voxel mechanism as unstable', async () => {
    const { adapter } = stubAdapter(() => ({ status: 'error', message: 'unused' }));
    const floating: GameModel = { nextId: 2, attrs: {}, members: [{ id: 1, a: '0,0,0', b: '1,0,0', type: 'shs' }] };
    const run = await runSolver(
      find(createSolvers(adapter), 'voxel'),
      context({ model: floating, evaluate: () => analyzeGame(floating, LEVELS.sandbox) }),
    );
    expect(run.verdict).toBe('unstable');
  });
});

describe('unavailable solvers', () => {
  it('explains why OpenSees cannot run in a shared-table game, without calling the service', async () => {
    const { adapter, analyze } = stubAdapter(() => ({ status: 'error', message: 'unused' }));
    const solvers = createSolvers(adapter);
    const shared = context({ contractCompatible: false });
    expect(find(solvers, 'opensees-linear').unavailableReason(shared)).toBe(MULTIPLAYER_REASON);
    expect(find(solvers, 'voxel').unavailableReason(shared)).toBeNull();
    const run = await runSolver(find(solvers, 'opensees-nonlinear'), shared);
    expect(run).toMatchObject({ verdict: 'unavailable', message: MULTIPLAYER_REASON, computeMs: null, native: null });
    expect(analyze).not.toHaveBeenCalled();
  });

  it('is unavailable with a reason when no service is configured', () => {
    const solvers = createSolvers(unavailableSolver);
    expect(find(solvers, 'opensees-linear').unavailableReason(context())).toBe(NOT_CONFIGURED_REASON);
  });

  it('turns an unreachable service into an unavailable record', async () => {
    const { adapter } = stubAdapter(() => ({ status: 'error', message: 'Could not reach the OpenSees service.' }));
    const run = await runSolver(find(createSolvers(adapter), 'opensees-linear'), context());
    expect(run).toMatchObject({ verdict: 'unavailable', message: expect.stringContaining('Could not reach'), computeMs: null });
  });

  it('turns a thrown error into an unavailable record but lets cancellation reject', async () => {
    const failing: SolverAdapter = { id: 'x', name: 'x', analyze: async () => { throw new Error('boom'); } };
    const run = await runSolver(find(createSolvers(failing), 'opensees-linear'), context());
    expect(run).toMatchObject({ verdict: 'unavailable', message: 'boom' });

    const controller = new AbortController();
    const cancelled: SolverAdapter = {
      id: 'x', name: 'x',
      analyze: async () => { controller.abort(); throw new DOMException('Aborted', 'AbortError'); },
    };
    await expect(
      runSolver(find(createSolvers(cancelled), 'opensees-linear'), context(), controller.signal),
    ).rejects.toThrow('Aborted');
  });
});
