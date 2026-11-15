import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { RELEASE_SOLVER, RELEASE_SOLVERS } from '../evaluator/evidence';
import { decodePrivateMatch, matchRecord } from './releaseSave';
import { prepareReleaseSolver } from './turnAnalysis';
import { activeTurnHand, createTurnGame, endTurn, stageConnection, stageElement, stageLoad, type TurnState } from './turns';

beforeAll(() => prepareReleaseSolver(() => readFile(new URL('../solver/wasm/dof_solver.wasm', import.meta.url))));

const LEGACY = 'dof-rust-0.2.0-nonlinear-1';

/** A finished release match: each player builds a fixed frame and loads it. */
function finishedMatch(seed: number): TurnState {
  const accept = (move: { ok: true; state: TurnState } | { ok: false; reason: string }) => {
    if (!move.ok) throw new Error(move.reason);
    return move.state;
  };
  let state = createTurnGame(seed, 'grow-dusk-release-1');
  const built = new Map<number, number>();
  for (let turn = 1; turn <= 16; turn++) {
    const player = state.playerIndex;
    const hand = activeTurnHand(state);
    const frame = hand.find(c => c.kind === 'element' && c.type === 'heb');
    const fixed = hand.find(c => c.kind === 'connection' && c.profile === 'fixed');
    if (turn < 16 && !built.has(player) && frame && fixed) {
      const x = player === 0 ? 5 : 10;
      const id = state.nextId;
      state = accept(stageElement(state, frame.id, `${x},7,1`, `${x},8,2`));
      state = accept(stageConnection(state, fixed.id, id, 'a', `${x},7,1`));
      built.set(player, id);
    }
    const load = activeTurnHand(state).find(c => c.kind === 'load');
    const target = built.get(player) ?? [...built.values()][0];
    if (turn < 16 && load && target !== undefined) state = accept(stageLoad(state, load.id, `port:${target}:2`));
    state = accept(endTurn(state, turn));
  }
  return state;
}

describe('release saves across solver revisions', () => {
  it('writes the current release solver and loads saves made by 0.2.0', () => {
    expect(RELEASE_SOLVERS).toEqual([LEGACY, RELEASE_SOLVER]);
    const state = finishedMatch(0);
    expect(state.finished).toBe(true);
    const bytes = JSON.stringify(matchRecord(state, null, 'final'));
    expect(bytes).toContain(`"solver":"${RELEASE_SOLVER}"`);
    const current = decodePrivateMatch(bytes);
    expect(current.turn.finalScore?.awards.length).toBeGreaterThan(0);

    // The same match as solver 0.2.0 wrote it: its id in the save header and
    // in the final score receipt. It loads and keeps its awards.
    const legacy = bytes.replaceAll(RELEASE_SOLVER, LEGACY);
    expect(legacy).not.toContain(RELEASE_SOLVER);
    const decoded = decodePrivateMatch(legacy);
    expect(decoded.solver).toBe(LEGACY);
    expect(decoded.turn.finalScore?.awards).toEqual(current.turn.finalScore?.awards);
    expect(decoded.turn.finalScore?.winners).toEqual(current.turn.finalScore?.winners);
    expect(JSON.stringify(decoded)).toBe(legacy);
  });

  it('rejects a solver the release does not accept', () => {
    const bytes = JSON.stringify(matchRecord(createTurnGame(1, 'grow-dusk-release-1'), null, 'planning'));
    expect(() => decodePrivateMatch(bytes.replace(RELEASE_SOLVER, 'dof-rust-9.9.9-nonlinear-1'))).toThrow(/solver version/);
  });
});
