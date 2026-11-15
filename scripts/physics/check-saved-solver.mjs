// Rebuild confirmed Shared table saves using a previous checked-in WASM
// module and load those exact private records through the current decoder.
// Run from the repository root: node scripts/physics/check-saved-solver.mjs 91d551b
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const revision = process.argv[2];
if (!revision) throw new Error('Provide the git revision containing the earlier binary.');
const path = 'apps/web/src/solver/wasm/dof_solver.wasm';
const previous = execFileSync('git',['cat-file','blob',revision + ':' + path],{maxBuffer:16*1024*1024});
const current = await readFile(path);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const previousHash = digest(previous), currentHash = digest(current);
assert.notEqual(previousHash,currentHash,'The requested revision already has the current WASM.');
const server = await createServer({configFile:false, server:{middlewareMode:true, hmr:false, watch:null}, logLevel:'error'});
try {
  const { prepareReleaseSolver } = await server.ssrLoadModule('/apps/web/src/game/turnAnalysis.ts');
  const { createTurnGame, activeTurnHand, stageElement, stageConnection, stageLoad, endTurn } =
    await server.ssrLoadModule('/apps/web/src/game/turns.ts');
  const { matchRecord, decodePrivateMatch } = await server.ssrLoadModule('/apps/web/src/game/releaseSave.ts');
  const catalogue = 'grow-dusk-release-1';
  const accept = move => { if (!move.ok) throw new Error(move.reason); return move.state; };
  const records = [];
  const archived = new Map();
  const evidenceDir = 'docs/evidence/grow-dusk-release';
  const archivePaths = execFileSync('git',['ls-tree','-r','--name-only',revision,'--',evidenceDir],{encoding:'utf8'}).trim().split(/\r?\n/);
  for (const name of archivePaths) {
    if (!/\/(chrome|edge)\d+-matches\.json$/.test(name)) continue;
    const report = JSON.parse(execFileSync('git',['cat-file','blob',revision+':'+name],{encoding:'utf8'}));
    if (report.solverSha256 === previousHash) {
      for (const match of report.matches) archived.set(match.seed,match);
    }
  }
  let compared = 0;
  await prepareReleaseSolver(async () => previous);
  for (let seed=0; seed<20; seed++) {
    let state = createTurnGame(seed,catalogue), record = matchRecord(state,null,'planning');
    const built = new Map();
    for (let turn=1; turn<=16; turn++) {
      const player = state.playerIndex;
      const loose = seed === 1 && turn >= 5 && !built.has('adverse');
      const hand = activeTurnHand(state);
      const frame = hand.find(c => c.kind === 'element' && c.type === 'heb');
      const fixed = hand.find(c => c.kind === 'connection' && c.profile === 'fixed');
      if (turn < 16 && (loose || !built.has(player)) && frame && fixed) {
        const x = player === 0 ? 5 : 10;
        const id = state.nextId, a = loose ? '6,4,2' : x+',7,1', b = loose ? '7,4,2' : x+',8,2';
        state = accept(stageElement(state,frame.id,a,b));
        if (!loose) state = accept(stageConnection(state,fixed.id,id,'a',a));
        built.set(loose ? 'adverse' : player,id);
      }
      const load = activeTurnHand(state).find(c => c.kind === 'load');
      if (turn < 16 && load && built.size) {
        const id = built.get(player) ?? [...built.values()][0];
        state = accept(stageLoad(state,load.id,'port:'+id+':2'));
      }
      record = matchRecord(state,record,'planning');
      records.push(JSON.stringify(record));
      record = matchRecord(state,record,'assessing');
      records.push(JSON.stringify(record));
      state = accept(endTurn(state,turn));
    }
    records.push(JSON.stringify(matchRecord(state,record,'final')));
    const actual = archived.get(seed);
    if (actual) {
      assert.deepEqual(state.events.reduce((counts,event) => {
        counts[event.kind] = (counts[event.kind] ?? 0) + 1;
        return counts;
      },{}),actual.actions);
      assert.deepEqual(state.reports.map(({status,penalty}) => ({status,penalty})),actual.assessments);
      assert.equal(state.finalScore.totalGravityKN,actual.gravityKN);
      assert.equal(state.finalScore.partial,actual.partial);
      assert.deepEqual(state.finalScore.winners,actual.winners);
      assert.deepEqual(state.finalScore.awards.map(({playerId,awardedShare,penaltyPoints,finalScore}) =>
        ({playerId,awardedShare,penaltyPoints,finalScore})),actual.awards);
      compared++;
    }
  }
  await prepareReleaseSolver(async () => current);
  for (const bytes of records) {
    const decoded = decodePrivateMatch(bytes);
    assert.ok(JSON.stringify(decoded) === bytes, 'Decoded match did not reproduce the original private record.');
  }
  console.log(JSON.stringify({previous:previousHash,current:currentHash,seeds:20,
    priorBrowserMatchesCompared:compared,confirmedRecordsReplayed:records.length}));
} finally {
  await server.close();
}
