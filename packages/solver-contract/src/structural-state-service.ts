import { parseStructuralSnapshot, type StructuralSnapshot } from './structural-state.js';

/** Minimal synchronous storage boundary, e.g. localStorage or an in-memory test store. */
export interface StructuralStateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export type StructuralStateRead =
  | { status: 'found'; snapshot: StructuralSnapshot }
  | { status: 'missing' }
  | { status: 'error'; message: string };
export type StructuralStateWrite = { status: 'saved' | 'unchanged' } | { status: 'error'; message: string };

/** Store independent immutable revisions. No legacy voxel migration is inferred. */
export function createStructuralStateService(storage: StructuralStateStorage) {
  const key = (modelId: string, revisionId: string) => `dof:structural:v1:${encodeURIComponent(modelId)}:${encodeURIComponent(revisionId)}`;
  const read = (modelId: string, revisionId: string): StructuralStateRead => {
    try {
      const raw = storage.getItem(key(modelId, revisionId));
      if (raw === null) return { status: 'missing' };
      const snapshot = parseStructuralSnapshot(JSON.parse(raw));
      if (snapshot.modelId !== modelId || snapshot.revisionId !== revisionId) throw new Error('Stored state identity does not match its key.');
      return { status: 'found', snapshot };
    } catch (error) {
      return { status: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  };
  return {
    read,
    write(value: unknown): StructuralStateWrite {
      try {
        const snapshot = parseStructuralSnapshot(value);
        if (snapshot.parentRevisionId === snapshot.revisionId) throw new Error('A revision cannot be its own parent.');
        const existing = read(snapshot.modelId, snapshot.revisionId);
        if (existing.status === 'error') return existing;
        if (existing.status === 'found') {
          if (JSON.stringify(existing.snapshot) !== JSON.stringify(snapshot)) throw new Error('Revision already exists with different content.');
          return { status: 'unchanged' };
        }
        if (snapshot.parentRevisionId) {
          const parent = read(snapshot.modelId, snapshot.parentRevisionId);
          if (parent.status !== 'found') throw new Error('Parent revision is missing or invalid.');
        }
        storage.setItem(key(snapshot.modelId, snapshot.revisionId), JSON.stringify(snapshot));
        return { status: 'saved' };
      } catch (error) {
        return { status: 'error', message: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
