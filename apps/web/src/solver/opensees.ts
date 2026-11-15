import type { AnalysisResult, SolverAdapter, StructuralModel } from '@dof/solver-contract';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
const isOneOf = (value: unknown, allowed: readonly string[]): boolean =>
  typeof value === 'string' && allowed.includes(value);

const STABILITY_COUNTS = ['freeDofs', 'mechanisms', 'translationalMechanisms', 'rotationalMechanisms', 'staticIndeterminacy'];
const COMPONENT_STATES = ['stable', 'marginal', 'unstable', 'unknown'];
const FIDELITIES = ['linear', 'nonlinear'];
const REASON_CODES = [
  'unsupported_component', 'rigid_body_mechanism', 'internal_mechanism', 'near_mechanism',
  'load_induced_instability', 'geometrically_stiffened', 'excessive_deformation', 'cable_slack',
  'not_converged', 'timeout', 'equilibrium_not_verified', 'non_finite_result', 'solver_error',
];

const isReasonCodes = (value: unknown): boolean =>
  Array.isArray(value) && value.every((code) => isOneOf(code, REASON_CODES));

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

function isComponent(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isStringArray(value.nodeIds) &&
    isStringArray(value.memberIds) &&
    isOneOf(value.state, COMPONENT_STATES) &&
    isReasonCodes(value.reasonCodes) &&
    typeof value.resultsValid === 'boolean' &&
    isStabilityReport(value.stability)
  );
}

function isAnalysisSummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    isOneOf(value.fidelity, FIDELITIES) &&
    typeof value.solver === 'string' &&
    Number.isFinite(value.runtimeMs) &&
    isReasonCodes(value.reasonCodes)
  );
}

/** The body shared by success, unstable and unresolved results. */
function isAnalysisBody(value: Record<string, unknown>): boolean {
  return (
    isAnalysisSummary(value.analysis) &&
    Array.isArray(value.components) &&
    value.components.every(isComponent) &&
    isVectors(value.displacements) &&
    isVectors(value.reactions) &&
    isRecord(value.memberForces) &&
    isStabilityReport(value.stability) &&
    isStringArray(value.warnings)
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
function isResultBody(value: unknown): value is AnalysisResult {
  if (!isRecord(value)) return false;
  switch (value.status) {
    case 'success':
    case 'unstable':
    case 'unresolved':
      return (
        (value.status === 'success' || typeof value.message === 'string') &&
        isAnalysisBody(value) &&
        (value.nonlinear === undefined || isNonlinearReport(value.nonlinear)) &&
        (value.inactiveNodeIds === undefined || isStringArray(value.inactiveNodeIds))
      );
    case 'unsupported':
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
  if (!isResultBody(value)) return false;
  if (value.status === 'unsupported' || value.status === 'error') return true;
  const body = value as Extract<AnalysisResult, { status: 'success' }>;
  const nodes = new Set(model.nodes.map((node) => node.id));
  const members = new Set(model.members.map((member) => member.id));
  const nodeOwner = new Map<string, string>();
  const memberOwner = new Map<string, string>();
  const valid = new Set<string>();
  for (const component of body.components) {
    for (const id of component.nodeIds) {
      if (!nodes.has(id) || nodeOwner.has(id)) return false;
      nodeOwner.set(id, component.id);
    }
    for (const id of component.memberIds) {
      if (!members.has(id) || memberOwner.has(id)) return false;
      memberOwner.set(id, component.id);
    }
    if (component.resultsValid) valid.add(component.id);
  }
  const inValidNode = (id: string) => valid.has(nodeOwner.get(id) ?? '');
  const inValidMember = (id: string) => valid.has(memberOwner.get(id) ?? '');
  return (
    Object.keys(body.displacements).every(inValidNode) &&
    Object.keys(body.reactions).every(inValidNode) &&
    Object.keys(body.memberForces).every(inValidMember) &&
    Object.keys(body.nonlinear?.cableState ?? {}).every((id) => members.has(id)) &&
    (body.inactiveNodeIds ?? []).every((id) => nodes.has(id) && !nodeOwner.has(id))
  );
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
    name: 'OpenSees',
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

