import { describe, expect, it } from 'vitest';
import { analyzeGame } from './analysis';
import { LEVELS } from './levels';
import { createGameSave, readGameSave } from './structuralState';
import { useGameStore } from './store';

describe('creative restraints and loads', () => {
  it('round-trips editable restraints and directional loads without pretending the solver supports them', () => {
    const game = useGameStore.getState();
    game.setMode('creative');
    game.reset();
    expect(game.addMember([1, 1, 0], [1, 1, 2], 'shs')).toBeNull();
    expect(game.setNodeRestraint('1,1,0', [true, true, true, false, false, false])).toBeNull();
    game.setLoadBrush(20, '+X');
    expect(game.toggleAttr([1, 1, 2], 'load')).toBeNull();
    expect(useGameStore.getState().model.attrs['1,1,2']).toMatchObject({ load: 20, loadDirection: '+X' });
    const model = useGameStore.getState().model;
    const save = createGameSave('environment', model);
    expect(readGameSave(JSON.parse(JSON.stringify(save)), 'environment').save.model).toEqual(model);
    expect(() => analyzeGame(model, LEVELS.environment)).toThrow(/partial restraints/);
    expect(game.setNodeRestraint('1,1,0', [true, true, true, true, true, true])).toBeNull();
    expect(() => analyzeGame(useGameStore.getState().model, LEVELS.environment)).toThrow(/directional point loads/);
    expect(game.setNodeLoadDirection('1,1,2', '-Z')).toBeNull();
    expect(() => analyzeGame(useGameStore.getState().model, LEVELS.environment)).not.toThrow();
    game.setMode('challenge');
  });
  it('rejects malformed saved restraint and direction values', () => {
    const save = { format: 'dof-voxel-save', version: 1, levelId: 'sandbox', model: { members: [], nextId: 1, attrs: { '0,0,0': { found: true, restraint: [true] } } } };
    expect(() => readGameSave(save, 'sandbox')).toThrow();
  });
});
