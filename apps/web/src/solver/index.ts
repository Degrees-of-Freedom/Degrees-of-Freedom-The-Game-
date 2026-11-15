import type { SolverAdapter } from '@dof/solver-contract';
import { createOpenSeesSolver } from './opensees';
import { unavailableSolver } from './unavailable';
import { createWasmSolver } from './wasm/wasmSolver';

/** Port used by `npm run dev:opensees`. */
export const LOCAL_OPENSEES_URL = 'http://localhost:8000';

/** The Rust solver, running in the browser. One instance loads the module once. */
export const wasmSolver = createWasmSolver();

/**
 * Choose the solver from build-time configuration.
 *
 * The Rust WebAssembly solver is the default: it needs no service, so it
 * works in development and in a deployed build alike. The OpenSees service
 * is used instead when `VITE_OPENSEES_URL` gives its address, or when
 * `VITE_SOLVER=opensees` asks for the local one started by
 * `npm run dev:opensees`. Without WebAssembly support there is no solver.
 */
export function resolveSolver(
  env: { VITE_OPENSEES_URL?: string; VITE_SOLVER?: string },
  webAssemblyAvailable = typeof WebAssembly !== 'undefined',
): SolverAdapter {
  if (env.VITE_OPENSEES_URL) return createOpenSeesSolver(env.VITE_OPENSEES_URL);
  if (env.VITE_SOLVER === 'opensees') return createOpenSeesSolver(LOCAL_OPENSEES_URL);
  return webAssemblyAvailable ? wasmSolver : unavailableSolver;
}

export const defaultSolver = resolveSolver(import.meta.env);
