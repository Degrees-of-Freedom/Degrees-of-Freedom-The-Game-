import { describe, expect, it } from 'vitest';
import { analyzeGame } from './analysis';
import { exampleModel } from './examples';
import { LEVELS } from './levels';
import { memberIssue } from './placementRules';
import { canFound } from './terrain';
import { parseNodeKey, type GameModel } from './model';

// Check the same evaluator and objective result that the challenge workspace uses.
describe('challenge reference structures', () => {
  it.each(['tower1', 'tower2', 'bridge1', 'bridge2', 'pickup1', 'pickup2', 'pickupR'] as const)('%s completes its objectives', async (id) => {
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

it('builds the lake example within placement and supply limits', () => {
  const model = exampleModel('pickup2')!;
  const level = LEVELS.pickup2;
  const partial: GameModel = { members: [], attrs: {}, nextId: 1 };
  for (const [key, attrs] of Object.entries(model.attrs))
    if (attrs.found) expect(canFound(level, parseNodeKey(key)), key).toBe(true);
  expect(Object.values(model.attrs).filter(a => a.found).length).toBeLessThanOrEqual(level.inv!.found!);
  expect(Object.values(model.attrs).filter(a => a.joint).length).toBeLessThanOrEqual(level.inv!.joint!);
  for (const member of model.members) {
    expect(memberIssue(level, partial, parseNodeKey(member.a), parseNodeKey(member.b), member.type), JSON.stringify(member)).toBeNull();
    partial.members.push(member);
  }
});

it('uses a valid reproducible random pickup layout within its supplies', () => {
  const model = exampleModel('pickupR')!;
  const level = LEVELS.pickupR;
  const targets = Object.entries(model.attrs).filter(([, a]) => a.target);
  expect(targets).toHaveLength(3);
  for (const [key, attrs] of targets) {
    const [x, y, z] = parseNodeKey(key);
    expect(x).toBeGreaterThanOrEqual(2); expect(x).toBeLessThanOrEqual(level.nx - 2);
    expect(y).toBeGreaterThanOrEqual(2); expect(y).toBeLessThanOrEqual(level.ny - 2);
    expect(z).toBeGreaterThanOrEqual(2); expect(z).toBeLessThanOrEqual(6);
    expect([20, 30, 40, 50, 60]).toContain(attrs.load);
  }
  for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
    const a = parseNodeKey(targets[i][0]), b = parseNodeKey(targets[j][0]);
    expect(Math.max(...a.map((value, axis) => Math.abs(value - b[axis])))).toBeGreaterThanOrEqual(3);
  }
  const partial: GameModel = { members: [], attrs: {}, nextId: 1 };
  for (const [key, attrs] of Object.entries(model.attrs)) if (attrs.found) expect(canFound(level, parseNodeKey(key)), key).toBe(true);
  expect(Object.values(model.attrs).filter(a => a.found).length).toBeLessThanOrEqual(level.inv!.found!);
  expect(Object.values(model.attrs).filter(a => a.joint).length).toBeLessThanOrEqual(level.inv!.joint!);
  for (const member of model.members) {
    expect(memberIssue(level, partial, parseNodeKey(member.a), parseNodeKey(member.b), member.type), JSON.stringify(member)).toBeNull();
    partial.members.push(member);
  }
});

it.each(['tower1', 'tower2', 'bridge1', 'pickup1'] as const)('%s example respects placement and supply', id => {
  const model = exampleModel(id)!;
  const level = LEVELS[id];
  const partial: GameModel = { members: [], attrs: {}, nextId: 1 };
  for (const [key, attrs] of Object.entries(model.attrs))
    if (attrs.found && !attrs.locked) expect(canFound(level, parseNodeKey(key)), key).toBe(true);
  expect(Object.values(model.attrs).filter(a => a.found && !a.locked).length).toBeLessThanOrEqual(level.inv!.found!);
  expect(Object.values(model.attrs).filter(a => a.joint).length).toBeLessThanOrEqual(level.inv!.joint!);
  for (const member of model.members) {
    expect(memberIssue(level, partial, parseNodeKey(member.a), parseNodeKey(member.b), member.type), JSON.stringify(member)).toBeNull();
    partial.members.push(member);
  }
});
