import { expect, it } from 'vitest';
import { JOINT_CATALOGUE, SCORED_CATALOGUE, printedCards } from './cardCatalogue';
import { activeTurnHand, createTurnGame, endTurn, parseTurnState, stageConnection, stageElement, stageLoad, type TurnState } from './turns';
import { analyzeTurn } from './turnAnalysis';
import { vecToGlobal } from '../solver/frameMath';

function accepted(transition: ReturnType<typeof endTurn>) {
  if (!transition.ok) throw Error(transition.reason);
  return transition.state;
}
function card(state: TurnState, predicate: Parameters<ReturnType<typeof activeTurnHand>['find']>[0]) {
  const found = activeTurnHand(state).find(predicate);
  if (!found) throw Error('Seed 1 printing missing');
  return found.id;
}

it('deals the wider connection law only through its own versioned deck', () => {
  const joints = Array.from({length:32},(_,i) => printedCards(i,JOINT_CATALOGUE));
  const original = Array.from({length:32},(_,i) => printedCards(i,SCORED_CATALOGUE));
  expect(joints.map(deal => deal.element)).toEqual(original.map(deal => deal.element));
  expect(new Set(original.map(deal => deal.connection.definitionId)).size).toBe(2);
  expect(new Set(joints.map(deal => deal.connection.definitionId)).size).toBe(7);
});

it('preserves both seat printings and the rejected hinge in a real seed-1 replay', () => {
  let state = createTurnGame(1,JOINT_CATALOGUE);
  for(let i=0;i<5;i++) state = accepted(endTurn(state));
  const first = '1,3,1', joint = '1,3,2';
  state = accepted(stageElement(state,card(state,c=>c.kind==='element'),first,joint));
  state = accepted(stageConnection(state,card(state,c=>c.kind==='connection' && c.profile==='fixed'),3,'a'));
  state = accepted(stageConnection(state,card(state,c=>c.kind==='connection' && c.profile==='seat-20'),3,'b'));
  state = accepted(stageLoad(state,card(state,c=>c.kind==='load' && c.magnitude===10),joint));
  state = accepted(endTurn(state));
  const outcome = analyzeTurn(state,'card-gravity'), e = outcome.ctx!.els.find(e=>e.m.id===3)!;
  const combo = outcome.combos[0], end = combo.ef!.get(e)!;
  const node = combo.u!.slice(6*e.b,6*e.b+6);
  expect(node[2]-vecToGlobal(end.ul,e.R)[8]).toBeCloseTo(-10/20000,11);
  const rating = outcome.capacity!.connections['3:b'];
  expect(rating.status).toBe('verified');
  if (rating.status === 'verified') expect(rating.utilization).toBeCloseTo(10/400,12);
  expect(state.reports.at(-1)?.penalty).toBe(0);
  state = accepted(stageElement(state,card(state,c=>c.kind==='element'),joint,'2,3,2'));
  const incompatible = card(state,c=>c.kind==='connection' && c.profile==='hinge-diagonal');
  const rejected = stageConnection(state,incompatible,4,'a');
  expect(rejected.ok).toBe(false);
  expect(activeTurnHand(state).some(c=>c.id===incompatible)).toBe(true);
  state = accepted(stageConnection(state,card(state,c=>c.kind==='connection' && c.profile==='seat-80'),4,'a'));
  state = accepted(endTurn(state));
  expect(state.board.connections.filter(c=>c.jointId===joint).map(c=>c.profile)).toEqual(['seat-20','seat-80']);
  expect(parseTurnState(state)).toEqual(state);
});
