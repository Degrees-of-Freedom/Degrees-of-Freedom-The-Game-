import { describe, expect, it } from 'vitest';
import { bayEdges, bayIssue } from './bay';
import { LEVELS } from './levels';
import { modeProgress, modeSetup } from './modes';
import { useGameStore } from './store';
import { readSession, writeSession } from './session';
import { createTurnGame } from './turns';
import { analyzeVoxel } from '../solver/voxel';

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
    expect(store.addBay([1, 0, 0], [1, 1, 1], 'shs')).toBeNull();
    expect(useGameStore.getState().model.members).toHaveLength(20);
    store.undo();
    expect(useGameStore.getState().model.members).toHaveLength(12);
    store.redo();
    expect(useGameStore.getState().model.members).toHaveLength(20);
  });
  it('replays the turn log and preserves malformed session data', () => {
    const entries = new Map<string, string>();
    const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } } as Storage;
    expect(writeSession(storage, { mode: 'multiplayer', style: 'kit', turn: createTurnGame(17) })).toBe(true);
    const restored = readSession(storage);
    expect(restored.status).toBe('found');
    if (restored.status === 'found') expect(restored.session.turn?.seed).toBe(17);
    entries.set('dof-runtime:session', '{broken');
    expect(writeSession(storage, { mode: 'challenge', style: 'engineering', turn: null })).toBe(false);
    expect(entries.get('dof-runtime:session')).toBe('{broken');
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
  it('detects and repairs the disconnected forensics fixture with the experimental solver', () => {
    const { model, levelId } = modeSetup('forensics');
    const before = analyzeVoxel(model, LEVELS[levelId]);
    expect(modeProgress('forensics', before)).toBe('incomplete');
    const repaired = { ...model, members: [...model.members, { id: model.nextId, a: '2,4,3', b: '4,4,3', type: 'shs' as const }], nextId: model.nextId + 1 };
    const after = analyzeVoxel(repaired, LEVELS[levelId]);
    expect({ mechanism: after.mechanism, floating: after.floating, error: after.error }).toEqual({ mechanism: false, floating: [], error: undefined });
    expect(modeProgress('forensics', after)).toBe('complete');
  });
});
