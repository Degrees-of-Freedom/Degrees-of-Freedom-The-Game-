import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { RELEASE_CATALOGUE } from './cardCatalogue';
import { NEUTRAL_OWNER } from './finalScore';
import { analyzeTurn, prepareReleaseSolver } from './turnAnalysis';
import { activeTurnHand, createTurnGame, endTurn, parseTurnState, stageConnection, stageElement, stageLoad, type TurnState } from './turns';

beforeAll(() => prepareReleaseSolver(() => readFile(new URL('../solver/wasm/dof_solver.wasm', import.meta.url))));

function accept(next: ReturnType<typeof endTurn>) {
  if (!next.ok) throw new Error(next.reason);
  return next.state;
}
function finish(turn: TurnState) {
  while (!turn.finished) turn = accept(endTurn(turn,turn.turn));
  return turn;
}
function deal() {
  for (let seed = 0; seed < 1000; seed++) {
    const turn = createTurnGame(seed, RELEASE_CATALOGUE), hand = activeTurnHand(turn);
    const frame = hand.find(c => c.kind === 'element' && c.type === 'heb');
    const fixed = hand.find(c => c.kind === 'connection' && c.profile === 'fixed');
    const load = hand.find(c => c.kind === 'load');
    if (frame && fixed && load?.kind === 'load') return {turn, frame, fixed, load};
  }
  throw new Error('Fixture requires a genuine seed with a frame, a fixed connector and a load.');
}

describe('actual release turn solver, receipts and card lifecycle', () => {
  it('charges no gravity on 16 passes, draws 32 from each deck, and replays the final tie', () => {
    const completed = finish(createTurnGame(0, RELEASE_CATALOGUE));
    const check = analyzeTurn(completed,'card-gravity');
    expect(check.error).toBeFalsy();
    expect(completed.decks.map(d => d.length)).toEqual([16,16]);
    expect(completed.draws).toHaveLength(16);
    expect(completed.draws!.at(-1)?.remaining).toEqual([16,16]);
    expect(new Set(completed.draws!.flatMap(d => [...d.pieces,...d.connectors])).size).toBe(64);
    expect(completed.players.map(p => p.hand.length)).toEqual([32,32]);
    expect(completed.reports.map(r => r.status)).toEqual(Array(16).fill('stable'));
    expect(completed.reports.map(r => r.penalty)).toEqual(Array(16).fill(0));
    expect(completed.finalScore).toMatchObject({totalGravityKN:0,partial:false,winners:['player-1','player-2']});
    expect(endTurn(completed).ok).toBe(false);
    expect(parseTurnState(JSON.parse(JSON.stringify(completed)))).toEqual(completed);
    // Archived editor turns may carry a solver comparison. Release saves
    // reconstruct explanations exclusively from their own physical receipts.
    const altered = structuredClone(completed.events);
    const last = altered.at(-1)!;
    if (last.kind !== 'end') throw new Error('Missing final event.');
    last.reason = 'External verdict';
    expect(parseTurnState({version: 1, catalogue: RELEASE_CATALOGUE, seed: 0, events: altered})).toBeNull();
  });

  it('assigns cantilever tip gravity to its owner and rejects a forged but balanced signed receipt', () => {
    const {turn,frame,fixed,load} = deal();
    let state = accept(stageElement(turn,frame.id,'5,7,1','6,7,1'));
    state = accept(stageConnection(state,fixed.id,3,'a'));
    state = accept(stageLoad(state,load.id,'endpoint:3:b'));
    const completed = finish(state), score = completed.finalScore!;
    expect(score.partial,JSON.stringify(score.receipt.components)).toBe(false);
    expect(score.awards[0].awardedShare).toBeCloseTo(100,7);
    expect(score.awards[1].awardedShare).toBeCloseTo(0,7);
    expect(score.totalGravityKN).toBe(load.magnitude);
    expect(parseTurnState(JSON.parse(JSON.stringify(completed)))).toEqual(completed);
    const forged = structuredClone(completed);
    const final = forged.events.at(-1)!;
    if (final.kind !== 'end' || !final.final) throw new Error('Missing final receipt.');
    final.final.receipt.components[0].reason = 'Invented validation.';
    expect(parseTurnState({version:1,catalogue:RELEASE_CATALOGUE,seed:turn.seed,events:forged.events})).toBeNull();
  });

  it('retains a loaded floating frame and its originating penalty after verified physical neutral correction', () => {
    const {turn,frame,load} = deal();
    let state = accept(stageElement(turn,frame.id,'2,2,1','2,3,1'));
    state = accept(stageLoad(state,load.id,'endpoint:3:a'));
    const first = accept(endTurn(state));
    const report = first.reports[0];
    expect(report.penalty).toBe(-1);
    expect(report.correction?.attempts.some(a => a.status === 'verified'),JSON.stringify(report.correction?.attempts)).toBe(true);
    expect(report.correction!.attempts.length).toBeLessThanOrEqual(3);
    expect(first.board.members.some(m => m.owner === NEUTRAL_OWNER && m.system)).toBe(true);
    expect(first.board.loads).toEqual(state.draft.loads);
    const completed = finish(first), score = completed.finalScore!;
    expect(score.neutralShare).toBeCloseTo(100,7);
    expect(score.awards.map(a => a.penaltyPoints)).toEqual([1,0]);
    expect(score.awards.map(a => a.finalScore)).toEqual([-1,0]);
    expect(parseTurnState(JSON.parse(JSON.stringify(completed)))).toEqual(completed);
  });
});
