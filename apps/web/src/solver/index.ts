import type { SolverAdapter } from '@dof/solver-contract';
import { createOpenSeesSolver } from './opensees';
import { unavailableSolver } from './unavailable';

/** Port used by `npm run dev:opensees`. */
export const LOCAL_OPENSEES_URL = 'http://localhost:8000';

/**
 * Choose the solver from build-time configuration.
 *
 * `VITE_OPENSEES_URL` selects an OpenSees service explicitly. Without it, a
 * development build assumes the service is running locally, and a production
 * build has no solver, because no deployed service address is known.
 */
export function resolveSolver(env: { VITE_OPENSEES_URL?: string; DEV?: boolean }): SolverAdapter {
  const url = env.VITE_OPENSEES_URL || (env.DEV ? LOCAL_OPENSEES_URL : undefined);
  return url ? createOpenSeesSolver(url) : unavailableSolver;
}

export const defaultSolver = resolveSolver(import.meta.env);
