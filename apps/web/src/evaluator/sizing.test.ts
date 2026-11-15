import { describe, expect, it } from 'vitest';
import { LEVELS } from '../game/levels';
import type { GameModel } from '../game/model';
import { exampleModel } from '../game/examples';
import { analyzeGame, autoDesignGame } from '../game/analysis';

describe('auto-design on the Rust engine', () => {
  it('resizes without mutating the input, honours supply and stays successful', async () => {
    const input = exampleModel('tower1')!;
    const before = structuredClone(input);
    const result = await autoDesignGame(input, LEVELS.tower1);
    expect(input).toEqual(before);
    expect(result.changed).toBe(true);
    expect(result.analysis.error).toBeUndefined();
    for (const type of ['shs', 'glulam', 'ipe', 'heb'] as const) {
      expect(
        result.model.members.filter((member) => member.type === type).length,
      ).toBeLessThanOrEqual(LEVELS.tower1.inv![type] ?? 0);
    }
    // The returned analysis is the evaluation of the resized model.
    const again = await analyzeGame(result.model as GameModel, LEVELS.tower1);
    expect(again.maxU).toBeCloseTo(result.analysis.maxU!, 9);
    expect(result.analysis.success).toBe(true);
  });
  it('leaves an invalid model unchanged', async () => {
    const input: GameModel = { members: [], attrs: {}, nextId: 1 };
    const result = await autoDesignGame(input, LEVELS.sandbox);
    expect(result.changed).toBe(false);
    expect(result.model).toEqual(input);
    expect(result.analysis.error).toBe('Nothing built yet.');
  });
});
