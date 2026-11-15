import type { SolverAdapter } from '@dof/solver-contract';
import { DEFAULT_SETTINGS, LOCAL_OPENSEES_URL, type Settings, type SolverChoice } from '../menu/settings';
import { createOpenSeesSolver } from './opensees';
import { unavailableSolver } from './unavailable';
import { createWasmSolver } from './wasm/wasmSolver';

export { LOCAL_OPENSEES_URL };

/** The Rust solver, running in the browser. One instance loads the module once. */
export const wasmSolver = createWasmSolver();

/** One adapter per service address, so a check keeps its identity across renders. */
const openSeesSolvers = new Map<string, SolverAdapter>();

/**
 * The adapter for a solver choice.
 *
 * `rust` is the Rust solver compiled to WebAssembly, which needs no service;
 * without WebAssembly support there is no solver. `opensees` is the OpenSees
 * service at `openSeesUrl`, which must be running (`npm run dev:opensees`
 * serves it on `http://localhost:8000`). The same choice and address always
 * return the same adapter object.
 */
export function solverFor(
  choice: SolverChoice,
  openSeesUrl: string,
  webAssemblyAvailable = typeof WebAssembly !== 'undefined',
): SolverAdapter {
  if (choice === 'opensees') {
    let solver = openSeesSolvers.get(openSeesUrl);
    if (!solver) openSeesSolvers.set(openSeesUrl, (solver = createOpenSeesSolver(openSeesUrl)));
    return solver;
  }
  return webAssemblyAvailable ? wasmSolver : unavailableSolver;
}

/** The adapter the player's settings select. */
export function solverForSettings(settings: Pick<Settings, 'solver' | 'openSeesUrl'>): SolverAdapter {
  return solverFor(settings.solver, settings.openSeesUrl);
}

/** The adapter for the build's default settings, for code that has no settings. */
export const defaultSolver = solverForSettings(DEFAULT_SETTINGS);
