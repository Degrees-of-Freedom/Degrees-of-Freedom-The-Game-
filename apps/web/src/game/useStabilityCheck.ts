import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisResult, DetailedAnalysisResult, DetailedSolver, SolverAdapter } from '@dof/solver-contract';
import { defaultSolver } from '../solver';
import { toAnalysisModel } from './analysisModel';
import type { GameModel, Level } from './model';
import { toStructuralModel } from './structuralModel';

/**
 * Progress of the contract-solver check for one game model.
 *
 * A solver that implements the detailed contract gives a `detailed` result:
 * card sections, tension-only cables, self-weight, nonlinear analysis and a
 * status per component. Any other solver gives the original `done` result,
 * which covers kinematic stability and determinacy only.
 */
export type StabilityCheck =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; result: AnalysisResult; notes: string[] }
  | { phase: 'detailed'; result: DetailedAnalysisResult; notes: string[] };

const IDLE: StabilityCheck = { phase: 'idle' };

const isDetailedSolver = (solver: SolverAdapter): solver is SolverAdapter & DetailedSolver =>
  'analyzeDetailed' in solver && typeof solver.analyzeDetailed === 'function';

/**
 * Run the shared-contract solver on a game model, alongside the voxel analysis.
 *
 * The returned check always belongs to `model`, `level` and `solver`, because
 * the level decides the loads: editing the model, changing level or switching
 * solver in Settings returns the check to idle, and starting a new run cancels the previous one, so a slow
 * response can never be shown against a structure it does not describe.
 */
export function useStabilityCheck(
  model: GameModel,
  level: Level,
  solver: SolverAdapter = defaultSolver,
) {
  const [state, setState] = useState<{
    model: GameModel;
    level: Level;
    solver: SolverAdapter;
    check: StabilityCheck;
  } | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  const run = useCallback(
    async (target: GameModel, level: Level, nonlinear = false) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setState({ model: target, level, solver, check: { phase: 'running' } });

      let check: StabilityCheck;
      try {
        if (nonlinear && solver.id !== 'opensees') throw new Error('The nonlinear service check requires OpenSees.');
        if (isDetailedSolver(solver) && !nonlinear) {
          const { model: analysis, options, notes } = toAnalysisModel(target, level);
          const result = await solver.analyzeDetailed(analysis, options, controller.signal);
          check = { phase: 'detailed', result, notes };
        } else {
          const { model: structural, notes } = toStructuralModel(target, nonlinear);
          check = { phase: 'done', result: await solver.analyze(structural, controller.signal), notes };
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : 'The solver failed unexpectedly.';
        check = { phase: 'done', result: { status: 'error', message }, notes: [] };
      }
      if (controller.signal.aborted) return;
      setState({ model: target, level, solver, check });
    },
    [solver],
  );

  return {
    check:
      state?.model === model && state.level === level && state.solver === solver
        ? state.check
        : IDLE,
    run,
    /** Display name of the solver that produces the check. */
    solverName: solver.name,
    supportsNonlinearService: solver.id === 'opensees',
  };
}
