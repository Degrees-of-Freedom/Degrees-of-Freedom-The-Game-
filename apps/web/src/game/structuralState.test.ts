import { describe, expect, it } from 'vitest';
import { LEVELS } from './levels';
import { toVoxelInput } from './analysis';
import { createStateService } from './persistence';
import { createVoxelAnalysisSnapshot, recomposeVoxelAnalysis } from './structuralState';
import { analyzeVoxel } from '../solver/voxel/analyze';
import type { GameModel } from './model';

const model: GameModel = { members: [{ id: 1, a: '0,0,0', b: '0,0,1', type: 'shs' }], attrs: { '0,0,0': { found: true }, '0,0,1': { load: 50 } }, nextId: 2 };
function storage() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
describe('structural state', () => {
  it('migrates a valid legacy save on the next write and isolates the returned model', () => {
    const db = storage(); db.setItem('voxstruct:sandbox', JSON.stringify(model));
    const service = createStateService(db);
    const loaded = service.load('sandbox');
    expect(loaded.status).toBe('found');
    if (loaded.status !== 'found') throw new Error('missing');
    expect(loaded.migrated).toBe(true);
    loaded.model.members[0].a = '1,1,1';
    expect(JSON.parse(db.getItem('voxstruct:sandbox')!).members[0].a).toBe('0,0,0');
    expect(service.save('sandbox', model)).toEqual({ ok: true });
    expect(JSON.parse(db.getItem('voxstruct:sandbox')!)).toMatchObject({ format: 'dof-voxel-save', version: 1, levelId: 'sandbox' });
    expect(service.load('sandbox')).toMatchObject({ status: 'found', migrated: false, model });
  });
  it('protects unknown, malformed, mismatched and corrupt saves from overwrite', () => {
    for (const raw of ['bad json', JSON.stringify({ format: 'dof-voxel-save', version: 2 }), JSON.stringify({ format: 'dof-voxel-save', version: 1, levelId: 'tower1', model }), JSON.stringify({ ...model, nextId: 1 })]) {
      const db = storage(); db.setItem('voxstruct:sandbox', raw); const service = createStateService(db);
      expect(service.load('sandbox').status).toBe('error');
      expect(service.save('sandbox', model).ok).toBe(false);
      expect(db.getItem('voxstruct:sandbox')).toBe(raw);
    }
  });
  it('round trips solver input and rejects changed profiles or invalid data', () => {
    const input = toVoxelInput(model, LEVELS.sandbox);
    const snapshot = createVoxelAnalysisSnapshot(input.model, input.level);
    const decoded = JSON.parse(JSON.stringify(snapshot));
    const restored = recomposeVoxelAnalysis(decoded);
    expect(restored).toEqual(input);
    expect(analyzeVoxel(restored.model, restored.level).mechanism).toBe(analyzeVoxel(input.model, input.level).mechanism);
    expect(() => recomposeVoxelAnalysis({ ...decoded, solverProfile: 'other' })).toThrow('different voxel solver profile');
    expect(() => recomposeVoxelAnalysis({ ...decoded, extra: 1 })).toThrow();
    expect(() => createVoxelAnalysisSnapshot({ ...model, members: [{ ...model.members[0], a: '0,0,0', b: '0,0,0' }] }, input.level)).toThrow();
  });
  it('reports storage failures without throwing', () => {
    const service = createStateService({ getItem: () => { throw new Error('denied'); }, setItem: () => {} });
    expect(service.load('sandbox')).toMatchObject({ status: 'error' });
    expect(service.save('sandbox', model)).toMatchObject({ ok: false });
  });
});
