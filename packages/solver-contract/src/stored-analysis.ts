import { parseStructuralAnalysisRequest, type StructuralAnalysisRequest } from './structural-state.js';
import { parseStructuralAnalysisResult, type StructuralAnalysisResult } from './analysis-result.js';
import { createStructuralStateService, type StructuralStateStorage } from './structural-state-service.js';
import { createAnalysisResultsStore } from './analysis-results-store.js';

/** A solver accepting the shared request must report unsupported features explicitly. */
export interface StructuralResultAdapter {
  analyze(request: StructuralAnalysisRequest, signal?: AbortSignal): Promise<unknown>;
}
export type StoredAnalysisOutcome =
  | { status: 'stored'; result: StructuralAnalysisResult }
  | { status: 'stale' | 'aborted' }
  | { status: 'error'; message: string };

/**
 * Analyze a previously saved revision and persist its exact result. `isCurrent`
 * is checked immediately before the synchronous write, so stale replies do not
 * enter the current UI flow. It is not a multi-tab transaction or scoring API.
 */
export async function analyzeAndStore(
  storage: StructuralStateStorage,
  adapter: StructuralResultAdapter,
  input: unknown,
  options: { isCurrent: () => boolean; signal?: AbortSignal },
): Promise<StoredAnalysisOutcome> {
  try {
    const request = parseStructuralAnalysisRequest(input);
    const saved = createStructuralStateService(storage).read(request.snapshot.modelId, request.snapshot.revisionId);
    if (saved.status !== 'found' || JSON.stringify(saved.snapshot) !== JSON.stringify(request.snapshot))
      return { status: 'error', message: 'The requested structural revision is missing or differs from the saved state.' };
    if (options.signal?.aborted) return { status: 'aborted' };
    // The adapter receives its own copy so it cannot mutate the expected request.
    const raw = await adapter.analyze(parseStructuralAnalysisRequest(request), options.signal);
    if (options.signal?.aborted) return { status: 'aborted' };
    if (!options.isCurrent()) return { status: 'stale' };
    const result = parseStructuralAnalysisResult(raw);
    if (JSON.stringify(result.request) !== JSON.stringify(request))
      return { status: 'error', message: 'Solver result does not match the requested model and analysis options.' };
    const written = createAnalysisResultsStore(storage).write(result);
    if (written.status === 'error') return written;
    return { status: 'stored', result };
  } catch (error) {
    if (options.signal?.aborted) return { status: 'aborted' };
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}
