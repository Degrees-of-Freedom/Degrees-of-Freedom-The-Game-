import type { AnalysisResult, SolverAdapter, StructuralModel } from '@dof/solver-contract';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const STABILITY_COUNTS = ['freeDofs', 'mechanisms', 'translationalMechanisms', 'rotationalMechanisms', 'staticIndeterminacy'];

function isStabilityReport(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.stable === 'boolean' &&
    STABILITY_COUNTS.every((key) => Number.isFinite(value[key])) &&
    isStringArray(value.unstableNodeIds) &&
    Array.isArray(value.modes)
  );
}

/**
 * Check the fields the app reads before trusting a response body. The service
 * is a separate process that may be a different version, so its output is
 * validated here instead of being cast to the contract type.
 */
function isAnalysisResult(value: unknown): value is AnalysisResult {
  if (!isRecord(value)) return false;
  switch (value.status) {
    case 'success':
      return (
        isRecord(value.displacements) &&
        isStringArray(value.warnings) &&
        (value.stability === undefined || isStabilityReport(value.stability))
      );
    case 'unstable':
      return typeof value.message === 'string' && isStringArray(value.warnings) && isStabilityReport(value.stability);
    case 'unsupported':
    case 'error':
      return typeof value.message === 'string';
    default:
      return false;
  }
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
