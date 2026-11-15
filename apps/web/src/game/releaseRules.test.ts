import { describe, expect, it } from 'vitest';
import { connectionChoices, createReleaseDecks, RELEASE_CATALOGUE, resolveCardDefinition } from './cardCatalogue';
import { activeTurnHand, boardLimits, cancelTurnDraft, createTurnGame, endTurn, parseTurnState, stageConnection, stageElement, stageLoad, type TurnCard, type TurnState } from './turns';
import { analysisLoadJoint, loadTargets, turnJoints } from './turnPorts';

function accept(result: ReturnType<typeof stageElement>) {
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

function piece(kind: TurnCard['kind'], predicate: (card: TurnCard) => boolean = () => true) {
  return createReleaseDecks().flat().find(card => card.kind === kind && predicate(card))!;
}

/** Placement fixtures specify exact printings. Deterministic draw/replay uses
 * genuine dealt hands separately. */
function fixture(...cards: TurnCard[]) {
  const state = createTurnGame(41, RELEASE_CATALOGUE);
  state.players[0].hand = cards;
  return state;
}
const frame = piece('element', c => c.kind === 'element' && c.maxSteps === 5 && c.type === 'heb');
const load = piece('load'), fixed = piece('connection', c => c.kind === 'connection' && c.profile === 'fixed');
const xy = piece('connection', c => c.kind === 'connection' && c.rotationsToLock === 2);
const place = (turn: TurnState, a: string, b: string) => accept(stageElement(turn, frame.id, a, b));

describe('grow-dusk-release-1 rules', () => {
  it('freezes both finite manifests, SI properties, reach distribution and replayable independent draws', () => {
    const [first, second] = createReleaseDecks();
    expect(first).toHaveLength(48);
    expect(second).toHaveLength(48);
    expect(new Set([...first,...second].map(card => card.id)).size).toBe(96);
    for (const {id: _, ...card} of [...first, ...second]) {
      expect(resolveCardDefinition(card.definitionId, card.definitionVersion)).toEqual(card);
    }
    for (const [key, wanted] of [['heb',[5,5,5,5,7,7,7,7,10,10,10,10]],['cable',[5,5,7,10]],
        [12_500,[5,5,7,10]],[25_000,[5,5,7,10]]] as const) {
      expect(first.flatMap(c => c.kind === 'element' && (c.springStiffnessNPerM ?? c.type) === key ? [c.maxSteps] : [])).toEqual(wanted);
    }
    for (const [weight, count] of [[5,12],[10,8],[20,4]]) expect(first.filter(c => c.kind === 'load' && c.magnitude === weight)).toHaveLength(count);
    for (const [axes, count] of [[1,8],[2,8],[3,32]]) expect(second.filter(c => c.kind === 'connection' && c.rotationsToLock === axes)).toHaveLength(count);
    for (let seed = 0; seed < 20; ++seed) {
      const state = createTurnGame(seed, RELEASE_CATALOGUE);
      expect(state.players.map(p => p.hand.length)).toEqual([4,0]);
      expect(state.decks.map(d => d.length)).toEqual([46,46]);
      expect(state.board.members.map(m => [m.a,m.b,m.type])).toEqual([['5,7,0','5,7,1','heb'],['10,7,0','10,7,1','heb']]);
      expect(boardLimits(state)).toEqual([15,15,12]);
      expect(parseTurnState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    }
    expect(createTurnGame(42, RELEASE_CATALOGUE).decks).not.toEqual(createTurnGame(43, RELEASE_CATALOGUE).decks);
  });

  it('allows exact Euclidean and diagonal spans including isolated placements up to the board edge', () => {
    const state = fixture(frame);
    expect(place(state, '12,11,12', '15,15,12').draft.members[0].type).toBe('heb');
    expect(stageElement(state, frame.id, '0,0,0', '4,4,0').ok).toBe(false);
    expect(stageElement(state, frame.id, '15,15,12', '16,15,12').ok).toBe(false);
    expect(stageElement(state, frame.id, '15,15,12', '15,15,13').ok).toBe(false);
    expect(stageElement(state, frame.id, '5,7,0', '5,7,1').ok).toBe(false);
    const cable = piece('element', c => c.kind === 'element' && c.type === 'cable');
    const spring = piece('element', c => c.kind === 'element' && c.springStiffnessNPerM === 25_000);
    const geometry = (card: TurnCard) => accept(stageElement(fixture(card), card.id,'10,11,1','13,15,1')).draft.members[0];
    expect(geometry(cable).restLengthM).toBe(10);
    expect(geometry(spring).springStiffnessNPerM).toBe(25_000);
  });

  it('offers occupied and loose player tips and original quarters without merging coincident geometry', () => {
    const state = fixture(frame, load, fixed);
    expect(loadTargets(state)).toEqual([]);
    expect(stageLoad(state, load.id, '5,7,1').ok).toBe(false);
    const placed = place(state, '5,7,1', '8,7,1');
    expect(loadTargets(placed).map(t => [t.id,t.point])).toContainEqual(['port:3:1','5.75,7,1']);
    const loose = accept(stageLoad(placed, load.id, 'endpoint:3:a'));
    expect(analysisLoadJoint(loose,'endpoint:3:a')).toBe('endpoint:3:a');
    expect(turnJoints(loose)).toContainEqual({id:'endpoint:3:a',point:'5,7,1'});
    expect(stageConnection(loose, fixed.id, 3,'a').ok).toBe(false);
    const attached = accept(stageConnection(placed, fixed.id, 3,'a'));
    expect(loadTargets(attached).map(t => t.id)).not.toContain('endpoint:3:a');
    expect(stageLoad(attached, load.id, 'endpoint:3:a').ok).toBe(false);
    const loaded = accept(stageLoad(attached, load.id, 'port:3:1'));
    expect(turnJoints(loaded)).toContainEqual({id:'port:3:1', point:'5.75,7,1'});
    expect(accept(cancelTurnDraft(loaded))).toEqual(state);
    const ground = place(state, '13,14,0', '14,14,0');
    expect(loadTargets(ground)).toEqual([]);
  });

  it('requires the selected axis count, pins the oriented law, and keeps placed connections immutable', () => {
    if (xy.kind !== 'connection') throw Error('Wrong printing');
    const placed = place(fixture(frame,xy,fixed),'5,7,1','8,7,1');
    expect(connectionChoices(xy)).toEqual(['lock-xy','lock-xz','lock-yz']);
    expect(stageConnection(placed,xy.id,3,'a',undefined,'lock-xy').ok).toBe(false);
    expect(stageConnection(placed,xy.id,3,'b').ok).toBe(false);
    expect(stageConnection(placed,xy.id,3,'b',undefined,'lock-x').ok).toBe(false);
    const joined = accept(stageConnection(placed,xy.id,3,'b',undefined,'lock-yz'));
    expect(joined.draft.connections[0].profile).toBe('lock-yz');
    expect(stageConnection(joined,fixed.id,3,'b').ok).toBe(false);
  });

  it('replays an accepted draft and rejects contradictory private state and incomplete turn evidence', () => {
    let state = createTurnGame(1, RELEASE_CATALOGUE);
    while (!activeTurnHand(state).some(c => c.kind === 'element')) state = createTurnGame(state.seed + 1, RELEASE_CATALOGUE);
    const card = activeTurnHand(state).find(c => c.kind === 'element')!;
    const staged = accept(stageElement(state, card.id, '5,7,1', '6,7,1'));
    expect(parseTurnState(JSON.parse(JSON.stringify(staged)))).toEqual(staged);
    expect(parseTurnState({...staged, decks: [[],[]]})).toBeNull();
    const changed = structuredClone(staged);
    changed.draft.members[0].owner = 'player-2';
    expect(endTurn(changed).ok).toBe(false);
    expect(parseTurnState({...state, events:[{kind:'end',turn:1,status:'stable'}]})).toBeNull();
  });
});
