// All match mutations go through Play. The persisted draft provides the input
// for a separate read-only inspection of its production SI solver model.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium, expect} from '@playwright/test';
import {createServer, preview} from 'vite';

const seed = 323;
const output = resolve(process.env.DOF_EVIDENCE_DIR ?? '.venv/local-release-review');
const dist = resolve(process.env.DOF_TEST_DIST ?? 'apps/web/dist');
const server = await preview({root: resolve('apps/web'), build: {outDir: dist}, preview: {host: '127.0.0.1', port: 0}});
const near = (a, b) => assert.ok(Math.abs(a-b) < 1e-10, `Expected ${a} ≈ ${b}`);
const compareMatrix = (a, b) => {
  assert.equal(a.length, 3);
  a.forEach((axis, i) => {assert.equal(axis.length, 3); axis.forEach((value, j) => near(value, b[i][j]));});
};
const s = Math.SQRT1_2, q = Math.sqrt(5);
// Hand-calculated row bases: A→B, horizontal transverse, right-hand normal.
const frames = {
  3: [[s,s,0],[-s,s,0],[0,0,1]],
  4: [[-s,s,0],[-s,-s,0],[0,0,1]],
  5: [[2/3,-1/3,2/3],[1/q,2/q,0],[-4/(3*q),2/(3*q),q/3]],
  6: [[-1/q,-2/q,0],[2/q,-1/q,0],[0,0,1]],
};

let browser, page;
try {
  await mkdir(output, {recursive: true});
  const base = server.resolvedUrls.local[0];
  const build = await (await fetch(new URL('release-build.json', base))).json();
  browser = await chromium.launch({headless:true, executablePath:process.env.DOF_BROWSER_EXECUTABLE,
    args:process.env.DOF_SOFTWARE_GL ? ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] : []});
  const context = await browser.newContext({viewport:{width:1366,height:900}, reducedMotion:'reduce'});
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [], rejected = [], previews = [];
  page.on('pageerror', error => errors.push(error.message));
  const button = name => page.getByRole('button', {name, exact:true});
  const ready = button('Ready · Reveal my hand');
  const record = () => page.evaluate(async () => {
    function request(op) {
      return new Promise((resolveRead, reject) => {
        op.onsuccess = () => resolveRead(op.result);
        op.onerror = () => reject(op.error);
      });
    }
    const db = await request(indexedDB.open('dof-grow-dusk'));
    try {return JSON.parse(await request(db.transaction('match').objectStore('match').get('head')));}
    finally {db.close();}
  });
  async function draw(decks) {
    for (let i = 0; i < decks.length; i++) {
      await page.locator(`[data-deck="${decks[i]}"]`).click();
      await expect.poll(async () => {
        const {turn} = await record();
        const draw = turn.draws.find(row => row.turn === turn.turn);
        return draw ? draw.pieces.length + draw.connectors.length + draw.loads.length : 0;
      }).toBe(i+1);
    }
    await expect(page.locator('[data-deck]')).toHaveCount(0);
  }
  async function member(id, a, b) {
    await page.locator('[data-kind="element"]').first().click();
    await page.getByText('Precise placement', {exact:true}).click();
    if (a.startsWith('port:')) await page.getByLabel('End A port').selectOption(a);
    else await page.getByLabel('End A grid x,y,z').fill(a);
    await page.getByLabel('End B grid x,y,z').fill(b);
    await button('Stage element').click();
    await expect.poll(async () => (await record()).turn.draft.members.at(-1)?.id).toBe(id);
  }
  async function attach(id, end, jointId, label, profile, incompatible) {
    await page.locator('[data-kind="connection"]').filter({hasText:label}).first().click();
    const target = page.getByLabel('Connection target');
    const key = JSON.stringify([id,end,jointId]);
    await target.selectOption(key);
    const axes = page.getByLabel('Member local axes', {exact:true});
    await expect(axes).toContainText(`Member ${id} local axes`);
    for (const axis of frames[id]) await expect(axes).toContainText('(' + axis.map(v => +v.toFixed(3)).join(', ') + ')');
    if (profile !== 'fixed') {
      const picker = page.getByLabel('Local rotational locks');
      if (incompatible) {
        const before = await record();
        await picker.selectOption(incompatible);
        await expect(target).toHaveValue(key);
        await expect(button('Attach end')).toBeDisabled();
        const warning = page.getByRole('status').filter({hasText:'Incompatible joint profiles'});
        await expect(warning).toContainText(jointId);
        rejected.push({id, end, joint:jointId, rejectedProfile:incompatible, message:await warning.innerText()});
        assert.deepEqual((await record()).turn, before.turn);
      }
      await picker.selectOption(profile);
      await expect(target).toHaveValue(key);
      await expect(button('Attach end')).toBeEnabled();
      previews.push({id, profile, directions:await axes.innerText()});
      if (id === 5) await page.screenshot({path:resolve(output, 'local-axes-target.png')});
    }
    await button('Attach end').click();
    await expect.poll(async () => (await record()).turn.draft.connections.at(-1)?.profile).toBe(profile);
    const current = (await record()).turn;
    const connection = current.draft.connections.find(c => c.memberId === id && c.end === end);
    assert.equal(connection.jointId, jointId);
    assert.equal(connection.frameVersion, 'member-local-1');
    compareMatrix(connection.axes, frames[id]);
    const event = current.events.find(e => e.kind === 'connection' && e.cardId === connection.cardId);
    assert.equal(event.frameVersion, connection.frameVersion);
    assert.deepEqual(event.axes, connection.axes);
  }
  async function end(turn) {
    await button('End turn').click(); await ready.click();
    await expect.poll(async () => (await record()).turn.turn, {timeout:20000}).toBe(turn+1);
  }
  await page.goto(base + '?seed=' + seed);
  await page.getByRole('link', {name:'Play',exact:true}).click(); await ready.click();

  await draw(['members','connections','connections','loads']);
  await member(3,'5,7,1','7,9,1');
  await attach(3,'a','5,7,1','Fixed connector','fixed');
  await attach(3,'b','7,9,1','Lock one axis','lock-x');
  await page.locator('[data-kind="load"]').first().click();
  await page.getByLabel('Load target').selectOption('port:3:2');
  await button('Place load').click();
  await expect.poll(async () => (await record()).turn.draft.loads.length).toBe(1);
  await end(1);
  await draw(['members','members','connections','connections']);
  await member(4,'7,9,1','5,11,1');
  await member(5,'port:3:2','8,7,3');
  await attach(4,'a','7,9,1','Lock one axis','lock-y','lock-x');
  await attach(5,'a','port:3:2','Lock two axes','lock-xz');
  await end(2);
  await draw(['members','connections','connections','connections']);
  await member(6,'port:3:2','5,6,1');
  await attach(6,'a','port:3:2','Lock two axes','lock-yz','lock-xz');
  const before = await record();
  const solverEnds = await inspectSolverEnds(before.turn);
  await page.reload(); await ready.click();
  assert.deepEqual((await record()).turn, before.turn);
  await end(3);
  const committed = await record();
  assert.equal(committed.turn.checkpoints.lastAttemptTurn, 3);
  const originals = committed.turn.board.connections.filter(c => c.memberId >= 3);
  assert.equal(originals.length, 5);
  for (const connection of originals) compareMatrix(connection.axes, frames[connection.memberId]);
  await page.reload(); await ready.click();
  assert.deepEqual((await record()).turn, committed.turn);
  await button('Inspect').click();
  await page.getByLabel('Inspect member').selectOption('5');
  await page.getByText('End A connection axes', {exact:true}).click();
  await expect(page.getByText('Member-local axes, expressed in global X, Y, Z', {exact:true})).toBeVisible();
  await expect(page.getByText('X (0.667, -0.333, 0.667)', {exact:true})).toBeVisible();
  await page.screenshot({path:resolve(output, 'local-axes-inspection.png')});
  assert.deepEqual(errors, []);
  const evidence = {build, browser:browser.version(), seed, rejected, previews, originals, solverEnds,
    checkpoint:committed.turn.checkpoints.lastAttemptTurn, draftReload:true, committedReload:true, pageErrors:errors};
  await writeFile(resolve(output,'local-releases.json'), JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({build, seed, compatible:previews.length, rejected:rejected.length, solverEnds:solverEnds.length}));
} catch (error) {
  if (page && !page.isClosed()) {
    console.error(await page.locator('h1, [role="status"], .release-targets').allTextContents());
    await page.screenshot({path:resolve(output,'local-releases-failed.png')}).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close();
  await new Promise(closed => server.httpServer.close(closed));
}

async function inspectSolverEnds(turn) {
  // Compile the saved Play board through the same physical model builder as
  // WASM. Inspect the draft before any checkpoint correction can add a sleeve.
  const modules = await createServer({configFile:false, server:{middlewareMode:true, hmr:false, watch:null}, logLevel:'error'});
  try {
    const {toTurnVoxelInput} = await modules.ssrLoadModule('/apps/web/src/game/turnAnalysis.ts');
    const {prepareTurnGeometry} = await modules.ssrLoadModule('/apps/web/src/solver/voxel.ts');
    const {turnReferenceModel} = await modules.ssrLoadModule('/apps/web/src/solver/wasm/turnSolver.ts');
    const input = toTurnVoxelInput(turn);
    const model = turnReferenceModel(input, prepareTurnGeometry(input).ctx, turn.catalogue);
    const scenarios = [[3,'end','7,9,1','rff'], [4,'start','7,9,1','frf'],
      [5,'start','port:3:2','rfr'], [6,'start','port:3:2','frr']];
    const output = scenarios.map(([id,side,joint,rotations]) => {
      const segment = model.members.find(m => m.parentId === String(id) && m[side+'NodeId'] === joint);
      const attachment = segment[side];
      compareMatrix(attachment.axes, frames[id]);
      assert.deepEqual(attachment.laws, ['rigid','rigid','rigid', ...[...rotations].map(c => c === 'r' ? 'rigid' : 'free')]);
      // A projector expresses each locked angular subspace in world
      // coordinates, even when the two card labels use different letters.
      const projection = frames[id].map((_,i) => frames[id].map((_,j) => attachment.axes.reduce((v,axis,k) =>
        v + (attachment.laws[k+3] === 'rigid' ? axis[i]*axis[j] : 0), 0)));
      return {member:id, segment:segment.id, joint, side, attachment, projection};
    });
    compareMatrix(output[0].projection, output[1].projection);
    compareMatrix(output[2].projection, output[3].projection);
    near(output[0].projection[0][1], .5);
    near(output[2].projection[0][1], -.4);
    return output;
  } finally {await modules.close();}
}
