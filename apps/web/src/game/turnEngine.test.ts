import { describe, expect, it } from 'vitest';
import { CABLE_FORMULATION, RELEASE_SOLVER } from '../evaluator/evidence';
import { RELEASE_CATALOGUE, SCORED_CATALOGUE } from './cardCatalogue';
import { analyzeTurn, usesRustTurnSolver } from './turnAnalysis';
import { createTurnGame, endTurn, parseTurnState, RUST_TURN_ENGINE, stageLoad, type TurnState } from './turns';

const accepted = (transition: ReturnType<typeof endTurn>) => {
  if (!transition.ok) throw new Error(transition.reason);
  return transition.state;
};
/** The compact form a session save stores. */
const wire = (state: TurnState) => JSON.parse(JSON.stringify({
  version: state.version, catalogue: state.catalogue, ...(state.engine && { engine: state.engine }),
  seed: state.seed, events: state.events,
}));
/** A scored match with one gravity card on a column head, played to the end. */
function playMatch(engine?: null) {
  let state = createTurnGame(23, SCORED_CATALOGUE, engine);
  state = accepted(endTurn(state));
  state = accepted(stageLoad(state, 'load-20', '1,3,1'));
  while (!state.finished) state = accepted(endTurn(state));
  return state;
}

describe('per-match analysis engine', () => {
  it('starts new playtest matches on the Rust turn solver and records it', () => {
    const state = createTurnGame(5, SCORED_CATALOGUE);
    expect(state.engine).toBe(RUST_TURN_ENGINE);
    expect(usesRustTurnSolver(state)).toBe(true);
    const verification = analyzeTurn(state, 'card-gravity').combos[0].components![0].verification;
    expect(verification).toMatchObject({ formulation: RELEASE_SOLVER, status: 'verified-nonlinear' });
  });

  it('never records an engine on the release, which always uses Rust', () => {
    const release = createTurnGame(5, RELEASE_CATALOGUE);
    expect(release).not.toHaveProperty('engine');
    expect(usesRustTurnSolver(release)).toBe(true);
  });

  it('replays a complete Rust match exactly, including its final award', () => {
    const t0 = performance.now();
    const state = playMatch();
    const played = performance.now() - t0;
    expect(state.finalScore?.receipt.solver).toBe(RELEASE_SOLVER);
    expect(state.players.map(p => p.score)).toEqual([100, 0]);
    const t1 = performance.now();
    expect(parseTurnState(wire(state))).toEqual(state);
    // Recorded for the knowledge base; the main thread runs both.
    console.info(`Rust playtest match: played in ${played.toFixed(0)} ms, replayed in ${(performance.now() - t1).toFixed(0)} ms`);
  });

  it('replays a match saved before the migration on the legacy kernel, with its original evidence', () => {
    const legacy = playMatch(null);
    expect(legacy).not.toHaveProperty('engine');
    expect(usesRustTurnSolver(legacy)).toBe(false);
    expect(legacy.finalScore?.receipt.solver).not.toBe(RELEASE_SOLVER);
    expect([CABLE_FORMULATION, 'voxel-linear-frame-v1']).toContain(legacy.finalScore?.receipt.solver);
    const restored = parseTurnState(wire(legacy));
    expect(restored).toEqual(legacy);
    expect(restored).not.toHaveProperty('engine');
  });

  it('rejects a saved match that names an unknown engine', () => {
    const state = createTurnGame(5, SCORED_CATALOGUE);
    expect(parseTurnState({ ...wire(state), engine: 'rust-99' })).toBeNull();
  });

  it('keeps the engine a match was saved with, so its evidence cannot be re-assessed on another', () => {
    const rust = playMatch();
    const relabelled = { ...wire(rust) };
    delete relabelled.engine;
    // The Rust evidence does not reproduce on the legacy kernel.
    expect(parseTurnState(relabelled)).toBeNull();
  });
});
