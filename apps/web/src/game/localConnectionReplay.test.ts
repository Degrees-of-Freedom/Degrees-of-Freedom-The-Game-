import {expect, it} from 'vitest';
import {connectionChoices} from './cardCatalogue';
import {memberConnectionFrame, connectionFrameFor} from './jointFreedom';
import {createReleaseGame, chooseTurnDraw, activeTurnHand, stageElement, stageConnection,
  endTurn, editDraftMember, undoLastPlacement, cancelTurnDraft, changeCheckpointInterval,
  parseTurnState, type TurnState, type DrawSource} from './turns';
import {matchRecord, decodePrivateMatch} from './releaseSave';
import {publicTurnModel} from './publicTurnModel';
import {buildTurnRequest} from './turnEvidence';
import {toTurnStructuralModel} from './turnStructuralModel';

function accept(move: ReturnType<typeof endTurn>) {
  if (!move.ok) throw new Error(move.reason);
  return move.state;
}
function draw(state: TurnState, sources: DrawSource[]) {
  return sources.reduce((state, source) => accept(chooseTurnDraw(state, source)), state);
}
function oneAxisFixture() {
  for (let seed = 0; seed < 256; seed++) {
    const state = draw(createReleaseGame(seed), ['members', 'connections', 'connections', 'connections']);
    const card = activeTurnHand(state).find(card => card.kind === 'connection' && card.rotationsToLock === 1);
    if (card) return {state, card};
  }
  throw new Error('No genuine seeded one-axis hand found.');
}

it('persists the original member-local basis on live connection events and public physical summaries', () => {
  let {state, card} = oneAxisFixture();
  const beam = activeTurnHand(state).find(card => card.kind === 'element')!;
  state = accept(stageElement(state, beam.id, '2,2,1', '3,3,2'));
  state = accept(stageConnection(state, card.id, 3, 'a', undefined, 'lock-x'));
  const original = state.draft.connections[0];
  expect(original.frameVersion).toBe('member-local-1');
  expect(original.axes).toEqual(memberConnectionFrame(state.draft.members[0]));
  expect(state.events.at(-1)).toMatchObject({kind: 'connection', axes: original.axes, frameVersion: 'member-local-1'});
  const request = buildTurnRequest(state, 'local-axis-fixture');
  expect(request.snapshot.connections.find(connection => connection.endpointId === 'endpoint:3:a')?.referenceY).toEqual(original.axes?.[1]);
  expect(() => toTurnStructuralModel(state)).toThrow(/fixed\/pinned/);
  const staged = matchRecord(state, null, 'planning');
  expect(decodePrivateMatch(JSON.stringify(staged))).toEqual(staged);
  state = accept(endTurn(state));
  const published = publicTurnModel(state);
  expect(published.board.connections.find(connection => connection.memberId === 3)).toMatchObject({axes: original.axes, frameVersion: 'member-local-1'});
  // Deliberately mutate the exported copy at runtime to verify that publication
  // cannot hand out the authoritative frame's nested arrays.
  (published.board.connections.find(connection => connection.memberId === 3)!.axes! as unknown as number[][])[0][0] = .123;
  expect(state.board.connections.find(connection => connection.memberId === 3)?.axes).toEqual(original.axes);
  expect(JSON.stringify(published)).not.toMatch(/cardId|decks|hands|seed/);
  const forged = JSON.parse(JSON.stringify(staged));
  forged.turn.events.at(-1).axes[0] = [1, 0, 0];
  forged.turn.draft.connections[0].axes[0] = [1, 0, 0];
  expect(() => decodePrivateMatch(JSON.stringify(forged))).toThrow(/axes|frame/);
});

it('retains global interpretation of an earlier unpublished play-2 action with no explicit frame', () => {
  let {state, card} = oneAxisFixture();
  const beam = activeTurnHand(state).find(card => card.kind === 'element')!;
  state = accept(stageElement(state, beam.id, '2,2,1', '2,3,1'));
  state = accept(stageConnection(state, card.id, 3, 'a', undefined, 'lock-x'));
  const earlier = JSON.parse(JSON.stringify(state));
  delete earlier.draft.connections[0].axes;
  delete earlier.draft.connections[0].frameVersion;
  delete earlier.events.at(-1).axes;
  delete earlier.events.at(-1).frameVersion;
  const decoded = parseTurnState(earlier);
  expect(decoded).toEqual(earlier);
  expect(connectionFrameFor(decoded!.draft.connections[0])).toEqual([[1,0,0],[0,1,0],[0,0,1]]);
});

it('recomputes a provisional fixed frame during a pivot while preserving interleaved interval and draw events', () => {
  const opening = draw(createReleaseGame(0), ['members', 'connections', 'connections', 'loads']);
  const beam = activeTurnHand(opening).find(card => card.kind === 'element')!;
  const fixed = activeTurnHand(opening).find(card => card.kind === 'connection' && card.profile === 'fixed')!;
  let state = accept(stageElement(opening, beam.id, '5,7,1', '6,7,1'));
  state = accept(stageConnection(state, fixed.id, 3, 'a'));
  state = accept(changeCheckpointInterval(state, 2));
  const committedConnections = structuredClone(state.board.connections);
  const originalDraws = structuredClone(state.draws);
  state = accept(editDraftMember(state, 3, '5,7,1', '5,8,1'));
  expect(state.draft.connections[0].axes).toEqual(memberConnectionFrame(state.draft.members[0]));
  expect(state.draft.connections[0].axes?.[0]).toEqual([0, 1, 0]);
  expect(state.board.connections).toEqual(committedConnections);
  expect(state.events.map(event => event.kind)).toEqual(['draw','draw','draw','draw','element','connection','interval']);
  const undone = accept(undoLastPlacement(state));
  expect(undone.draft.members).toHaveLength(1);
  expect(undone.draft.connections).toEqual([]);
  expect(undone.events.map(event => event.kind)).toEqual(['draw','draw','draw','draw','element','interval']);
  const cancelled = accept(cancelTurnDraft(state));
  expect(cancelled.draft).toEqual({members: [], loads: [], connections: []});
  expect(cancelled.events.map(event => event.kind)).toEqual(['draw','draw','draw','draw','interval']);
  for (const result of [state, undone, cancelled]) {
    expect(result.draws).toEqual(originalDraws);
    expect(result.checkpoints?.interval).toBe(2);
    expect(result.checkpoints?.settingLog).toHaveLength(1);
    expect(parseTurnState(JSON.parse(JSON.stringify(result)))).toEqual(result);
  }
});

it('revalidates physical joint compatibility after editing a locally released provisional member', () => {
  for (let seed = 0; seed < 256; seed++) {
    let state = draw(createReleaseGame(seed), ['members','members','connections','connections']);
    const hand = activeTurnHand(state);
    const beam = hand.find(card => card.kind === 'element')!;
    const one = hand.find(card => card.kind === 'connection' && card.rotationsToLock === 1);
    if (!one) continue;
    state = accept(stageElement(state, beam.id, '2,2,1', '3,2,1'));
    state = accept(stageConnection(state, one.id, 3, 'b', undefined, 'lock-x'));
    state = accept(endTurn(state));
    state = draw(state, ['members','connections','connections','connections']);
    const next = activeTurnHand(state);
    const child = next.find(card => card.kind === 'element')!;
    const incoming = next.find(card => card.kind === 'connection' && card.rotationsToLock === 1);
    if (!incoming || incoming.kind !== 'connection') continue;
    expect(connectionChoices(incoming)).toContain('lock-x');
    state = accept(stageElement(state, child.id, '3,2,1', '4,2,1'));
    state = accept(stageConnection(state, incoming.id, 4, 'a', undefined, 'lock-x'));
    const original = structuredClone(state);
    expect(editDraftMember(state, 4, '3,2,1', '3,3,1')).toMatchObject({ok: false, reason: expect.stringContaining('Incompatible joint profiles')});
    expect(state).toEqual(original);
    expect(parseTurnState(state)).toEqual(state);
    return;
  }
  throw new Error('No genuine seeded pair of one-axis turns found.');
});
