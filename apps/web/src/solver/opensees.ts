import type { AnalysisResult, SolverAdapter, StructuralModel } from '@dof/solver-contract';

const STATUSES: ReadonlySet<string> = new Set(['success', 'unstable', 'unsupported', 'error']);

function isAnalysisResult(value: unknown): value is AnalysisResult {
  return typeof value === 'object' && value !== null && STATUSES.has((value as { status?: unknown }).status as string);
}

/**
 * Client for the OpenSees service in `services/opensees`.
 *
 * The service answers `POST /analyze` with an `AnalysisResult` body for every
 * outcome it understands, including schema rejections, so the body is passed
 * through unchanged. Network failures and unexpected bodies become `error`
 * results rather than exceptions, so callers handle one result type. The one
 * exception is cancellation: aborting the signal rejects with the `AbortError`
 * from `fetch`, because a cancelled analysis has no result to report.
 *
 * @param baseUrl Service origin, for example `http://localhost:8000`.
 * @param fetchImpl Override for tests; defaults to the global `fetch`.
 */
export function createOpenSeesSolver(baseUrl: string, fetchImpl: typeof fetch = fetch): SolverAdapter {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/analyze`;
  return {
    id: 'opensees',
    name: 'OpenSees linear static',
    async analyze(model: StructuralModel, signal?: AbortSignal): Promise<AnalysisResult> {
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(model),
          signal,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        return { status: 'error', message: `Could not reach the OpenSees service at ${endpoint}.` };
      }
      const body: unknown = await response.json().catch(() => undefined);
      if (isAnalysisResult(body)) return body;
      return { status: 'error', message: `The OpenSees service returned an unexpected response (HTTP ${response.status}).` };
    },
  };
}
