import { analyzeAndStore, createStructuralStateService, parseStructuralAnalysisRequest, type StructuralStateStorage, type StoredAnalysisOutcome } from '@dof/solver-contract';
import { createStoredOpenSeesAdapter } from './structuralOpenSees';

/** Save the requested snapshot, then run and archive an explicitly provisional OpenSees check. */
export async function runStoredOpenSees(
  storage: StructuralStateStorage,
  input: unknown,
  options: { baseUrl: string; runId: string; isCurrent: () => boolean; signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<StoredAnalysisOutcome> {
  try {
    const request = parseStructuralAnalysisRequest(input);
    if (options.signal?.aborted) return { status: 'aborted' };
    if (!options.isCurrent()) return { status: 'stale' };
    const saved = createStructuralStateService(storage).write(request.snapshot);
    if (saved.status === 'error') return saved;
    const adapter = createStoredOpenSeesAdapter(options.baseUrl, { runId: options.runId, purpose: 'preview' }, options.fetchImpl);
    return analyzeAndStore(storage, adapter, request, options);
  } catch (error) {
    if (options.signal?.aborted) return { status: 'aborted' };
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}
