import { describe, expect, it } from 'vitest';
import { bayEdges, bayIssue } from './bay';
import { LEVELS } from './levels';
import { modeProgress, modeSetup } from './modes';
import { useGameStore } from './store';

describe('shared editor runtime', () => {
  it('validates a whole bay before committing it and undoes and redoes it atomically', () => {
    const store = useGameStore.getState();
    store.setLevel('sandbox');
    store.reset();
    expect(bayEdges([0, 0, 0], [1, 1, 1])).toHaveLength(12);
    expect(bayIssue(LEVELS.sandbox, useGameStore.getState().model, [0, 0, 0], [1, 1, 1], 'shs')).toBeNull();
    expect(store.addBay([0, 0, 0], [1, 1, 1], 'shs')).toBeNull();
    expect(useGameStore.getState().model.members).toHaveLength(12);
    expect(store.addBay([0, 0, 0], [1, 1, 1], 'shs')).not.toBeNull();
    expect(useGameStore.getState().model.members).toHaveLength(12);
    store.undo();
    expect(useGameStore.getState().model.members).toHaveLength(0);
    store.redo();
    expect(useGameStore.getState().model.members).toHaveLength(12);
  });
  it('rejects invalid imports without changing the model', () => {
    const state = useGameStore.getState(), before = state.model;
    expect(state.importModel({ format: 'dof-voxel-save', version: 999 })).not.toBeNull();
    expect(useGameStore.getState().model).toBe(before);
    expect(state.importModel(state.exportModel())).toBeNull();
  });
  it('creates a pickup fixture and does not call an unavailable analysis complete', () => {
    expect(modeSetup('load-space').model.attrs['4,4,3']?.target).toBe(true);
    const result = { error: 'No result', mechanism: false, floating: [], unstable: new Set<string>(), members: {}, nodes: {}, found: {}, objectives: [], combos: [] };
    expect(modeProgress('forensics', result)).toBe('unavailable');
  });
});
