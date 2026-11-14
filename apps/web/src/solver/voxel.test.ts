import { describe, expect, it } from 'vitest';
import { LEVELS, type GameModel } from '../game/model';
import { analyzeVoxel, autoDesignVoxel } from './voxel.js';
import { exampleModel } from '../game/examples';

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

describe('reference structures and auto-design', () => {
  it.each(['tower1', 'bridge1'] as const)('%s passes the prototype objectives', (id) => {
    const result = analyzeVoxel(exampleModel(id)!, LEVELS[id]);
    expect(result.error).toBeUndefined();
    expect(result.mechanism).toBe(false);
    expect(result.objectives.filter(objective => !objective.ok)).toEqual([]);
    expect(result.success).toBe(true);
  });
  it('resizes without mutating the input and honours supply', () => {
    const input = exampleModel('tower1')!;
    const before = structuredClone(input);
    const result = autoDesignVoxel(input, LEVELS.tower1);
    expect(input).toEqual(before);
    expect(result.changed).toBe(true);
    expect(result.analysis.error).toBeUndefined();
    for (const type of ['shs', 'glulam', 'ipe', 'heb'] as const) {
      expect(result.model.members.filter(member => member.type === type).length).toBeLessThanOrEqual(LEVELS.tower1.inv![type] ?? 0);
    }
  });
  it('leaves an invalid model unchanged', () => {
    const input: GameModel = { members: [], attrs: {}, nextId: 1 };
    const result = autoDesignVoxel(input, LEVELS.sandbox);
    expect(result.changed).toBe(false);
    expect(result.model).toEqual(input);
    expect(result.analysis.error).toBe('Nothing built yet.');
  });
});

