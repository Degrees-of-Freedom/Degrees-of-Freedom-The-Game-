import { describe, expect, it } from 'vitest';
import { useGameStore } from './store';
import { unavailableSolver } from '../solver/unavailable';
describe('foundation', () => {
  it('resets to an empty model', () => { useGameStore.getState().reset(); expect(useGameStore.getState().model.nodes).toEqual([]); });
  it('reports analysis as unavailable', async () => { expect((await unavailableSolver.analyze(useGameStore.getState().model)).status).toBe('unsupported'); });
});
