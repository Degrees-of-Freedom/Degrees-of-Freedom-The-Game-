/**
 * Messages between the main thread and the solver worker
 * (`solverWorker.ts`). One request is in the worker at a time.
 */
import { call, instantiate, type SolverExports } from './wasmCall';

export interface WorkerRequest {
  id: number;
  /** Compiled solver module; structured-cloned, so it is not recompiled. */
  module: WebAssembly.Module;
  /** JSON request for `dof_analyze`. */
  request: string;
}

export type WorkerReply =
  /** The module is instantiated and the analysis is starting now. */
  | { id: number; kind: 'started' }
  /** The JSON answer of `dof_analyze`. */
  | { id: number; kind: 'text'; text: string }
  /** The module trapped; the worker has dropped its instance. */
  | { id: number; kind: 'trap' }
  /** The module could not be instantiated. */
  | { id: number; kind: 'unavailable'; message: string };

/** The part of a `Worker` the runner uses, so tests can supply a fake. */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  terminate(): void;
  onmessage: ((event: { data: WorkerReply }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** Answer one request with the given module call. Used by the worker and its test double. */
export async function handleRequest(
  { id, module, request }: WorkerRequest,
  cache: { solver?: Promise<SolverExports> },
  post: (reply: WorkerReply) => void,
): Promise<void> {
  // One runner sends one module, so the first instance serves every request
  // until a trap discards it. (A cloned module is a new object each time, so
  // it cannot be compared by identity.)
  cache.solver ??= instantiate(module);
  let solver: SolverExports;
  try {
    solver = await cache.solver;
  } catch (error) {
    cache.solver = undefined;
    post({ id, kind: 'unavailable', message: error instanceof Error ? error.message : 'unknown error' });
    return;
  }
  post({ id, kind: 'started' });
  try {
    post({ id, kind: 'text', text: call(solver, request) });
  } catch {
    // A trap leaves the instance's memory in an unknown state.
    cache.solver = undefined;
    post({ id, kind: 'trap' });
  }
}
