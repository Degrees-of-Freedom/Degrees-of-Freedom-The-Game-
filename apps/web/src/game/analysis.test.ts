import { describe, expect, it } from 'vitest';
import { LEVELS } from './levels';
import { exampleModel } from './examples';
import { analyzeGame, autoDesignGame, toEvaluatorInput } from './analysis';

describe('game analysis boundary', () => {
  it('copies game input and preserves the reference analysis', async () => {
    const model = exampleModel('tower1')!;
    const input = toEvaluatorInput(model, LEVELS.tower1);
    expect(input.model).toEqual(model);
    expect(input.model).not.toBe(model);
    expect(input.model.members[0]).not.toBe(model.members[0]);
    expect((await analyzeGame(model, LEVELS.tower1)).success).toBe(true);
    expect((await autoDesignGame(model, LEVELS.tower1)).changed).toBe(true);
  });
});

it('passes the pick-up reference and checks all target weights', async () => {
  const model = exampleModel('pickup1')!;
  const result = await analyzeGame(model, LEVELS.pickup1);
  expect(result.error).toBeUndefined();
  expect(result.success).toBe(true);
  expect(
    result.objectives.find((o) => o.label.startsWith('Pick up all weights'))
      ?.label,
  ).toBe('Pick up all weights (3/3)');
  expect(
    result.objectives.find((o) => o.label.startsWith('Weights move'))?.ok,
  ).toBe(true);
});

it('reports a disconnected target separately from floating structure', async () => {
  const model = exampleModel('pickup1')!;
  model.attrs['10,10,3'] = { load: 40, locked: true, target: true };
  const result = await analyzeGame(model, LEVELS.pickup1);
  const target = result.objectives.find((o) =>
    o.label.startsWith('Pick up all weights'),
  )!;
  expect(target.ok).toBe(false);
  expect(target.label).toBe('Pick up all weights (3/4)');
  expect(
    result.objectives.find(
      (o) => o.label === 'All parts connected to a foundation',
    )?.ok,
  ).toBe(true);
});
