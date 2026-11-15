import { describe, expect, it } from 'vitest';
import { analyzeGame } from './analysis';
import { exampleModel } from './examples';
import { LEVELS } from './levels';
import { memberIssue } from './placementRules';
import { canFound } from './terrain';
import { parseNodeKey, type GameModel } from './model';

// Check the same evaluator and objective result that the challenge workspace uses.
describe('challenge reference structures', () => {
  it.each(['tower1', 'tower2', 'bridge1', 'bridge2', 'pickup1'] as const)('%s completes its objectives', async (id) => {
    const model = exampleModel(id);
    expect(model).not.toBeNull();
    const result = await analyzeGame(model!, LEVELS[id]);
    expect(result.error).toBeUndefined();
    expect(result.unresolved).toBeFalsy();
    expect(result.success, JSON.stringify(result.objectives.filter(objective => !objective.ok))).toBe(true);
  }, 120000);
});

it('builds the gorge example within placement and supply limits', () => {
  const model = exampleModel('bridge2')!;
  const level = LEVELS.bridge2;
  const partial: GameModel = { members: [], attrs: {}, nextId: 1 };
  for (const [key, attrs] of Object.entries(model.attrs)) {
    if (attrs.found && !attrs.locked) expect(canFound(level, parseNodeKey(key)), key).toBe(true);
  }
  expect(Object.values(model.attrs).filter(a => a.found && !a.locked)).toHaveLength(4);
  expect(Object.values(model.attrs).filter(a => a.joint)).toHaveLength(16);
  for (const member of model.members) {
    expect(memberIssue(level, partial, parseNodeKey(member.a), parseNodeKey(member.b), member.type), JSON.stringify(member)).toBeNull();
    partial.members.push(member);
  }
});
