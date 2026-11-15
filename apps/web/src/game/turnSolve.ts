import type { AnalysisResult, SolverAdapter } from '@dof/solver-contract';
import { toTurnStructuralModel } from './turnStructuralModel';
import type { TurnReport, TurnState } from './turns';

export type TurnStatus = TurnReport['status'];

/** The verdict that ends a turn, and where it came from. */
export interface TurnAssessment {
  status: TurnStatus;
  /** Plain-language reason recorded in the turn report. */
  reason: string;
  /** Which solver produced the verdict: the chosen solver's id, or `voxel` when it fell back. */
  solver: string;
  /** The solver's own compute time, when it reports one. */
  computeMs?: number;
}

const VOXEL_REASONS: Record<TurnStatus, string> = {
  stable: 'The structure carries its loads.',
  unstable: 'The structure has a mechanism or deforms excessively.',
  partial: 'The supported structure carries its loads; some parts are not connected to a foundation.',
  unresolved: 'The analysis did not reach a result for this turn.',
};

/**
 * Map a contract result to a turn status.
 *
 * A component with no support at all is a floating part, not a failure of
 * the structure, so a result whose only unstable components are unsupported
 * ones, next to at least one sound component, is `partial`, matching what the
 * in-browser assessment reports for floating parts. `unresolved` stays
 * unresolved: the turn criteria forbid inventing a verdict.
 */
export function turnStatusOf(result: AnalysisResult): TurnStatus | null {
  if (result.status === 'success') return 'stable';
  if (result.status === 'unresolved') return 'unresolved';
  if (result.status === 'unstable') {
    const failing = result.components.filter((component) => component.state === 'unstable');
    const onlyFloating = failing.every((component) =>
      component.reasonCodes.every((code) => code === 'unsupported_component'),
    );
    const sound = result.components.some((component) => component.state === 'stable' || component.state === 'marginal');
    return onlyFloating && sound ? 'partial' : 'unstable';
  }
  return null;
}

function voxelAssessment(status: TurnStatus, why?: string): TurnAssessment {
  const prefix = why ? `${why} Voxel check: ` : 'Voxel check: ';
  return { status, reason: prefix + VOXEL_REASONS[status], solver: 'voxel' };
}

/**
 * Assess a completed turn with the structural solver chosen in the settings,
 * at nonlinear fidelity, once per turn. When that solver cannot run, cannot
 * be reached, or cannot represent the structure, the voxel verdict
 * `fallback` decides instead and the reason says so.
 *
 * Rejects only when `signal` aborts, so a caller can abandon a stale turn.
 */
export async function assessTurnWithSolver(
  turn: TurnState,
  solver: SolverAdapter,
  fallback: TurnStatus,
  signal?: AbortSignal,
): Promise<TurnAssessment> {
  if (solver.id === 'unavailable') return voxelAssessment(fallback, 'No structural solver is available.');
  const { model } = toTurnStructuralModel(turn, 'nonlinear');
  let result: AnalysisResult;
  try {
    result = await solver.analyze(model, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    return voxelAssessment(fallback, `${solver.name} failed.`);
  }
  if (result.status === 'error' || result.status === 'unsupported')
    return voxelAssessment(fallback, `${solver.name} could not analyse this turn (${result.message}).`);
  const status = turnStatusOf(result) ?? 'unresolved';
  const computeMs = 'analysis' in result ? result.analysis.runtimeMs : 0;
  const detail = result.status === 'success' ? VOXEL_REASONS.stable : result.message;
  return {
    status,
    reason: `${solver.name}, ${Math.round(computeMs)} ms: ${detail}`,
    solver: solver.id,
    computeMs,
  };
}
