import { z } from 'zod';
import { parseStructuralAnalysisResult, structuralAnalysisResultSchema, type StructuralAnalysisResult } from './analysis-result.js';
import { createStructuralStateService, type StructuralStateStorage } from './structural-state-service.js';

const collectionSchema = z.strictObject({
  format: z.literal('dof-analysis-results'), version: z.literal(1), modelId: z.string().min(1),
  runs: z.array(structuralAnalysisResultSchema),
});
export type AnalysisResultsRead = { status: 'found'; results: StructuralAnalysisResult[] } | { status: 'missing' } | { status: 'error'; message: string };
export type AnalysisResultsWrite = { status: 'saved' | 'unchanged' } | { status: 'error'; message: string };

/**
 * One independently stored collection per model. Each write is a single storage
 * operation, but this synchronous interface cannot prevent cross-tab lost updates.
 */
export function createAnalysisResultsStore(storage: StructuralStateStorage) {
  const states = createStructuralStateService(storage);
  const key = (modelId: string) => `dof:analysis-results:v1:${encodeURIComponent(modelId)}`;
  const read = (modelId: string): AnalysisResultsRead => {
    try {
      const raw = storage.getItem(key(modelId));
      if (raw === null) return { status: 'missing' };
      const collection = collectionSchema.parse(JSON.parse(raw));
      if (collection.modelId !== modelId) throw new Error('Result collection model does not match its key.');
      const seen = new Set<string>();
      for (const run of collection.runs) {
        if (run.request.snapshot.modelId !== modelId || seen.has(run.runId)) throw new Error('Result collection contains a duplicate run or mismatched model.');
        seen.add(run.runId);
      }
      return { status: 'found', results: collection.runs };
    } catch (error) {
      return { status: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  };
  return {
    read,
    readRun(modelId: string, runId: string): { status: 'found'; result: StructuralAnalysisResult } | { status: 'missing' } | { status: 'error'; message: string } {
      const collection = read(modelId);
      if (collection.status !== 'found') return collection;
      const result = collection.results.find((run) => run.runId === runId);
      return result ? { status: 'found', result } : { status: 'missing' };
    },
    write(value: unknown): AnalysisResultsWrite {
      try {
        const result = parseStructuralAnalysisResult(value);
        const snapshot = result.request.snapshot;
        const saved = states.read(snapshot.modelId, snapshot.revisionId);
        if (saved.status !== 'found' || JSON.stringify(saved.snapshot) !== JSON.stringify(snapshot))
          throw new Error('Matching immutable structural revision is missing, invalid, or differs from the request.');
        const collection = read(snapshot.modelId);
        if (collection.status === 'error') return collection;
        const runs = collection.status === 'found' ? collection.results : [];
        const existing = runs.find((run) => run.runId === result.runId);
        if (existing) {
          if (JSON.stringify(existing) !== JSON.stringify(result)) throw new Error('Run ID already exists with different content.');
          return { status: 'unchanged' };
        }
        storage.setItem(key(snapshot.modelId), JSON.stringify({ format: 'dof-analysis-results', version: 1, modelId: snapshot.modelId, runs: [...runs, result] }));
        return { status: 'saved' };
      } catch (error) {
        return { status: 'error', message: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
