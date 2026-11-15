// Play the same Shared table matches with an earlier checked-in WASM module
// and with the current one, and require identical results.
//
// For seeds 0-19 of the release catalogue this repeats the purposeful
// production plays of check-saved-solver.mjs (frames, fixed connections,
// loads, an adverse loose member on seed 1) with each binary. After every
// End Turn the complete turn state, including each assessment receipt with
// decision, must serialize identically, and so must the final score. The
// turn state keeps decisions, not solver numbers, so every raw result
// document the module returns during play is recorded as well and must match
// byte for byte. Run from the repository root:
//
//   node scripts/physics/compare-solver-revisions.mjs <git-revision>
//
// The revision names the commit whose apps/web/src/solver/wasm/dof_solver.wasm
// is the reference. Exits non-zero on the first difference, naming it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const revision = process.argv[2];
if (!revision) throw new Error('Provide the git revision containing the reference binary.');
const path = 'apps/web/src/solver/wasm/dof_solver.wasm';
const reference = execFileSync('git', ['cat-file', 'blob', revision + ':' + path], { maxBuffer: 16 * 1024 * 1024 });
const current = await readFile(path);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// Record each analysis answer: wrap the module's dof_analyze export, which
// returns a pointer to a little-endian length and that many UTF-8 bytes.
const answers = [];
const instantiate = WebAssembly.instantiate.bind(WebAssembly);
WebAssembly.instantiate = async (source, imports) => {
  const made = await instantiate(source, imports);
  const instance = made instanceof WebAssembly.Instance ? made : made.instance;
  const exports = instance.exports;
  const wrapped = {
    ...exports,
    dof_analyze(pointer, length) {
      const output = exports.dof_analyze(pointer, length);
      const size = new DataView(exports.memory.buffer).getUint32(output, true);
      answers.push(new TextDecoder().decode(new Uint8Array(exports.memory.buffer, output + 4, size)));
      return output;
    },
  };
  return made instanceof WebAssembly.Instance ? { exports: wrapped } : { module: made.module, instance: { exports: wrapped } };
};

const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, watch: null }, logLevel: 'error' });
try {
  const { prepareReleaseSolver } = await server.ssrLoadModule('/apps/web/src/game/turnAnalysis.ts');
  const { createTurnGame, activeTurnHand, stageElement, stageConnection, stageLoad, endTurn } =
    await server.ssrLoadModule('/apps/web/src/game/turns.ts');
  const catalogue = 'grow-dusk-release-1';
  const accept = move => { if (!move.ok) throw new Error(move.reason); return move.state; };

  /** Every turn state after End Turn and the final score, for one seed. */
  const play = seed => {
    let state = createTurnGame(seed, catalogue);
    const built = new Map();
    const states = [];
    for (let turn = 1; turn <= 16; turn++) {
      const player = state.playerIndex;
      const loose = seed === 1 && turn >= 5 && !built.has('adverse');
      const hand = activeTurnHand(state);
      const frame = hand.find(c => c.kind === 'element' && c.type === 'heb');
      const fixed = hand.find(c => c.kind === 'connection' && c.profile === 'fixed');
      if (turn < 16 && (loose || !built.has(player)) && frame && fixed) {
        const x = player === 0 ? 5 : 10;
        const id = state.nextId, a = loose ? '6,4,2' : x + ',7,1', b = loose ? '7,4,2' : x + ',8,2';
        state = accept(stageElement(state, frame.id, a, b));
        if (!loose) state = accept(stageConnection(state, fixed.id, id, 'a', a));
        built.set(loose ? 'adverse' : player, id);
      }
      const load = activeTurnHand(state).find(c => c.kind === 'load');
      if (turn < 16 && load && built.size) {
        const id = built.get(player) ?? [...built.values()][0];
        state = accept(stageLoad(state, load.id, 'port:' + id + ':2'));
      }
      state = accept(endTurn(state, turn));
      states.push(JSON.stringify(state));
    }
    return { states, final: JSON.stringify(state.finalScore), reports: state.reports.length };
  };

  const run = async bytes => {
    answers.length = 0;
    await prepareReleaseSolver(async () => bytes);
    const matches = Array.from({ length: 20 }, (_, seed) => play(seed));
    return { matches, answers: [...answers] };
  };
  const { matches: before, answers: referenceAnswers } = await run(reference);
  const { matches: after, answers: currentAnswers } = await run(current);
  assert.ok(referenceAnswers.length > 0, 'No analysis was recorded; the export wrapper did not take effect.');
  assert.equal(currentAnswers.length, referenceAnswers.length, 'The binaries were called a different number of times');
  for (let i = 0; i < referenceAnswers.length; i++)
    assert.equal(currentAnswers[i].replace(/"solverVersion":"[^"]*"/, ''), referenceAnswers[i].replace(/"solverVersion":"[^"]*"/, ''), `analysis ${i + 1}: the result document differs`);
  let turns = 0, reports = 0;
  for (let seed = 0; seed < 20; seed++) {
    for (let turn = 0; turn < before[seed].states.length; turn++) {
      assert.equal(after[seed].states[turn], before[seed].states[turn], `seed ${seed} turn ${turn + 1}: the turn state differs`);
      turns++;
    }
    assert.equal(after[seed].final, before[seed].final, `seed ${seed}: the final score differs`);
    reports += after[seed].reports;
  }
  console.log(JSON.stringify({ reference: digest(reference), current: digest(current), seeds: 20, turnStatesIdentical: turns,
    assessmentReports: reports, resultDocumentsIdentical: currentAnswers.length }));
} finally {
  await server.close();
}
