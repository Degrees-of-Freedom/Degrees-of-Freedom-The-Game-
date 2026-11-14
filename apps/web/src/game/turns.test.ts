import { describe, expect, it } from 'vitest';
import {
  activeTurnHand, cancelTurnDraft, createTurnGame, endTurn, parseTurnState,
  projectTurnModel, stageConnection, stageElement, stageLoad, type TurnState,
} from './turns';

function apply(result: ReturnType<typeof endTurn>): TurnState {
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

describe('Kit turns', () => {
  it('draws two cards from each deck exactly once per turn and preserves passes in replay', () => {
    const first = createTurnGame(23);
    expect(first.players[0].hand).toHaveLength(4);
    expect(activeTurnHand(first).filter((card) => card.kind === 'connection')).toHaveLength(2);
    const second = apply(endTurn(first, 1));
    expect(endTurn(second, 1).ok).toBe(false);
    expect(second.players.map(({ hand }) => hand.length)).toEqual([4, 4]);
    expect(second.reports[0]).toMatchObject({ status: 'unresolved', penalty: 0 });
    expect(parseTurnState(JSON.parse(JSON.stringify(second)))).toEqual(second);
    expect(parseTurnState({ version: second.version, seed: second.seed, events: [{ kind: 'end', turn: 2 }] })).toBeNull();
  });

  it('separates coincident ends from attached joints and retains placements across turns', () => {
    let first = createTurnGame();
    for (let seed = 1; !activeTurnHand(first).some((card) => card.kind === 'element'); seed++) {
      first = createTurnGame(seed);
    }
    const hand = activeTurnHand(first);
    const element = hand.find((card) => card.kind === 'element')!;
    const connectors = hand.filter((card) => card.kind === 'connection');
    const withMember = apply(stageElement(first, element.id, '5,3,1', '5,2,1'));
    const id = withMember.draft.members[0].id;
    expect(withMember.draft.connections).toEqual([]);
    const attached = apply(stageConnection(withMember, connectors[0].id, id, 'a', '5,3,1'));
    expect(stageConnection(attached, connectors[1].id, id, 'a').ok).toBe(false);
    const both = apply(stageConnection(attached, connectors[1].id, id, 'b'));
    expect(cancelTurnDraft(both)).toMatchObject({ ok: true, state: { draft: { members: [], connections: [] } } });
    const committed = apply(endTurn(both));
    expect(committed.board.connections.filter((connection) => connection.memberId === id)).toHaveLength(2);
    expect(projectTurnModel(committed).members.map((member) => member.id)).toContain(id);
    expect(parseTurnState(committed)).toEqual(committed);
  });

  it('allows a persistent downward load on the other player’s shared structure', () => {
    let first = createTurnGame();
    for (let seed = 1; !activeTurnHand(first).some((card) => card.kind === 'load'); seed++) {
      first = createTurnGame(seed);
    }
    const load = activeTurnHand(first).find((card) => card.kind === 'load')!;
    if (load.kind !== 'load') throw new Error('Expected a load card');
    expect(stageLoad(first, load.id, '6,6,6').ok).toBe(false);
    const committed = apply(endTurn(apply(stageLoad(first, load.id, '5,3,1'))));
    expect(projectTurnModel(committed).attrs['5,3,1'].load).toBe(load.magnitude);
    expect(committed.players[0].hand.some((card) => card.id === load.id)).toBe(false);
  });
});
