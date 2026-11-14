import { describe, expect, it } from 'vitest';
import { LEVELS } from './model';
import { exampleModel } from './examples';
import { analyzeGame, autoDesignGame, toVoxelInput } from './analysis';

describe('game analysis boundary', () => {
  it('copies game input and preserves the reference analysis', () => {
    const model = exampleModel('tower1')!;
    const input = toVoxelInput(model, LEVELS.tower1);
    expect(input.model).toEqual(model);
    expect(input.model).not.toBe(model);
    expect(input.model.members[0]).not.toBe(model.members[0]);
    expect(analyzeGame(model, LEVELS.tower1).success).toBe(true);
    expect(autoDesignGame(model, LEVELS.tower1).changed).toBe(true);
  });
});
