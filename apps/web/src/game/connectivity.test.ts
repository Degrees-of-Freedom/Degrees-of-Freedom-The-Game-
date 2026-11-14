import { describe, expect, it } from 'vitest';
import { analyzeConnectivity } from './connectivity';
import { type GameModel } from './model';
import { activeTurnHand, createTurnGame, projectTurnModel, stageConnection, stageElement } from './turns';

describe('support reachability', () => {
  it('follows shared endpoints, excludes crossings, and reports placed load and length', () => {
    const model: GameModel = {
      nextId: 4,
      members: [
        { id: 1, a: '0,0,0', b: '2,0,0', type: 'shs' },
        { id: 2, a: '2,0,0', b: '2,0,1', type: 'shs' },
        { id: 3, a: '1,0,0', b: '1,0,1', type: 'shs' },
      ],
      attrs: { '0,0,0': { found: true }, '1,0,1': { load: 20 } },
    };
    expect(analyzeConnectivity(model)).toEqual({
      groundedMembers: new Set([1, 2]), unsupportedMembers: [3],
      unsupportedNodes: ['1,0,0', '1,0,1'], memberCount: 3,
      lengthMetres: 8, totalLoadKilonewtons: 20,
    });
  });

  it('requires an explicit member-end connection in Kit', () => {
    let turn = createTurnGame();
    for (let seed = 2; !activeTurnHand(turn).some((card) => card.kind === 'element'); seed++) {
      turn = createTurnGame(seed);
    }
    const element = activeTurnHand(turn).find((card) => card.kind === 'element');
    const connection = activeTurnHand(turn).find((card) => card.kind === 'connection');
    if (!element || !connection) throw new Error('Expected the playtest cards');
    const placed = stageElement(turn, element.id, '1,3,1', '1,3,2');
    if (!placed.ok) throw new Error(placed.reason);
    const id = placed.state.draft.members[0].id;
    expect(analyzeConnectivity(projectTurnModel(placed.state), placed.state).unsupportedMembers).toEqual([id]);
    const attached = stageConnection(placed.state, connection.id, id, 'a');
    if (!attached.ok) throw new Error(attached.reason);
    expect(analyzeConnectivity(projectTurnModel(attached.state), attached.state).unsupportedMembers).toEqual([]);
  });
});
