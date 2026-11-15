/**
 * Where the solver module runs: on a background worker (the browser default)
 * or on the calling thread (Node and tests).
 *
 * A WebAssembly call cannot be interrupted from inside, so cancellation and
 * the wall-clock time limit work by terminating the worker. The inline runner
 * can do neither: once a call starts it runs to the end, bounded only by the
 * solver's own iteration limits.
 */
import { call, instantiate, type SolverExports } from './wasmCall';
import type { WorkerLike, WorkerReply } from './workerProtocol';

/** Supplies the bytes of `dof_solver.wasm`. */
export type WasmSource = () => Promise<BufferSource>;

/** How one request ended. Aborting rejects instead, with the signal's reason. */
export type RunOutcome =
  | { kind: 'text'; text: string }
  /** The module could not be downloaded, compiled or instantiated. */
  | { kind: 'unavailable'; message: string }
  /** The module trapped (a Rust panic). */
  | { kind: 'trap' }
  /** The analysis ran longer than the time limit and was stopped. */
  | { kind: 'timeout'; limitMs: number };

export interface SolverRunner {
  run(request: string, signal?: AbortSignal): Promise<RunOutcome>;
}

const message = (error: unknown) => (error instanceof Error ? error.message : 'unknown error');

/** Compile the module once; a failed download can be retried on the next call. */
function compiler(source: WasmSource): () => Promise<WebAssembly.Module> {
  let compiling: Promise<WebAssembly.Module> | undefined;
  return () => {
    compiling ??= source().then((bytes) => WebAssembly.compile(bytes));
    compiling.catch(() => (compiling = undefined));
    return compiling;
  };
}

/**
 * Run on the calling thread. The call blocks that thread, cannot be
 * cancelled once started, and has no wall-clock limit.
 */
export function createInlineRunner(source: WasmSource): SolverRunner {
  const compile = compiler(source);
  let instance: Promise<SolverExports> | undefined;
  return {
    async run(request, signal) {
      signal?.throwIfAborted();
      let solver: SolverExports;
      try {
        instance ??= compile().then(instantiate);
        solver = await instance;
      } catch (error) {
        instance = undefined;
        signal?.throwIfAborted();
        return { kind: 'unavailable', message: message(error) };
      }
      signal?.throwIfAborted();
      try {
        return { kind: 'text', text: call(solver, request) };
      } catch {
        // A trap leaves the instance's memory in an unknown state.
        instance = undefined;
        return { kind: 'trap' };
      }
    },
  };
}

/**
 * Run on a background worker, one request at a time.
 *
 * Requests queue in call order. The time limit counts from when the worker
 * starts the analysis, so time spent waiting in the queue or downloading the
 * module does not count against it. On timeout or abort the worker is
 * terminated, which stops the analysis at once; the next request starts a
 * fresh worker from the already compiled module.
 *
 * @param spawn Creates a worker running `solverWorker.ts`.
 * @param timeLimitMs Wall-clock limit for one analysis.
 */
export function createWorkerRunner(source: WasmSource, spawn: () => WorkerLike, timeLimitMs: number): SolverRunner {
  const compile = compiler(source);
  let worker: WorkerLike | undefined;
  let nextId = 0;
  let queue: Promise<unknown> = Promise.resolve();

  const kill = () => {
    worker?.terminate();
    worker = undefined;
  };

  async function runNow(request: string, signal?: AbortSignal): Promise<RunOutcome> {
    signal?.throwIfAborted();
    let module: WebAssembly.Module;
    try {
      module = await compile();
    } catch (error) {
      signal?.throwIfAborted();
      return { kind: 'unavailable', message: message(error) };
    }
    signal?.throwIfAborted();

    return new Promise<RunOutcome>((resolve, reject) => {
      const current = (worker ??= spawn());
      const id = ++nextId;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = (outcome: RunOutcome | { abort: unknown }, terminate: boolean) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        current.onmessage = null;
        current.onerror = null;
        if (terminate && worker === current) kill();
        if ('abort' in outcome) reject(outcome.abort);
        else resolve(outcome);
      };
      const onAbort = () => finish({ abort: signal?.reason }, true);

      current.onmessage = ({ data }: { data: WorkerReply }) => {
        if (data.id !== id) return;
        switch (data.kind) {
          case 'started':
            timer = setTimeout(() => finish({ kind: 'timeout', limitMs: timeLimitMs }, true), timeLimitMs);
            return;
          case 'text':
            return finish({ kind: 'text', text: data.text }, false);
          case 'trap':
            return finish({ kind: 'trap' }, true);
          case 'unavailable':
            return finish({ kind: 'unavailable', message: data.message }, true);
        }
      };
      // The worker script itself failed to load or threw outside a request.
      current.onerror = () => finish({ kind: 'unavailable', message: 'The solver worker stopped unexpectedly.' }, true);
      signal?.addEventListener('abort', onAbort, { once: true });
      current.postMessage({ id, module, request });
    });
  }

  return {
    run(request, signal) {
      const result = queue.then(() => runNow(request, signal));
      queue = result.catch(() => undefined);
      return result;
    },
  };
}
