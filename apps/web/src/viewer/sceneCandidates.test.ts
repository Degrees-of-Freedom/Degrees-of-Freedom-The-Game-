import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { bayEdges } from '../game/bay';
import { nodeKey, CELL_SIZE } from '../game/model';
import { useGameStore } from '../game/store';
import { createTurnGame, projectTurnModel, stageElement } from '../game/turns';
import { pickBayFace, previewBay } from './bayPreview';
import { growthTargets } from './growthTargets';
import { turnConnectionTargets, turnPointIssue } from './turnPicking';

function blankState() {
  return {
    ...useGameStore.getState(),
    mode: 'creative' as const,
    levelId: 'sandbox' as const,
    tool: 'shs' as const,
    workK: 0,
    model: { members: [], attrs: {}, nextId: 1 },
  };
}

describe('scene interaction candidates', () => {
  it('uses the same valid bloom in both growth styles', () => {
    const state = {
      ...blankState(),
      style: 'grow' as const,
      chainStart: '0,0,0',
      model: { members: [{ id: 1, a: '0,0,0', b: '1,0,0', type: 'shs' as const }], attrs: {}, nextId: 2 },
    };
    const targets = growthTargets(state);
    expect(targets).toContainEqual({ key: '0,0,2', point: [0, 0, 2], role: 'column' });
    expect(targets).toContainEqual({ key: '1,0,1', point: [1, 0, 1], role: 'brace' });
    expect(targets.map(({ key }) => key)).not.toContain('1,0,0');
    expect(targets.every(({ point }) => point.every((value) => value >= 0))).toBe(true);
    expect(growthTargets({ ...state, style: 'grow-dusk' })).toEqual(targets);
    expect(growthTargets({ ...state, style: 'levels' })).toEqual([]);
  });

  it('snaps a bay to the working plane and returns the shared validation issue', () => {
    const preview = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
    const state = blankState();
    const hit = previewBay(state, new THREE.Vector3(2.15 * CELL_SIZE, 2.9 * CELL_SIZE, 0), [2, 2, 2], 'shs', preview);
    expect(hit).toMatchObject({ kind: 'bay', p: [2, 2, 0], issue: null });
    expect(preview.geometry.getAttribute('position').count).toBe(24);
    const outOfBounds = previewBay(state, new THREE.Vector3(-0.1, 2.9, 0), [2, 2, 2], 'shs', preview);
    expect(outOfBounds.issue).toMatch(/Outside/);
    preview.geometry.dispose();
    preview.material.dispose();
  });

  it('chooses a volume above the closest visible bay top', () => {
    const state = { ...blankState(), model: {
      members: bayEdges([0, 0, 0], [2, 2, 2]).map(([a, b], i) => ({
        id: i + 1, a: nodeKey(...a), b: nodeKey(...b), type: 'shs' as const,
      })),
      attrs: {}, nextId: 13,
    } };
    const ray = new THREE.Ray(new THREE.Vector3(CELL_SIZE, CELL_SIZE, 20), new THREE.Vector3(0, 0, -1));
    expect(pickBayFace(state, ray, [2, 2, 2])).toEqual([0, 0, 2]);
  });

  it('picks only eligible connection ends and rejects off-board element previews', () => {
    let turn = createTurnGame();
    const player = turn.players[turn.playerIndex];
    player.hand = [
      { kind: 'element', id: 'test-element', label: 'Test', type: 'shs', maxSteps: 3 },
      { kind: 'connection', id: 'test-connection', label: 'Test', profile: 'fixed' },
    ];
    let state = {
      ...blankState(),
      mode: 'multiplayer' as const,
      turn,
      model: projectTurnModel(turn),
      selectedCardId: 'test-element',
      chainStart: '1,3,1',
    };
    expect(turnPointIssue(state, [7, 3, 1])).toMatch(/on the board/);
    expect(turnPointIssue(state, [1, 3, 2])).toBeNull();
    const staged = stageElement(turn, 'test-element', '1,3,1', '1,3,2');
    if (!staged.ok) throw new Error(staged.reason);
    turn = staged.state;
    state = { ...state, turn, model: projectTurnModel(turn), selectedCardId: 'test-connection' };
    expect(turnConnectionTargets(state)).toEqual([
      { memberId: 3, end: 'a', key: '1,3,1' },
      { memberId: 3, end: 'b', key: '1,3,2' },
    ]);
  });
});
