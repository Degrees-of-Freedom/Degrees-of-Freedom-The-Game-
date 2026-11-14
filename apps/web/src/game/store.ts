import { create } from 'zustand';
import type { AnalysisResult, SolverAdapter, StructuralModel } from '@dof/solver-contract';
import { defaultSolver } from '../solver';

const emptyModel = (): StructuralModel => ({ units: 'SI', nodes: [], members: [], supports: [], loads: [] });

/** Where the analysis of the current model stands. A result always belongs to the current model. */
export type AnalysisState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; result: AnalysisResult };

interface GameState {
  model: StructuralModel;
  analysis: AnalysisState;
  /** Replaceable so tests and future settings can swap the backend. */
  solver: SolverAdapter;
  reset: () => void;
  /** Replace the whole model, discarding any analysis of the previous one. */
  loadModel: (model: StructuralModel) => void;
  /** Analyse the current model. A newer run or a model change cancels an older run. */
  runAnalysis: () => Promise<void>;
}

/** Game state remains independent of the renderer and solver implementation. */
export const useGameStore = create<GameState>((set, get) => {
  let inFlight: AbortController | undefined;

  const replaceModel = (model: StructuralModel) => {
    inFlight?.abort();
    inFlight = undefined;
    set({ model, analysis: { phase: 'idle' } });
  };

  return {
    model: emptyModel(),
    analysis: { phase: 'idle' },
    solver: defaultSolver,
    reset: () => replaceModel(emptyModel()),
    loadModel: replaceModel,
    runAnalysis: async () => {
      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;
      set({ analysis: { phase: 'running' } });

      let result: AnalysisResult;
      try {
        result = await get().solver.analyze(get().model, controller.signal);
      } catch (error) {
        // An aborted run was superseded; whoever aborted it owns the state now.
        if (controller.signal.aborted) return;
        result = { status: 'error', message: error instanceof Error ? error.message : 'The solver failed unexpectedly.' };
      }
      if (controller.signal.aborted) return;
      inFlight = undefined;
      set({ analysis: { phase: 'done', result } });
    },
  };
});
