import { beforeEach, describe, expect, it } from 'vitest';
import type { AnalysisResult, SolverAdapter } from '@dof/solver-contract';
import { useGameStore } from './store';
import { EXAMPLES } from './examples';
import { resolveSolver } from '../solver';
import { createOpenSeesSolver } from '../solver/opensees';
import { unavailableSolver } from '../solver/unavailable';

const success: AnalysisResult = { status: 'success', displacements: {}, warnings: [] };

/** A solver whose analyses finish only when the test says so. */
function manualSolver() {
  const pending: Array<{ resolve: (result: AnalysisResult) => void; signal?: AbortSignal }> = [];
  const solver: SolverAdapter = {
    id: 'manual',
    name: 'Manual test solver',
    analyze: (_model, signal) => new Promise((resolve) => pending.push({ resolve, signal })),
  };
  return { solver, pending };
}

describe('game store', () => {
  beforeEach(() => {
    useGameStore.setState({ solver: unavailableSolver });
    useGameStore.getState().reset();
  });

  it('resets to an empty model', () => {
    useGameStore.getState().loadModel(EXAMPLES[0].build());
    useGameStore.getState().reset();
    expect(useGameStore.getState().model.nodes).toEqual([]);
  });

  it('reports analysis as unavailable', async () => {
    expect((await unavailableSolver.analyze(useGameStore.getState().model)).status).toBe('unsupported');
  });

  it('moves from idle through running to a result', async () => {
    const { solver, pending } = manualSolver();
    useGameStore.setState({ solver });
    expect(useGameStore.getState().analysis).toEqual({ phase: 'idle' });

    const run = useGameStore.getState().runAnalysis();
    expect(useGameStore.getState().analysis).toEqual({ phase: 'running' });
    pending[0].resolve(success);
    await run;
    expect(useGameStore.getState().analysis).toEqual({ phase: 'done', result: success });
  });

  it('discards a result when the model changes', async () => {
    const { solver, pending } = manualSolver();
    useGameStore.setState({ solver });
    const run = useGameStore.getState().runAnalysis();
    useGameStore.getState().loadModel(EXAMPLES[1].build());
    expect(pending[0].signal?.aborted).toBe(true);
    pending[0].resolve(success);
    await run;
    expect(useGameStore.getState().analysis).toEqual({ phase: 'idle' });
  });

  it('keeps only the newest of two overlapping runs', async () => {
    const { solver, pending } = manualSolver();
    useGameStore.setState({ solver });
    const first = useGameStore.getState().runAnalysis();
    const second = useGameStore.getState().runAnalysis();
    const newest: AnalysisResult = { status: 'error', message: 'newest' };
    pending[1].resolve(newest);
    pending[0].resolve(success);
    await Promise.all([first, second]);
    expect(useGameStore.getState().analysis).toEqual({ phase: 'done', result: newest });
  });

  it('turns a solver exception into an error result', async () => {
    useGameStore.setState({ solver: { id: 'broken', name: 'Broken', analyze: async () => { throw new Error('boom'); } } });
    await useGameStore.getState().runAnalysis();
    expect(useGameStore.getState().analysis).toEqual({ phase: 'done', result: { status: 'error', message: 'boom' } });
  });
});

describe('solver selection', () => {
  it('uses the configured service, the local one in development, and none otherwise', () => {
    expect(resolveSolver({ VITE_OPENSEES_URL: 'http://solver.test' }).id).toBe('opensees');
    expect(resolveSolver({ DEV: true }).id).toBe('opensees');
    expect(resolveSolver({ DEV: false })).toBe(unavailableSolver);
  });
});

describe('example structures', () => {
  it.each(EXAMPLES)('$name refers only to nodes it defines', ({ build }) => {
    const model = build();
    const ids = new Set(model.nodes.map((node) => node.id));
    expect(ids.size).toBe(model.nodes.length);
    expect(new Set(model.members.map((member) => member.id)).size).toBe(model.members.length);
    const referenced = [
      ...model.members.flatMap((member) => [member.startNodeId, member.endNodeId]),
      ...model.supports.map((support) => support.nodeId),
      ...model.loads.map((load) => load.nodeId),
    ];
    expect(referenced.every((id) => ids.has(id))).toBe(true);
  });

  // Opt-in check against a running service:
  //   VITE_OPENSEES_URL=http://127.0.0.1:8000 npm test
  const liveUrl: string | undefined = import.meta.env.VITE_OPENSEES_URL;
  it.skipIf(!liveUrl)('behave as their names promise on a live service', async () => {
    const solver = createOpenSeesSolver(liveUrl!);
    const [braced, unbraced, rigid] = await Promise.all(EXAMPLES.map(({ build }) => solver.analyze(build())));

    if (braced.status !== 'success') throw new Error(`Braced truss: ${JSON.stringify(braced)}`);
    expect(braced.stability).toMatchObject({ stable: true, freeDofs: 12, mechanisms: 0, staticIndeterminacy: 0 });

    if (unbraced.status !== 'unstable') throw new Error(`Unbraced frame: ${JSON.stringify(unbraced)}`);
    // The top square can slide two ways, twist, and rack.
    expect(unbraced.stability).toMatchObject({ translationalMechanisms: 4, staticIndeterminacy: 0 });

    if (rigid.status !== 'success') throw new Error(`Rigid frame: ${JSON.stringify(rigid)}`);
    expect(rigid.stability).toMatchObject({ stable: true, translationalMechanisms: 0 });
  });
});
