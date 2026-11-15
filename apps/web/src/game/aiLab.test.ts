import { describe, expect, it } from 'vitest';
import { candidates, finishDemoTurn, newModel, selectCandidate, train } from './aiLab';
import { createTurnGame, parseTurnState } from './turns';

describe('AI turn lab', () => {
  it('generates replayable turns without changing the original state', () => {
    const initial = createTurnGame(1);
    const options = candidates(initial);
    expect(options.length).toBeGreaterThan(0);
    expect(initial.events).toHaveLength(0);
    const committed = finishDemoTurn(options[0].state);
    expect(committed.turn).toBe(2);
    expect(parseTurnState(committed)).toEqual(committed);
  });
  it('trains reproducibly and predicts the proxy reward', () => {
    const trained = train(newModel(), 12, 4);
    expect(trained).toEqual(train(newModel(), 12, 4));
    expect(trained.examples).toBeGreaterThan(0);
    const options = candidates(createTurnGame(25));
    const errors = options.map(o => Math.abs(o.reward - o.features.reduce((sum, f, i) => sum + f * trained.weights[i], 0)));
    expect(Math.max(...errors)).toBeLessThan(0.5);
  });
  it('uses skill exploration and handles no moves', () => {
    const options = candidates(createTurnGame(1));
    const model = train(newModel(), 4);
    expect(selectCandidate([], model, 'advanced')).toBeUndefined();
    expect(selectCandidate(options, model, 'beginner', () => 0)).toBe(options[0]);
    const best = selectCandidate(options, model, 'advanced', () => 0.99)!;
    const score = (features: number[]) => features.reduce((s, f, i) => s + f * model.weights[i], 0);
    expect(score(best.features)).toBe(Math.max(...options.map(o => score(o.features))));
  });
});
