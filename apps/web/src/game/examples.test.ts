import { describe, expect, it } from 'vitest';
import { analyzeGame } from './analysis';
import { exampleModel } from './examples';
import { LEVELS } from './levels';

// Check the same evaluator and objective result that the challenge workspace uses.
describe('challenge reference structures', () => {
  it.each(['tower1', 'bridge1', 'pickup1'] as const)('%s completes its objectives', async (id) => {
    const model = exampleModel(id);
    expect(model).not.toBeNull();
    const result = await analyzeGame(model!, LEVELS[id]);
    expect(result.error).toBeUndefined();
    expect(result.unresolved).toBeFalsy();
    expect(result.success, JSON.stringify(result.objectives.filter(objective => !objective.ok))).toBe(true);
  }, 120000);
});
