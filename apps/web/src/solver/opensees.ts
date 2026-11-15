import type { AnalysisResult, ComponentResult, SolverAdapter, StructuralModel } from '@dof/solver-contract';

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
    Array.isArray(value.modes) && value.modes.every(mode => isRecord(mode) &&
      (mode.kind === 'translation' || mode.kind === 'rotation') && isVectors(mode.displacements))
  );
}

function isNonlinearReport(value: unknown): boolean {
  return isRecord(value) &&
    ['segmentsPerFrame', 'steps', 'forceResidual', 'momentResidual', 'nodalResidual'].every(key => Number.isFinite(value[key])) &&
    isRecord(value.cableState) && Object.values(value.cableState).every(state => state === 'taut' || state === 'slack');
}

/**
 * Check the fields the app reads before trusting a response body. The service
 * is a separate process that may be a different version, so its output is
 * validated here instead of being cast to the contract type.
 */
function isComponentResult(value: unknown): value is ComponentResult {
  if (!isRecord(value)) return false;
  if (value.status !== 'success' && ['reactions', 'displacements', 'memberForces'].some(key => key in value)) return false;
  switch (value.status) {
    case 'success':
      return (
        isVectors(value.displacements) &&
        (value.reactions === undefined || isVectors(value.reactions)) &&
        (value.memberForces === undefined || (isRecord(value.memberForces) &&
          Object.values(value.memberForces).every(f => isRecord(f) &&
            ['axial', 'shear', 'torsion', 'momentStart', 'momentEnd'].every(k => Number.isFinite(f[k]))))) &&
        isStringArray(value.warnings) &&
        (value.nonlinear === undefined || isNonlinearReport(value.nonlinear)) &&
        (value.stability === undefined || isStabilityReport(value.stability))
      );
    case 'unstable':
      return typeof value.message === 'string' && isStringArray(value.warnings) && isStabilityReport(value.stability);
    case 'unsupported':
    case 'unresolved':
    case 'error':
      return typeof value.message === 'string';
    default:
      return false;
  }
}

/** Outcome of asking an OpenSees service whether it is running. */
export type OpenSeesHealth =
  | { status: 'ok'; openSeesVersion: string | null }
  | { status: 'unreachable'; message: string };

/**
 * Ask the service at `baseUrl` for `GET /health`. Never rejects: a network
 * failure, a timeout or an unexpected body is reported as unreachable.
 */
export async function checkOpenSees(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 3000,
): Promise<OpenSeesHealth> {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, { signal: controller.signal });
    const body: unknown = await response.json().catch(() => undefined);
    if (response.ok && isRecord(body) && body.status === 'ok')
      return { status: 'ok', openSeesVersion: typeof body.opensees === 'string' ? body.opensees : null };
    return { status: 'unreachable', message: `${endpoint} answered, but not as an OpenSees service (HTTP ${response.status}).` };
  } catch {
    return {
      status: 'unreachable',
      message: controller.signal.aborted ? `${endpoint} did not answer within ${timeoutMs / 1000} s.` : `Could not reach ${endpoint}.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function isVectors(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(v => Array.isArray(v) && v.length === 6 && v.every(Number.isFinite));
}

function isAnalysisResult(value: unknown, model: StructuralModel): value is AnalysisResult {
  if (!isRecord(value)) return false;
  const { components, inactiveNodeIds } = value;
  if (!isComponentResult(value)) return false;
  if (components === undefined) return inactiveNodeIds === undefined;
  if (!Array.isArray(components) || components.length < 2) return false;
  const nodes = new Set(model.nodes.map(n => n.id));
  const members = new Map(model.members.map(m => [m.id, m]));
  const inactive = inactiveNodeIds ?? [];
  if (!isStringArray(inactive) || !inactive.every(id => nodes.delete(id))) return false;
  let solved = 0;
  for (const scope of components) {
    if (!isRecord(scope) || !isStringArray(scope.nodeIds) || !scope.nodeIds.length ||
        !isStringArray(scope.memberIds) || !scope.nodeIds.every(id => nodes.delete(id)) ||
        !isComponentResult(scope.result)) return false;
    const region = new Set(scope.nodeIds);
    const ids = new Set(scope.memberIds);
    for (const id of scope.memberIds) {
      const member = members.get(id);
      if (!member || !region.has(member.startNodeId) || !region.has(member.endNodeId)) return false;
      members.delete(id);
    }
    if ('stability' in scope.result && scope.result.stability) {
      const stability = scope.result.stability;
      if (!stability.unstableNodeIds.every(id => region.has(id)) ||
          !stability.modes.every(mode => Object.keys(mode.displacements).every(id => region.has(id)))) return false;
    }
    if (scope.result.status === 'success') {
      const {displacements, reactions, memberForces} = scope.result;
      solved++;
      if (Object.keys(displacements).length !== region.size || !Object.keys(displacements).every(id => region.has(id)) ||
          !Object.keys(reactions ?? {}).every(id => region.has(id)) ||
          !Object.keys(memberForces ?? {}).every(id => ids.has(id)) ||
          !Object.keys(scope.result.nonlinear?.cableState ?? {}).every(id => ids.has(id))) return false;
    }
  }
  return nodes.size === 0 && members.size === 0 && (value.status === 'success') === (solved === components.length);
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
      if (isAnalysisResult(body, model)) return body;
      return { status: 'error', message: `The OpenSees service returned an unexpected response (HTTP ${response.status}).` };
    },
  };
}
