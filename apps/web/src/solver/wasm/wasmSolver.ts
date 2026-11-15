import type {
  AnalysisLoadCase,
  AnalysisModel,
  AnalysisOptions,
  AnalysisResult,
  DetailedAnalysisResult,
  DetailedSolver,
  LoadCaseAnalysis,
  LoadCaseSolver,
  SolverAdapter,
  StructuralModel,
} from '@dof/solver-contract';
import { fromDetailedResult, toAnalysisModel } from './legacyContract';
import { createInlineRunner, createWorkerRunner, type RunOutcome, type SolverRunner, type WasmSource } from './runner';
import type { WorkerLike } from './workerProtocol';

export type { WasmSource } from './runner';

/** Wall-clock limit for one analysis on the worker, unless configured. */
export const DEFAULT_TIME_LIMIT_MS = 10_000;

export interface WasmSolverConfig {
  /** Where the module bytes come from; tests read the file from disk. */
  source?: WasmSource;
  /**
   * Creates the background worker, or `false` to run on the calling thread.
   * Defaults to `solverWorker.ts` where `Worker` exists, otherwise inline.
   */
  worker?: (() => WorkerLike) | false;
  /** Wall-clock limit for one analysis, ms. Applies only on a worker. */
  timeLimitMs?: number;
}

/** Fetch the module that Vite bundles next to this file. */
const bundledModule: WasmSource = async () => {
  const response = await fetch(new URL('./dof_solver.wasm', import.meta.url));
  if (!response.ok) throw new Error(`Could not load the solver module (HTTP ${response.status}).`);
  return response.arrayBuffer();
};

/** The worker Vite bundles from `solverWorker.ts`. */
const bundledWorker = (): WorkerLike =>
  new Worker(new URL('./solverWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;

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

/** A time limit in words: '10 s', '2.5 s', '300 ms'. */
const duration = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${Number((ms / 1000).toFixed(1))} s`);

/** The result for a run that did not produce the module's JSON answer. */
function failureFor(outcome: Exclude<RunOutcome, { kind: 'text' }>): DetailedAnalysisResult {
  switch (outcome.kind) {
    case 'unavailable':
      return failure('solverUnavailable', `The solver module could not be loaded: ${outcome.message}`);
    case 'trap':
      return failure('internalError', 'The solver failed unexpectedly.');
    case 'timeout':
      return failure(
        'timeLimitExceeded',
        `The analysis did not finish within ${duration(outcome.limitMs)} and was stopped.`,
      );
  }
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The Rust reference solver, running as WebAssembly in the browser.
 *
 * No service is involved: the module is downloaded once, on first use, and
 * every analysis runs on the player's own computer. In a browser it runs on
 * a background worker, so the page stays responsive; aborting the signal or
 * exceeding `timeLimitMs` terminates the worker and stops the analysis at
 * once. Where there is no `Worker` (Node, tests) it runs on the calling
 * thread, which it blocks, and can be neither cancelled once started nor
 * time limited: only the solver's own iteration limits bound it.
 *
 * Both contracts are served. `analyzeDetailed` exposes the full model and
 * result; `analyzeCases` runs several load cases in one call. `analyze`
 * accepts the original `StructuralModel` and answers in the original
 * `AnalysisResult`, using the same modelling choices as the OpenSees service
 * so that the two backends can be compared.
 *
 * Every outcome is a result, including a timeout (reason code
 * `timeLimitExceeded`). The only rejection is the signal's reason when the
 * caller aborts.
 *
 * @param config A `WasmSource` alone, or the full configuration.
 */
export function createWasmSolver(config: WasmSource | WasmSolverConfig = {}): SolverAdapter & DetailedSolver & LoadCaseSolver {
  const { source = bundledModule, worker, timeLimitMs = DEFAULT_TIME_LIMIT_MS } =
    typeof config === 'function' ? { source: config } : config;
  const spawn = worker ?? (typeof Worker === 'undefined' ? false : bundledWorker);
  const runner: SolverRunner = spawn ? createWorkerRunner(source, spawn, timeLimitMs) : createInlineRunner(source);

  /** Run one request; the answer is either one result or a case list. */
  async function request(body: object, signal?: AbortSignal): Promise<{ value: unknown; runtimeMs: number } | DetailedAnalysisResult> {
    const started = performance.now();
    const outcome = await runner.run(JSON.stringify(body), signal);
    if (outcome.kind !== 'text') return failureFor(outcome);
    return { value: parse(outcome.text), runtimeMs: performance.now() - started };
  }

  async function analyzeDetailed(
    model: AnalysisModel,
    options: AnalysisOptions = {},
    signal?: AbortSignal,
  ): Promise<DetailedAnalysisResult> {
    const answer = await request({ model, options }, signal);
    if (!('value' in answer)) return answer;
    if (!isDetailedResult(answer.value)) return failure('internalError', 'The solver returned an unexpected result.');
    answer.value.analysis.runtimeMs = answer.runtimeMs;
    return answer.value;
  }

  async function analyzeCases(
    model: AnalysisModel,
    cases: AnalysisLoadCase[],
    options: AnalysisOptions = {},
    signal?: AbortSignal,
  ): Promise<LoadCaseAnalysis> {
    // Every case gets the same result when the call as a whole fails.
    const everyCase = (result: DetailedAnalysisResult, runtimeMs?: number): LoadCaseAnalysis => ({
      cases: cases.map(({ id }) => ({ id, result })),
      runtimeMs,
    });
    const answer = await request({ model, options, cases }, signal);
    if (!('value' in answer)) return everyCase(answer);
    const { value, runtimeMs } = answer;
    // A request the module rejects as a whole comes back as one result.
    if (isDetailedResult(value)) return everyCase(value, runtimeMs);
    const listed = isRecord(value) && Array.isArray(value.cases) ? value.cases : undefined;
    const valid =
      listed?.length === cases.length &&
      listed.every((entry, i) => isRecord(entry) && entry.id === cases[i].id && isDetailedResult(entry.result));
    if (!valid) return everyCase(failure('internalError', 'The solver returned an unexpected result.'), runtimeMs);
    return { cases: listed as LoadCaseAnalysis['cases'], runtimeMs };
  }

  return {
    id: 'dof-wasm',
    name: 'Rust solver (WebAssembly)',
    analyzeDetailed,
    analyzeCases,
    async analyze(model: StructuralModel, signal?: AbortSignal): Promise<AnalysisResult> {
      const translated = toAnalysisModel(model);
      if ('error' in translated) return { status: 'error', message: translated.error };
      if ('unsupported' in translated) return { status: 'unsupported', message: translated.unsupported };
      const detailed = await analyzeDetailed(translated.model, translated.options, signal);
      return fromDetailedResult(model, detailed, translated.displacementLimit, translated.segmentsPerFrame);
    },
  };
}
