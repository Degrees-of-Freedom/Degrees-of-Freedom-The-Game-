import type { SolverAdapter } from '@dof/solver-contract';
/** Explicit placeholder until a real solver is connected. */
export const unavailableSolver: SolverAdapter = { id: 'unavailable', name: 'No solver connected', async analyze() { return { status: 'unsupported', message: 'A structural solver has not been connected yet.' }; } };
