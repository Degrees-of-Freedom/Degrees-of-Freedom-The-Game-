import {readFile} from 'node:fs/promises';
import {beforeAll, expect, it} from 'vitest';
import {createReleaseDecks, PLAY_REVISION, PLAY_SPRING_REFERENCE, RELEASE_CATALOGUE} from './cardCatalogue';
import {SPRING} from '../solver/voxelSections';
import {createReleaseGame, createTurnGame, chooseTurnDraw, stageElement, stageConnection,
  cancelTurnDraft, undoLastPlacement, parseTurnState, activeTurnHand, type TurnState} from './turns';
import {prepareReleaseSolver} from './turnAnalysis';
import {matchRecord, decodePrivateMatch} from './releaseSave';

beforeAll(() => prepareReleaseSolver(() => readFile(new URL('../solver/wasm/dof_solver.wasm', import.meta.url))));
function accept(result: ReturnType<typeof chooseTurnDraw>) {
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}
function draw(state: TurnState, sources: ('members'|'connections'|'loads')[]) {
  return sources.reduce((state, source) => accept(chooseTurnDraw(state, source)), state);
}

it('pins the authored spring reference and all four member variants, with exactly three rotational connector printings', () => {
  const decks = createReleaseDecks(PLAY_REVISION);
  expect(PLAY_SPRING_REFERENCE).toMatchObject({stiffnessNPerM: SPRING.stiffnessNPerM, unit: 'N/m'});
  expect(new Set(decks[0].map(card => card.definitionId.split('/')[1]))).toEqual(new Set(['heb', 'cable', 'spring-quarter', 'spring-half']));
  const springs = decks[0].filter(card => card.kind === 'element' && card.type === 'spring');
  expect(springs.map(card => card.kind === 'element' && card.springStiffnessNPerM)).toEqual([
    .25 * PLAY_SPRING_REFERENCE.stiffnessNPerM, .5 * PLAY_SPRING_REFERENCE.stiffnessNPerM]);
  expect(new Set(decks[1].map(card => card.kind === 'connection' && card.rotationsToLock))).toEqual(new Set([1, 2, 3]));
  expect(decks[0].every(card => card.kind === 'element' && [5,7,10].includes(card.maxSteps))).toBe(true);
});

it('preserves exact independent source choices and card identity through partial-draw and staged private reloads', () => {
  let state = createReleaseGame(3);
  state = draw(state, ['loads', 'members']);
  const partial = matchRecord(state, null, 'planning');
  expect(decodePrivateMatch(JSON.stringify(partial))).toEqual(partial);
  state = draw(state, ['connections', 'members']);
  const card = activeTurnHand(state).find(card => card.kind === 'element')!;
  state = accept(stageElement(state, card.id, '5,7,1', '6,7,1'));
  const record = matchRecord(state, partial, 'planning');
  expect(decodePrivateMatch(JSON.stringify(record))).toEqual(record);
  const draws = structuredClone(state.draws), decks = structuredClone(state.decks);
  state = accept(undoLastPlacement(state));
  state = accept(cancelTurnDraft(state));
  expect(state.draws).toEqual(draws);
  expect(state.decks).toEqual(decks);
  expect(state.players[0].hand.some(held => held.id === card.id)).toBe(true);
  for (const mutate of [
    (raw: typeof record) => {
      const event = raw.turn.events[0];
      if (event.kind === 'draw') event.source = 'connections';
    },
    (raw: typeof record) => {raw.turn.board.jointCorrections = [{jointId: '5,7,1', lockedRotations: 7,
      system: {policy: 'node-release-locks-1', definitionVersion: 'playtest-1', turn: 1, issueId: 'invented', objectId: 'invented'}}];},
    (raw: typeof record) => {raw.turn.decks[0].reverse();},
  ]) {
    const raw = structuredClone(record); mutate(raw);
    expect(() => decodePrivateMatch(JSON.stringify(raw))).toThrow();
  }
});

it('rejects edits to setup/committed connector identities and does not reinterpret an old game as the new revision', () => {
  const state = draw(createReleaseGame(0), ['connections', 'connections', 'members', 'loads']);
  const fixed = activeTurnHand(state).find(card => card.kind === 'connection' && card.profile === 'fixed')!;
  expect(stageConnection(state, fixed.id, 1, 'a')).toMatchObject({ok: false, reason: expect.stringContaining('immutable')});
  const original = createTurnGame(0, RELEASE_CATALOGUE);
  expect(parseTurnState(original)).toEqual(original);
  expect(parseTurnState({...original, rulesRevision: PLAY_REVISION})).toBeNull();
  const forged = {...original, rulesRevision: 'future'};
  expect(parseTurnState(forged)).toBeNull();
});
