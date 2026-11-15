import {readFile} from 'node:fs/promises';
import {beforeAll, expect, it} from 'vitest';
import {createReleaseDecks, PLAY_REVISION, RELEASE_CATALOGUE} from './cardCatalogue';
import {activeTurnHand, createReleaseGame, createTurnGame, endTurn, parseTurnState,
  stageConnection, stageElement, stageLoad, undoLastPlacement, chooseTurnDraw, remainingTurnDraws, editDraftMember, type TurnState} from './turns';
import {prepareReleaseSolver, analyzeTurn} from './turnAnalysis';
import {assessTurnOutcome, inspectIssues} from './turnIssues';
import {correctJointReleases} from './nodeRepair';
import {effectiveJointConnections} from './jointCorrections';

beforeAll(() => prepareReleaseSolver(() => readFile(new URL('../solver/wasm/dof_solver.wasm', import.meta.url))));
function accept(move: ReturnType<typeof endTurn>) {
  if (!move.ok) throw Error(move.reason);
  return move.state;
}
function drawFour(state: TurnState) {
  for (const source of ['members', 'connections', 'connections', 'loads'] as const) state = accept(chooseTurnDraw(state, source));
  return state;
}

it('favors the standard member and keeps the first eight member choices free of springs across deterministic seeds', () => {
  const [deck] = createReleaseDecks(PLAY_REVISION);
  expect(deck.filter(card => card.kind === 'element' && card.type === 'spring')).toHaveLength(2);
  expect(deck.filter(card => card.kind === 'element' && card.type !== 'spring' && card.type !== 'cable')).toHaveLength(18);
  for (let seed = 0; seed < 100; seed++) {
    const turn = createReleaseGame(seed);
    expect(turn.players[0].hand).toEqual([]);
    expect(turn.decks).toHaveLength(3);
    expect(turn.decks[0].slice(0, 8).every(card => card.kind === 'element' && card.type === 'heb')).toBe(true);
    expect(new Set(turn.decks.flat().map(card => card.id)).size).toBe(96);
    expect(createReleaseGame(seed)).toEqual(turn);
  }
  expect(createReleaseDecks()[0].filter(card => card.kind === 'element' && card.type === 'spring')).toHaveLength(8);
});

it('undoes provisional loads, connections and members in reverse order without changing the draw or committed board', () => {
  const opening = drawFour(createReleaseGame(0));
  const frame = activeTurnHand(opening).find(card => card.kind === 'element')!;
  const fixed = activeTurnHand(opening).find(card => card.kind === 'connection' && card.profile === 'fixed')!;
  const load = activeTurnHand(opening).find(card => card.kind === 'load')!;
  let state = accept(stageElement(opening, frame.id, '5,7,1', '6,7,1'));
  state = accept(stageConnection(state, fixed.id, 3, 'a'));
  state = accept(stageLoad(state, load.id, 'endpoint:3:b'));
  state = accept(undoLastPlacement(state));
  expect(state.draft.loads).toEqual([]);
  expect(state.draft.connections).toHaveLength(1);
  state = accept(undoLastPlacement(state));
  state = accept(undoLastPlacement(state));
  expect(state).toEqual(opening);
  expect(undoLastPlacement(state)).toMatchObject({ok: false});
  expect(parseTurnState(state)).toEqual(state);
});

it('locks an existing released joint through a rated fitting without adding members or ground supports', () => {
  const opening = createReleaseGame(0);
  const state: TurnState = {...opening, nextId: 5, board: {...opening.board,
    members: [...opening.board.members, {id: 3, type: 'heb', owner: 'player-1', a: '5,7,1', b: '6,7,1'}],
    joints: [...opening.board.joints, {id: '6,7,1'}],
    connections: [...opening.board.connections,
      {memberId: 3, end: 'a', jointId: '5,7,1', profile: 'fixed', owner: 'player-1'},
      {memberId: 3, end: 'b', jointId: '6,7,1', profile: 'lock-x', owner: 'player-1'}]},
    draft: {members: [{id: 4, type: 'heb', owner: 'player-1', a: '6,7,1', b: '6,8,1'}],
      connections: [{memberId: 4, end: 'a', jointId: '6,7,1', profile: 'lock-x', owner: 'player-1'}],
      loads: [{cardId: 'fixture', jointId: 'endpoint:4:b', magnitude: 5, owner: 'player-1'}]}};
  const outcome = assessTurnOutcome(state);
  expect(outcome.issues.changes.some(change => change.category === 'instability' && change.eligible)).toBe(true);
  const frozen = {...state, board: {...state.board, members: [...state.board.members, ...state.draft.members],
    connections: [...state.board.connections, ...state.draft.connections], loads: [...state.board.loads, ...state.draft.loads]},
    draft: {members: [], connections: [], loads: []}};
  const correction = correctJointReleases(frozen, outcome.issues, 1)!;
  expect(correction.receipt.jointAttempts?.some(attempt => attempt.status === 'verified'), JSON.stringify(correction.receipt)).toBe(true);
  expect(correction.state.board.members).toEqual(frozen.board.members);
  expect(correction.state.board.joints).toEqual(frozen.board.joints);
  expect(correction.state.board.connections).toEqual(frozen.board.connections);
  expect(correction.receipt.pending).toEqual([]);
  expect(effectiveJointConnections(correction.state.board).filter(end => end.jointId === '6,7,1').every(end => end.profile === 'fixed')).toBe(true);
  expect(inspectIssues(correction.state).findings.filter(finding => finding.category === 'instability').every(finding => finding.active === false)).toBe(true);
  const result = analyzeTurn(correction.state, 'card-gravity');
  expect(Object.values(result.capacity!.connections).every(check => check.status === 'verified' && check.utilization < 1)).toBe(true);
});

it('retains a floating beam and its historical penalty as unresolved, without inventing a prop, and replays both rules revisions', () => {
  let state = drawFour(createReleaseGame(0));
  const beam = activeTurnHand(state).find(card => card.kind === 'element')!;
  state = accept(stageElement(state, beam.id, '2,2,1', '2,3,1'));
  state = accept(endTurn(state));
  expect(state.reports[0].status).toBe('pending');
  expect(state.reports[0].penalty).toBe(0);
  state = accept(endTurn(drawFour(state)));
  state = accept(endTurn(drawFour(state)));
  expect(state.reports[0].penalty).toBe(-1);
  expect(state.reports[0].correction?.policy).toBe('node-release-locks-1');
  expect(state.reports[0].correction?.pending.length).toBeGreaterThan(0);
  expect(state.board.members).toHaveLength(3);
  expect(state.board.joints.filter(joint => joint.foundationOwner)).toHaveLength(2);
  expect(parseTurnState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  const legacy = accept(endTurn(createTurnGame(0, RELEASE_CATALOGUE)));
  expect(legacy.rulesRevision).toBeUndefined();
  expect(legacy.events.at(-1)).toMatchObject({repairPolicy: 'local-steel-prop-2'});
  expect(parseTurnState(JSON.parse(JSON.stringify(legacy)))).toEqual(legacy);
  const forged = JSON.parse(JSON.stringify(state));
  forged.rulesRevision = 'future';
  expect(parseTurnState(forged)).toBeNull();
});

it('requires four independent deck choices, supports unlimited held-card plays, and replays draft edits without redrawing', () => {
  let state = createReleaseGame(0);
  expect(endTurn(state)).toMatchObject({ok: false});
  for (let i = 0; i < 4; i++) state = accept(chooseTurnDraw(state, 'members'));
  expect(remainingTurnDraws(state)).toBe(0);
  expect(chooseTurnDraw(state, 'loads')).toMatchObject({ok: false});
  const initialDraws = structuredClone(state.draws);
  const cards = activeTurnHand(state);
  for (let i = 0; i < 4; i++) state = accept(stageElement(state, cards[i].id, `2,${2+i*2},1`, `3,${2+i*2},1`));
  expect(state.draft.members).toHaveLength(4);
  state = accept(editDraftMember(state, 6, '2,8,1', '4,8,1'));
  expect(state.draft.members[3].b).toBe('4,8,1');
  expect(editDraftMember(state, 6, '2,8,1', '15,8,1')).toMatchObject({ok: false});
  expect(state.draws).toEqual(initialDraws);
  state = accept(endTurn(state));
  expect(remainingTurnDraws(state)).toBe(4);
  for (let i = 0; i < 4; i++) state = accept(chooseTurnDraw(state, 'loads'));
  for (const load of activeTurnHand(state)) state = accept(stageLoad(state, load.id, 'endpoint:3:b'));
  expect(state.draft.loads).toHaveLength(4);
  expect(parseTurnState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  const altered = JSON.parse(JSON.stringify(state));
  altered.events[0].source = 'connections';
  expect(parseTurnState(altered)).toBeNull();
});
