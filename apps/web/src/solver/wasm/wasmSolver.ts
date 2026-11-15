import type {
  AnalysisModel,
  AnalysisOptions,
  AnalysisResult,
  DetailedAnalysisResult,
  DetailedSolver,
  SolverAdapter,
  StructuralModel,
} from '@dof/solver-contract';
import { fromDetailedResult, toAnalysisModel } from './legacyContract';

/** Supplies the bytes of `dof_solver.wasm`. */
export type WasmSource = () => Promise<BufferSource>;

/** Functions exported by the module; see `crates/dof-solver/src/lib.rs`. */
interface SolverExports {
  memory: WebAssembly.Memory;
  dof_alloc(length: number): number;
  dof_free(pointer: number, length: number): void;
  dof_analyze(pointer: number, length: number): number;
}

/** Fetch the module that Vite bundles next to this file. */
const bundledModule: WasmSource = async () => {
  const response = await fetch(new URL('./dof_solver.wasm', import.meta.url));
  if (!response.ok) throw new Error(`Could not load the solver module (HTTP ${response.status}).`);
  return response.arrayBuffer();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Check the parts of a result the app relies on. The module is built from
 * this repository, but it is still a separate artefact that can be stale, so
 * its output is checked at the boundary instead of being cast.
 */
function isDetailedResult(value: unknown): value is DetailedAnalysisResult {
  return (
    isRecord(value) &&
    isRecord(value.analysis) &&
    (value.analysis.status === 'ok' || value.analysis.status === 'invalid') &&
    Array.isArray(value.analysis.reasonCodes) &&
    Array.isArray(value.analysis.diagnostics) &&
    Array.isArray(value.components) &&
    isRecord(value.nodes) &&
    isRecord(value.members) &&
    isRecord(value.foundations) &&
    Array.isArray(value.failureEvents)
  );
}

/** A result for a failure of the solver itself, in the solver's own format. */
function failure(code: string, message: string): DetailedAnalysisResult {
  return {
    analysis: {
      solverVersion: 'unknown',
      modelVersion: null,
      units: 'SI',
      status: 'invalid',
      reasonCodes: [code],
      diagnostics: [{ code, message, ids: [] }],
    },
    components: [],
    nodes: {},
    members: {},
    foundations: {},
    failureEvents: [],
  };
}

/** Pass one JSON request through the module and return its JSON answer. */
function call(solver: SolverExports, request: string): string {
  const input = new TextEncoder().encode(request);
  const inputPointer = solver.dof_alloc(input.length);
  // Take the memory view after allocating: growing the memory detaches views.
  new Uint8Array(solver.memory.buffer, inputPointer, input.length).set(input);
  let outputPointer: number;
  try {
    outputPointer = solver.dof_analyze(inputPointer, input.length);
  } finally {
    solver.dof_free(inputPointer, input.length);
  }
  // The answer is a little-endian length followed by that many UTF-8 bytes.
  const length = new DataView(solver.memory.buffer).getUint32(outputPointer, true);
  const text = new TextDecoder().decode(new Uint8Array(solver.memory.buffer, outputPointer + 4, length));
  solver.dof_free(outputPointer, length + 4);
  return text;
}

/**
 * The Rust reference solver, running as WebAssembly in the browser.
 *
 * No service is involved: the module is downloaded once, on first use, and
 * every analysis runs on the player's own computer. The call is synchronous
 * once the module is loaded, so it blocks the calling thread for the duration
 * of the analysis; the solver bounds its own work by an iteration limit.
 *
 * Both contracts are served. `analyzeDetailed` exposes the full model and
 * result. `analyze` accepts the original `StructuralModel` and answers in
 * the original `AnalysisResult`, using the same modelling choices as the
 * OpenSees service so that the two backends can be compared.
 *
 * Every outcome is a result. The only rejection is an `AbortError` when the
 * caller aborts.
 *
 * @param source Override for where the module bytes come from; tests read
 *   the file from disk.
 */
export function createWasmSolver(source: WasmSource = bundledModule): SolverAdapter & DetailedSolver {
  let loading: Promise<SolverExports> | undefined;

  const load = (): Promise<SolverExports> => {
    loading ??= source()
      .then((bytes) => WebAssembly.instantiate(bytes, {}))
      .then(({ instance }) => instance.exports as unknown as SolverExports);
    // A failed download can be retried on the next call.
    loading.catch(() => (loading = undefined));
    return loading;
  };

  async function analyzeDetailed(
    model: AnalysisModel,
    options: AnalysisOptions = {},
    signal?: AbortSignal,
  ): Promise<DetailedAnalysisResult> {
    signal?.throwIfAborted();
    let solver: SolverExports;
    try {
      solver = await load();
    } catch (error) {
      signal?.throwIfAborted();
      const reason = error instanceof Error ? error.message : 'unknown error';
      return failure('solverUnavailable', `The solver module could not be loaded: ${reason}`);
    }
    signal?.throwIfAborted();

    const started = performance.now();
    let parsed: unknown;
    try {
      parsed = JSON.parse(call(solver, JSON.stringify({ model, options })));
    } catch {
      // A trap inside the module (a Rust panic) leaves its memory in an
      // unknown state, so the instance is dropped and reloaded next time.
      loading = undefined;
      return failure('internalError', 'The solver failed unexpectedly.');
    }
    if (!isDetailedResult(parsed)) return failure('internalError', 'The solver returned an unexpected result.');
    parsed.analysis.runtimeMs = performance.now() - started;
    return parsed;
  }

  return {
    id: 'dof-wasm',
    name: 'Rust solver (WebAssembly)',
    analyzeDetailed,
    async analyze(model: StructuralModel, signal?: AbortSignal): Promise<AnalysisResult> {
      const translated = toAnalysisModel(model);
      if ('error' in translated) return { status: 'error', message: translated.error };
      const detailed = await analyzeDetailed(translated.model, translated.options, signal);
      return fromDetailedResult(model, detailed);
    },
  };
}
