import { type LevelId, type GameModel } from './model';
import { LEVELS } from './levels';
import { initialModel } from './layout';
import { createGameSave, readGameSave } from './structuralState';

export interface StateStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export type LoadResult =
  | { status: 'found'; model: GameModel; migrated: boolean }
  | { status: 'missing' }
  | { status: 'error'; message: string };

/** Per-level saves; invalid or future-version data is never overwritten. */
export function createStateService(storage: StateStorage) {
  const key = (id: LevelId) => 'voxstruct:' + id;
  return {
    load(id: LevelId): LoadResult {
      try {
        const raw = storage.getItem(key(id));
        if (raw === null) return { status: 'missing' };
        const { save, migrated } = readGameSave(JSON.parse(raw), id);
        return { status: 'found', model: save.model, migrated };
      } catch (error) {
        return { status: 'error', message: error instanceof Error ? error.message : String(error) };
      }
    },
    save(id: LevelId, model: GameModel): { ok: true } | { ok: false; message: string } {
      try {
        const raw = storage.getItem(key(id));
        if (raw !== null) readGameSave(JSON.parse(raw), id);
        const save = createGameSave(id, model);
        storage.setItem(key(id), JSON.stringify(save));
        return { ok: true };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

// Existing game API: storage remains optional. Explicit service callers can report errors.
export function save(id: LevelId, model: GameModel) {
  try { return createStateService(localStorage).save(id, model); }
  catch (error) { return { ok: false as const, message: String(error) }; }
}
export function savedLevel(): LevelId {
  try {
    const id = localStorage.getItem('voxstruct:level');
    if (id && Object.hasOwn(LEVELS, id)) return id as LevelId;
  } catch { /* use default */ }
  return 'tower1';
}
export function loadWithStatus(id: LevelId): { model: GameModel; error: string | null } {
  try {
    const result = createStateService(localStorage).load(id);
    if (result.status === 'found') return { model: result.model, error: null };
    if (result.status === 'error') return { model: initialModel(LEVELS[id]), error: 'Saved state could not be read; existing data was preserved.' };
  } catch { return { model: initialModel(LEVELS[id]), error: 'Browser storage is unavailable.' }; }
  return { model: initialModel(LEVELS[id]), error: null };
}
export function load(id: LevelId): GameModel { return loadWithStatus(id).model; }
export function saveLevel(levelId: LevelId) {
  try { localStorage.setItem('voxstruct:level', levelId); }
  catch { /* optional persistence */ }
}
