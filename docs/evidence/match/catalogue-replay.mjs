// node docs/evidence/match/catalogue-replay.mjs [repo or archived checkout]
// Exercise deterministic deals, ordinary gravity actions and passes in every
// scored catalogue. Structural family benchmarks are run separately.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createServer } from "vite";

const root = resolve(process.argv[2] ?? ".", "apps/web");
const server = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false, watch: null } });
try {
  const definitions = await server.ssrLoadModule("/src/game/cardCatalogue.ts");
  const { createTurnGame, activeTurnHand, stageLoad, endTurn, replayTurnState } =
    await server.ssrLoadModule("/src/game/turns.ts");
  const catalogues = Object.values(definitions).filter(value =>
    typeof value === "string" && definitions.isScoredCatalogue(value));
  assert.ok(catalogues.length >= 5);
  const counts = Object.fromEntries(catalogues.map(id => [id, { matches: 0, loads: 0 }]));
  let turns = 0;
  function cards(state) {
    return [...state.decks.flat(), ...state.players.flatMap(player => player.hand)].map(c => c.id)
      .concat(state.board.loads.map(load => load.cardId)).sort();
  }
  for (let seed = 0; seed < 625; seed++) {
    const id = catalogues[seed % catalogues.length];
    let state = createTurnGame(seed, id);
    const initial = cards(state), loads = [0,0];
    assert.equal(initial.length, new Set(initial).size);
    for (let turn = 1; turn <= 16; turn++) {
      const seat = state.playerIndex;
      assert.equal(state.turn, turn);
      assert.equal(seat, (turn - 1) % 2);
      // Vary the load recipient independently of the acting seat. Keep
      // the stock columns within their verified linear/capacity envelopes.
      const recipient = (seed + Math.floor(turn/3)) % 2;
      const card = activeTurnHand(state).find(c => c.kind === "load" && c.magnitude <= 10 &&
        c.magnitude + loads[recipient] <= 30);
      if (seed % 7 !== 0 && turn % 4 !== 0 && card) {
        const draft = stageLoad(state, card.id, (recipient === 0 ? "1" : "5") + ",3,1");
        assert.ok(draft.ok, draft.reason);
        state = draft.state;
        loads[recipient] += card.magnitude;
        counts[id].loads++;
      }
      const next = endTurn(state);
      assert.ok(next.ok, next.reason);
      state = next.state;
      assert.deepEqual(cards(state), initial);
      assert.equal(state.reports.at(-1).penalty, 0);
      turns++;
    }
    const total = loads[0] + loads[1];
    assert.equal(state.finished, true);
    assert.equal(state.finalScore.partial, false);
    assert.equal(state.finalScore.totalGravityKN, total);
    for (let seat = 0; seat < 2; seat++) {
      const expected = total > 0 ? 100 * loads[seat]/total : 0;
      assert.ok(Math.abs(state.finalScore.awards[seat].finalScore - expected) < 1e-9);
    }
    const restored = replayTurnState({ version: state.version, seed, catalogue: id,
      events: JSON.parse(JSON.stringify(state.events)) });
    assert.ok(restored.ok, restored.reason);
    assert.deepEqual(restored.state, state);
    counts[id].matches++;
  }
  console.log(JSON.stringify({ turns, catalogues: counts }));
} finally {
  await server.close();
}
