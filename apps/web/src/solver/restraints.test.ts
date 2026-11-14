import { describe, expect, it } from 'vitest';
import { analyzeGame } from '../game/analysis';
import { LEVELS } from '../game/levels';
import type { GameModel, LoadDirection } from '../game/model';
import { ITEMS } from './voxelSections';

const level = { ...LEVELS.environment, q0: 0 };
function cantilever(direction: LoadDirection): GameModel {
  return { members: [{ id: 1, a: '1,1,0', b: '1,1,2', type: 'shs' }], nextId: 2,
    attrs: { '1,1,0': { found: true, joint: true }, '1,1,2': { joint: true, load: 10, loadDirection: direction } } };
}

describe('experimental support and load assembly', () => {
  it.each([['+X', 0, 1], ['-Y', 1, -1]] as const)('solves a cantilever with %s tip load and balances its reaction', (direction, axis, sign) => {
    const result = analyzeGame(cantilever(direction), level);
    expect(result.error).toBeUndefined();
    expect(result.mechanism).toBe(false);
    const combo = result.combos[0], ctx = result.ctx!;
    const tip = ctx.aid[ctx.idx.get('1,1,2')!], base = ctx.aid[ctx.idx.get('1,1,0')!];
    const theoretical = 10 * 4 ** 3 / (3 * ITEMS.shs.E * ITEMS.shs.Iy);
    expect(combo.u![tip * 6 + axis]).toBeCloseTo(sign * theoretical, 5);
    expect(combo.reac![base][axis]).toBeCloseTo(-sign * 10, 6);
    expect(result.designChecksAvailable).toBe(false);
    expect(result.maxU).toBeUndefined();
    expect(result.alphaMin).toBeUndefined();
    expect(result.objectives.some((o) => /buckling|capacity|design checks|Connections OK|Foundations OK/i.test(o.label))).toBe(false);
    expect(result.success).toBe(false);
  });
  it('applies a pinned support mask and reports reactions only on locked axes', () => {
    const model = cantilever('-Z');
    model.attrs['1,1,2'].found = true;
    model.attrs['1,1,2'].restraint = [true, true, true, false, false, false];
    const result = analyzeGame(model, level);
    expect(result.mechanism).toBe(false);
    const ctx = result.ctx!, tip = ctx.aid[ctx.idx.get('1,1,2')!], combo = result.combos[0];
    expect(combo.reac![tip][2]).toBeGreaterThan(0);
    expect([...combo.reac![tip].slice(3)]).toEqual([0, 0, 0]);
  });
  it('uses only the roller vertical restraint and preserves horizontal movement', () => {
    const model = cantilever('+X');
    model.attrs['1,1,2'].found = true;
    model.attrs['1,1,2'].restraint = [false, false, true, false, false, false];
    const result = analyzeGame(model, level), ctx = result.ctx!;
    const tip = ctx.aid[ctx.idx.get('1,1,2')!], combo = result.combos[0];
    expect(result.mechanism).toBe(false);
    expect(combo.u![tip * 6]).toBeGreaterThan(0);
    expect(combo.u![tip * 6 + 2]).toBe(0);
    expect(combo.reac![tip][0]).toBe(0);
  });
  it('reports a free ungrounded structure instead of a fabricated stable result', () => {
    const model = cantilever('+X');
    delete model.attrs['1,1,0'].found;
    const result = analyzeGame(model, level);
    expect(result.error).toMatch(/No foundation/);
  });
});
