import type { SolverAdapter } from '@dof/solver-contract';
import { LOCAL_OPENSEES_URL, wasmSolver } from '.';
import { createOpenSeesSolver } from './opensees';

/** The structural solvers a player can choose between. The game uses one at a time. */
export type SolverChoice = 'rust' | 'opensees';

export const SOLVER_CHOICES: ReadonlyArray<{ id: SolverChoice; label: string; description: string }> = [
  {
    id: 'rust',
    label: 'Rust (in browser)',
    description: 'Runs in the page with WebAssembly. Needs no service.',
  },
  {
    id: 'opensees',
    label: 'OpenSees (service)',
    description: 'Geometrically nonlinear analysis by the OpenSees service. Start it with npm run dev:opensees.',
  },
];

export const DEFAULT_SOLVER_CHOICE: SolverChoice = 'rust';

export const isSolverChoice = (value: unknown): value is SolverChoice =>
  SOLVER_CHOICES.some((choice) => choice.id === value);

const openSees = createOpenSeesSolver(import.meta.env.VITE_OPENSEES_URL || LOCAL_OPENSEES_URL);

/** The adapter for a choice. One instance per solver, so the WebAssembly module loads once. */
export function solverFor(choice: SolverChoice): SolverAdapter {
  return choice === 'opensees' ? openSees : wasmSolver;
}

export const solverLabel = (choice: SolverChoice): string =>
  SOLVER_CHOICES.find((entry) => entry.id === choice)?.label ?? choice;
