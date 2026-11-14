import { describe, expect, it } from 'vitest';
import { LEVELS } from '../game/levels';
import { type GameModel } from '../game/model';
import { analyzeVoxel } from './voxel';
import { autoDesignVoxel } from './voxelSizing';
import { exampleModel } from '../game/examples';

describe('prototype voxel analysis', () => {
  it('reports an empty model without attempting a solve', () => {
    expect(
      analyzeVoxel({ members: [], attrs: {}, nextId: 1 }, LEVELS.sandbox).error,
    ).toBe('Nothing built yet.');
  });
  it('requires a foundation', () => {
    const model: GameModel = {
      members: [{ id: 1, a: '0,0,0', b: '0,0,1', type: 'ipe' }],
      attrs: {},
      nextId: 2,
    };
    expect(analyzeVoxel(model, LEVELS.sandbox).error).toMatch(/No foundation/);
  });
  it('analyses a supported member and reports disconnected parts', () => {
    const model: GameModel = {
      members: [
        { id: 1, a: '0,0,0', b: '1,0,0', type: 'ipe' },
        { id: 2, a: '3,0,0', b: '3,0,1', type: 'shs' },
      ],
      attrs: { '0,0,0': { found: true }, '1,0,0': { found: true } },
      nextId: 3,
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
  it.each(['tower1', 'bridge1'] as const)(
    '%s passes the prototype objectives',
    (id) => {
      const result = analyzeVoxel(exampleModel(id)!, LEVELS[id]);
      expect(result.error).toBeUndefined();
      expect(result.mechanism).toBe(false);
      expect(result.objectives.filter((objective) => !objective.ok)).toEqual(
        [],
      );
      expect(result.success).toBe(true);
    },
  );
  it('resizes without mutating the input and honours supply', () => {
    const input = exampleModel('tower1')!;
    const before = structuredClone(input);
    const result = autoDesignVoxel(input, LEVELS.tower1);
    expect(input).toEqual(before);
    expect(result.changed).toBe(true);
    expect(result.analysis.error).toBeUndefined();
    for (const type of ['shs', 'glulam', 'ipe', 'heb'] as const) {
      expect(
        result.model.members.filter((member) => member.type === type).length,
      ).toBeLessThanOrEqual(LEVELS.tower1.inv![type] ?? 0);
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

describe('prototype equilibrium', () => {
  it.each(['tower1', 'bridge1'] as const)(
    '%s balances applied forces at supports for each load combination',
    (id) => {
      const result = analyzeVoxel(exampleModel(id)!, LEVELS[id]);
      for (const combo of result.combos as {
        F: Float64Array;
        reac: Record<string, Float64Array>;
      }[]) {
        for (let axis = 0; axis < 3; axis++) {
          let applied = 0;
          for (let i = axis; i < combo.F.length; i += 6) applied += combo.F[i];
          const reaction = Object.values(combo.reac).reduce(
            (sum, force) => sum + force[axis],
            0,
          );
          expect(Math.abs(applied + reaction)).toBeLessThan(
            Math.max(1e-4, Math.abs(applied) * 1e-5),
          );
        }
      }
    },
  );
});

it('matches the axial displacement of a fixed-base vertical member under SLS load', () => {
  const model: GameModel = {
    members: [{ id: 1, a: '0,0,0', b: '0,0,1', type: 'ipe' }],
    attrs: {
      '0,0,0': { found: true, joint: true },
      '0,0,1': { joint: true, load: 50 },
    },
    nextId: 2,
  };
  const result = analyzeVoxel(model, { ...LEVELS.sandbox, q0: 0 });
  expect(result.mechanism).toBe(false);
  const sls = result.combos[2] as { u: Float64Array };
  // PL/EA, including half of the 0.422 kN/m self-weight lumped at the tip.
  const expected = (-(50 + 0.422) * 2) / (210e6 * 0.00538);
  expect(sls.u[8]).toBeCloseTo(expected, 10);
});
