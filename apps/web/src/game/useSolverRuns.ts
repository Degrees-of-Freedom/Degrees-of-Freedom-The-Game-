import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisResult } from '@dof/solver-contract';
import type { GameModel } from './model';
import { runSolver, type RunContext, type SolverDescriptor, type SolverId, type SolverRun } from './solvers';

export type RunState = { phase: 'running' } | { phase: 'done'; run: SolverRun };

/** Progress of the contract-solver stability check shown by the stability panel. */
export type StabilityCheck =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; result: AnalysisResult; notes: string[] };

const IDLE: StabilityCheck = { phase: 'idle' };

/** The stability panel's view of one solver's run state. */
export function stabilityCheckOf(state: RunState | undefined): StabilityCheck {
  if (!state) return IDLE;
  if (state.phase === 'running') return state;
  const { native, message } = state.run;
  if (native?.kind === 'contract') return { phase: 'done', result: native.result, notes: native.notes };
  return { phase: 'done', result: { status: 'unsupported', message }, notes: [] };
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Run solvers on a game model and keep their records.
 *
 * The returned runs always belong to `model`: editing the model empties them,
 * and starting a new run cancels the previous one, so a slow response can
 * never be shown against a structure it does not describe. Solvers in one
 * `run` call execute one after another so their timings do not contend for
 * the same machine; each record is published as soon as it exists. Records
 * from an earlier run on the same model are kept for solvers the new run does
 * not touch.
 */
export function useSolverRuns(model: GameModel, solvers: readonly SolverDescriptor[]) {
  const [state, setState] = useState<{ model: GameModel; runs: Record<SolverId, RunState> } | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  const run = useCallback(
    async (ids: readonly SolverId[], context: RunContext) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      const chosen = solvers.filter((solver) => ids.includes(solver.id));
      setState((previous) => {
        const kept = Object.fromEntries(
          Object.entries(previous?.model === context.model ? previous.runs : {}).filter(
            ([, entry]) => entry.phase === 'done',
          ),
        );
        for (const solver of chosen) kept[solver.id] = { phase: 'running' };
        return { model: context.model, runs: kept };
      });
      for (const solver of chosen) {
        await nextTask();
        if (controller.signal.aborted) return;
        let record: SolverRun;
        try {
          record = await runSolver(solver, context, controller.signal);
        } catch {
          return; // cancelled
        }
        if (controller.signal.aborted) return;
        setState((previous) =>
          previous?.model === context.model
            ? { model: context.model, runs: { ...previous.runs, [solver.id]: { phase: 'done', run: record } } }
            : previous,
        );
      }
    },
    [solvers],
  );

  const runs: Record<SolverId, RunState> = state?.model === model ? state.runs : {};
  const busy = Object.values(runs).some((entry) => entry.phase === 'running');
  return { runs, busy, run };
}
