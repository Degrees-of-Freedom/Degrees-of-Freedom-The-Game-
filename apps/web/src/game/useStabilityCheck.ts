import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisResult, SolverAdapter } from '@dof/solver-contract';
import { defaultSolver } from '../solver';
import type { GameModel } from './model';
import { toStructuralModel } from './structuralModel';

/** Progress of the contract-solver stability check for one game model. */
export type StabilityCheck =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; result: AnalysisResult; notes: string[] };

const IDLE: StabilityCheck = { phase: 'idle' };

/**
 * Run the shared-contract solver on a game model, alongside the voxel analysis.
 *
 * The returned check always belongs to `model`: editing the model returns the
 * check to idle, and starting a new run cancels the previous one, so a slow
 * response can never be shown against a structure it does not describe.
 */
export function useStabilityCheck(
  model: GameModel,
  solver: SolverAdapter = defaultSolver,
) {
  const [state, setState] = useState<{
    model: GameModel;
    check: StabilityCheck;
  } | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  const run = useCallback(
    async (target: GameModel) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setState({ model: target, check: { phase: 'running' } });

      const { model: structural, notes } = toStructuralModel(target);
      let result: AnalysisResult;
      try {
        result = await solver.analyze(structural, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) return;
        result = {
          status: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'The solver failed unexpectedly.',
        };
      }
      if (controller.signal.aborted) return;
      setState({ model: target, check: { phase: 'done', result, notes } });
    },
    [solver],
  );

  return {
    check: state?.model === model ? state.check : IDLE,
    run,
    /** Display name of the solver that produces the check. */
    solverName: solver.name,
  };
}
