import type {
  AnalysisFidelity,
  AnalysisResult,
  SolverAdapter,
} from '@dof/solver-contract';
import type { VoxelAnalysis } from '../evaluator/results';
import { unavailableSolver } from '../solver/unavailable';
import type { GameModel, Level } from './model';
import { toStructuralModel } from './structuralModel';

/**
 * Registry of the solvers the app can run on a game model, and the one
 * function that runs any of them and returns a uniform record.
 *
 * It lives in the game layer because it must translate game state
 * (`toStructuralModel`) and call the voxel analysis; the solver layer knows
 * only the contract. Components read descriptors and runs and own no solver
 * logic. A further solver is added by appending a descriptor to the list
 * returned by `createSolvers`; the UI iterates that list.
 */

export type SolverId = string;

/** One verdict vocabulary for every solver. Unknown is never reported as stable. */
export type SolverVerdict = 'stable' | 'unstable' | 'unresolved' | 'unavailable';

/** The solver's own result, kept for the panels that understand it. */
export type SolverNative =
  | { kind: 'voxel'; result: VoxelAnalysis }
  | { kind: 'contract'; result: AnalysisResult; notes: string[] };

export interface RunContext {
  model: GameModel;
  level: Level;
  /** False when the game state cannot be expressed in the shared contract. */
  contractCompatible: boolean;
  /** Runs the in-browser analysis on the current state (the turn board in multiplayer). */
  analyzeVoxel: () => VoxelAnalysis;
}

export type Clock = () => number;

export interface SolverOutcome {
  verdict: SolverVerdict;
  message: string;
  /** Compute time as the solver itself measures it, ms. Null when it ran no analysis. */
  computeMs: number | null;
  native: SolverNative | null;
}

export interface SolverDescriptor {
  readonly id: SolverId;
  readonly label: string;
  /** What the solver needs, in words for the UI. */
  readonly needs: string;
  /** True when a network round trip is part of a run. */
  readonly remote: boolean;
  /** Why this solver cannot run on this state, or null when it can. */
  unavailableReason(context: RunContext): string | null;
  execute(context: RunContext, signal: AbortSignal | undefined, now: Clock): Promise<SolverOutcome>;
}

/** The normalised record of one run. */
export interface SolverRun extends SolverOutcome {
  solverId: SolverId;
  /** Wall time of the whole run including any network round trip, ms. */
  wallMs: number;
}

export const MULTIPLAYER_REASON =
  'Shared-table games keep individual member-end connections, which the shared contract cannot express.';
export const NOT_CONFIGURED_REASON =
  'No solver service is configured. Set VITE_OPENSEES_URL, or run the service in development.';

export function voxelVerdict(result: VoxelAnalysis): Pick<SolverOutcome, 'verdict' | 'message'> {
  if (result.error) return { verdict: 'unstable', message: result.error };
  if (result.mechanism) return { verdict: 'unstable', message: 'The structure is a mechanism.' };
  if (result.floating.length > 0)
    return { verdict: 'unstable', message: `${result.floating.length} nodes are not connected to a foundation.` };
  const failed = result.combos.filter((combo) => combo.fail).length;
  if (failed > 0)
    return { verdict: 'unresolved', message: `${failed} of ${result.combos.length} load combinations did not solve.` };
  return { verdict: 'stable', message: 'Stable under every load combination.' };
}

export function voxelSolver(): SolverDescriptor {
  return {
    id: 'voxel',
    label: 'Voxel (browser)',
    needs: 'Runs in this browser tab.',
    remote: false,
    unavailableReason: () => null,
    async execute(context, _signal, now) {
      const start = now();
      const result = context.analyzeVoxel();
      const computeMs = now() - start;
      return { ...voxelVerdict(result), computeMs, native: { kind: 'voxel', result } };
    },
  };
}

export function contractVerdict(result: AnalysisResult): Pick<SolverOutcome, 'verdict' | 'message'> {
  switch (result.status) {
    case 'success':
      return { verdict: 'stable', message: 'Stable' };
    case 'unstable':
      return { verdict: 'unstable', message: result.message };
    case 'unresolved':
      return { verdict: 'unresolved', message: result.message };
    case 'unsupported':
    case 'error':
      return { verdict: 'unavailable', message: result.message };
  }
}

/** A solver reached through the shared contract, at a fixed fidelity. */
export function contractSolver(options: {
  id: SolverId;
  label: string;
  adapter: SolverAdapter;
  fidelity: AnalysisFidelity;
}): SolverDescriptor {
  const { adapter, fidelity } = options;
  return {
    id: options.id,
    label: options.label,
    needs: 'Needs the solver service and a model the shared contract can express.',
    remote: true,
    unavailableReason: (context) => {
      if (!context.contractCompatible) return MULTIPLAYER_REASON;
      if (adapter.id === unavailableSolver.id) return NOT_CONFIGURED_REASON;
      return null;
    },
    async execute(context, signal) {
      const { model, notes } = toStructuralModel(context.model, { fidelity });
      const result = await adapter.analyze(model, signal);
      const computeMs =
        result.status === 'success' || result.status === 'unstable' || result.status === 'unresolved'
          ? result.analysis.runtimeMs
          : null;
      return { ...contractVerdict(result), computeMs, native: { kind: 'contract', result, notes } };
    },
  };
}

/** The solvers offered by the app, in display order. */
export function createSolvers(adapter: SolverAdapter): SolverDescriptor[] {
  return [
    voxelSolver(),
    contractSolver({ id: 'opensees-linear', label: 'OpenSees linear', adapter, fidelity: 'linear' }),
    contractSolver({ id: 'opensees-nonlinear', label: 'OpenSees nonlinear', adapter, fidelity: 'nonlinear' }),
  ];
}

const unavailableRun = (solverId: SolverId, message: string, wallMs = 0): SolverRun => ({
  solverId, verdict: 'unavailable', message, computeMs: null, wallMs, native: null,
});

/**
 * Run one solver on the context and return the normalised record.
 *
 * An unavailable solver, an unreachable service and a thrown error are all
 * `unavailable` records with a message, never exceptions. Cancellation is the
 * exception: an aborted signal rejects, because a cancelled run has no record.
 */
export async function runSolver(
  solver: SolverDescriptor,
  context: RunContext,
  signal?: AbortSignal,
  now: Clock = () => performance.now(),
): Promise<SolverRun> {
  const reason = solver.unavailableReason(context);
  if (reason) return unavailableRun(solver.id, reason);
  const start = now();
  try {
    const outcome = await solver.execute(context, signal, now);
    return { ...outcome, solverId: solver.id, wallMs: now() - start };
  } catch (error) {
    if (signal?.aborted) throw error;
    return unavailableRun(
      solver.id,
      error instanceof Error ? error.message : 'The solver failed unexpectedly.',
      now() - start,
    );
  }
}
