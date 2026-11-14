import { describe, expect, it } from 'vitest';
import { LEVELS, type GameModel } from '../game/model';
import { analyzeVoxel } from './voxel.js';

describe('prototype voxel analysis', () => {
  it('reports an empty model without attempting a solve', () => {
    expect(analyzeVoxel({ members: [], attrs: {}, nextId: 1 }, LEVELS.sandbox).error).toBe('Nothing built yet.');
  });
  it('requires a foundation', () => {
    const model: GameModel = { members: [{ id: 1, a: '0,0,0', b: '0,0,1', type: 'ipe' }], attrs: {}, nextId: 2 };
    expect(analyzeVoxel(model, LEVELS.sandbox).error).toMatch(/No foundation/);
  });
  it('analyses a supported member and reports disconnected parts', () => {
    const model: GameModel = {
      members: [{ id: 1, a: '0,0,0', b: '1,0,0', type: 'ipe' }, { id: 2, a: '3,0,0', b: '3,0,1', type: 'shs' }],
      attrs: { '0,0,0': { found: true }, '1,0,0': { found: true } }, nextId: 3,
    };
    const result = analyzeVoxel(model, LEVELS.sandbox);
    expect(result.error).toBeUndefined();
    expect(result.mechanism).toBe(false);
    expect(result.floating).toEqual(['3,0,0', '3,0,1']);
    expect(result.members[1]).toBeDefined();
    expect(result.members[2]).toBeUndefined();
    expect(result.objectives[0].ok).toBe(false);
  });
});
