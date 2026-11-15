// Independent normal-Play acceptance for the revised draw and draft lifecycle.
// All writes use visible UI controls. IndexedDB is read only for assertions.
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium, expect} from '@playwright/test';
import {createServer, preview} from 'vite';

const modules = await createServer({configFile: false, server: {middlewareMode: true, hmr: false, watch: null}, logLevel: 'error'});
let legacy;
try {
  const {createTurnGame} = await modules.ssrLoadModule('/apps/web/src/game/turns.ts');
  const {matchRecord} = await modules.ssrLoadModule('/apps/web/src/game/releaseSave.ts');
  legacy = matchRecord(createTurnGame(0, 'grow-dusk-release-1'), null, 'planning');
} finally { await modules.close(); }

const server = await preview({root: resolve('apps/web'), build: {outDir: resolve(process.env.DOF_TEST_DIST ?? 'apps/web/dist')},
  preview: {host: '127.0.0.1', port: 0}});
let browser;
try {
  const base = server.resolvedUrls.local[0];
  const build = await (await fetch(new URL('release-build.json', base))).json();
  browser = await chromium.launch({headless: true, executablePath: process.env.DOF_BROWSER_EXECUTABLE,
    channel: process.env.DOF_BROWSER_CHANNEL,
    args: process.env.DOF_SOFTWARE_GL ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []});
  const context = await browser.newContext({viewport: {width: 1366, height: 900}, reducedMotion: 'reduce'});
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const button = name => page.getByRole('button', {name, exact: true});
  const ready = button('Ready · Reveal my hand');
  const head = () => page.evaluate(async () => {
    const request = indexedDB.open('dof-grow-dusk');
    const db = await new Promise((resolve, reject) => {request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});
    try {
      const read = db.transaction('match').objectStore('match').get('head');
      const bytes = await new Promise((resolve, reject) => {read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error);});
      return JSON.parse(bytes);
    } finally { db.close(); }
  });
  const drawCount = record => {
    const receipt = record.turn.draws?.find(draw => draw.turn === record.turn.turn);
    return receipt ? receipt.pieces.length + receipt.connectors.length + (receipt.loads?.length ?? 0) : 0;
  };
  const draw = async (source, count) => {
    await page.locator(`[data-deck="${source}"]`).click();
    await expect.poll(async () => drawCount(await head()), {timeout: 20000}).toBe(count);
    if (count < 4) await expect(page.getByText(`${count} of 4 drawn · any mix of decks`, {exact: true})).toBeVisible();
    else await expect(page.locator('[data-deck]')).toHaveCount(0);
  };
  const stageMember = async (a, b) => {
    await page.locator('[data-kind="element"]').first().click();
    await page.getByText('Precise placement', {exact: true}).click();
    if (a.startsWith('port:')) await page.getByLabel('End A port').selectOption(a);
    else await page.getByLabel('End A grid x,y,z').fill(a);
    await page.getByLabel('End B grid x,y,z').fill(b);
    await button('Stage element').click();
  };
  await page.goto(base + '?seed=0');
  await page.getByRole('link', {name: 'Play', exact: true}).click();
  await page.waitForURL(url => url.pathname === '/match');
  await ready.click();
  await expect(page.getByRole('region', {name: 'Draw four cards'})).toBeVisible();
  await expect(button('Pass')).toBeDisabled();
  await draw('members', 1); await draw('members', 2);
  const partial = await head();
  await page.reload();
  await ready.click();
  const restored = await head();
  assert.equal(restored.matchId, partial.matchId);
  assert.deepEqual(restored.turn, partial.turn);
  await draw('members', 3); await draw('members', 4);
  const fullDraw = await head();
  assert.equal(fullDraw.turn.players[0].hand.length, 4);
  assert.ok(fullDraw.turn.players[0].hand.every(card => card.kind === 'element' && card.type === 'heb'));
  await stageMember('2,2,1', '3,2,1');
  await expect.poll(async () => (await head()).turn.draft.members.length).toBe(1);
  await stageMember('2,4,1', '3,4,1');
  await expect.poll(async () => (await head()).turn.draft.members.length).toBe(2);
  await button('Inspect').click();
  await page.getByLabel('Inspect member').selectOption('4');
  await page.getByLabel('Draft end x,y,z').fill('4,4,1');
  await button('Update draft member').click();
  await expect.poll(async () => (await head()).turn.draft.members[1].b).toBe('4,4,1');
  await button('Close inspection').click();
  await page.locator('.release-title h1').click();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await head()).turn.draft.members.length).toBe(1);
  await stageMember('2,4,1', '3,4,1');
  await expect.poll(async () => (await head()).turn.draft.members.length).toBe(2);
  await stageMember('port:3:2', '4,3,1');
  await expect.poll(async () => (await head()).turn.draft.members.length).toBe(3);
  assert.deepEqual((await head()).turn.draft.members[2].endTargets, {a: 'port:3:2'});
  const beforeCrossing = await head();
  await stageMember('3,1,1', '3,5,1');
  await expect(page.getByRole('status').filter({hasText: /intersect material/})).toBeVisible();
  assert.deepEqual((await head()).turn, beforeCrossing.turn);
  await button('Cancel targeting').click();
  const staged = await head();
  assert.deepEqual(staged.turn.draws, fullDraw.turn.draws);
  assert.deepEqual(staged.turn.decks, fullDraw.turn.decks);
  await button('End turn').click(); await ready.click();
  await expect.poll(async () => (await head()).turn.turn).toBe(2);
  for (let i = 1; i <= 4; i++) await draw('loads', i);
  for (let i = 0; i < 3; i++) {
    await page.locator('[data-kind="load"]').first().click();
    await page.getByLabel('Load target').selectOption('endpoint:3:b');
    await button('Place load').click();
    await expect.poll(async () => (await head()).turn.draft.loads.length).toBe(i + 1);
  }
  const loaded = await head();
  await button('Cancel draft').click();
  await expect.poll(async () => (await head()).turn.draft.loads.length).toBe(0);
  const cancelled = await head();
  assert.deepEqual(cancelled.turn.draws, loaded.turn.draws);
  assert.deepEqual(cancelled.turn.decks, loaded.turn.decks);
  assert.equal(cancelled.turn.players[1].hand.length, 4);
  await page.reload(); await ready.click();
  assert.deepEqual((await head()).turn, cancelled.turn);
  const output = resolve(process.env.DOF_EVIDENCE_DIR ?? '.venv/revised-independent');
  await mkdir(output, {recursive: true});
  await page.screenshot({path: resolve(output, 'four-load-draw-reloaded.png')});
  const openFiles = async () => {await button('Menu').click(); await button('Save files').click();};
  const importPrivate = async bytes => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), button('Import private match').click()]);
    await chooser.setFiles({name: 'synthetic-private.json', mimeType: 'application/json', buffer: bytes});
    await button('Validate and replace').click(); await ready.click();
  };
  await openFiles();
  const [download] = await Promise.all([page.waitForEvent('download'), button('Export private match').click()]);
  const revisedBytes = await readFile(await download.path());
  await importPrivate(Buffer.from(JSON.stringify(legacy)));
  const importedLegacy = await head();
  assert.equal(importedLegacy.matchId, legacy.matchId);
  assert.deepEqual(importedLegacy.turn, legacy.turn);
  assert.equal(await page.locator('[data-deck]').count(), 0);
  await openFiles(); await importPrivate(revisedBytes);
  const importedRevised = await head();
  assert.equal(importedRevised.matchId, cancelled.matchId);
  assert.deepEqual(importedRevised.turn, cancelled.turn);
  await button('Menu').click(); await button('Restart').click(); await button('Cancel').click();
  assert.deepEqual((await head()).turn, cancelled.turn);
  assert.deepEqual(errors, []);
  const structural = await structuralReview(browser, base, output);
  const result = {...build, browser: browser.version(), seed: 0, checks: [
    'normal Play starts four deliberate three-deck choices',
    'partial draw reload preserves match, cards and remaining choices',
    'four member choices yield opening standard members',
    'multiple members stage without a per-type allowance',
    'provisional endpoint edit persists and Ctrl+Z undoes one placement',
    'undo preserves original draws and undealt decks',
    'a diagonal T junction can target an original quarter of an already staged member',
    'a genuine interior crossing is rejected without card consumption or draft changes',
    'four load choices and three staged loads are legal',
    'draft cancel/reload restores all held loads without extra draws',
    'genuine legacy private import preserves its original two-deck state',
    'revised private export/import restores chosen draws and held cards',
    'restart cancellation preserves the confirmed match',
  ], structural, errors};
  await writeFile(resolve(output, 'draw-and-draft-review.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await context.close();
} finally {
  await browser?.close();
  await new Promise(resolveClose => server.httpServer.close(resolveClose));
}

async function structuralReview(browser, base, output) {
  const context = await browser.newContext({viewport: {width: 1366, height: 900}, reducedMotion: 'reduce'});
  const page = await context.newPage();
  const errors = [];
  const wasmResponses = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (/\/dof_solver[^/]*\.wasm(?:\?|$)/.test(response.url())) wasmResponses.push({url: response.url(), status: response.status()});
  });
  page.setDefaultTimeout(20000);
  const button = name => page.getByRole('button', {name, exact: true});
  const ready = button('Ready · Reveal my hand');
  const head = () => page.evaluate(async () => {
    const request = indexedDB.open('dof-grow-dusk');
    const db = await new Promise(resolve => {request.onsuccess = () => resolve(request.result);});
    try {
      const read = db.transaction('match').objectStore('match').get('head');
      return JSON.parse(await new Promise(resolve => {read.onsuccess = () => resolve(read.result);}));
    } finally { db.close(); }
  });
  const draw = async sources => {
    for (let i = 0; i < sources.length; i++) {
      await page.locator(`[data-deck="${sources[i]}"]`).click();
      await expect.poll(async () => {
        const record = await head();
        const receipt = record.turn.draws.find(draw => draw.turn === record.turn.turn);
        return receipt.pieces.length + receipt.connectors.length + (receipt.loads?.length ?? 0);
      }, {timeout: 20000}).toBe(i + 1);
      if (i < 3) await expect(page.getByText(`${i + 1} of 4 drawn · any mix of decks`, {exact: true})).toBeVisible();
      else await expect(page.locator('[data-deck]')).toHaveCount(0);
    }
  };
  try {
    await page.goto(base + '?seed=0');
    await page.getByRole('link', {name: 'Play', exact: true}).click(); await ready.click();
    await draw(['members', 'connections', 'connections', 'loads']);
    const hand = page.getByRole('region', {name: 'Active hand'});
    await hand.locator('[data-kind="element"]').first().click();
    await page.getByText('Precise placement', {exact: true}).click();
    await page.getByLabel('End A grid x,y,z').fill('5,7,1');
    await page.getByLabel('End B grid x,y,z').fill('6,7,1'); await button('Stage element').click();
    await hand.locator('[data-kind="connection"]').filter({hasText: 'Fixed connector'}).first().click();
    await page.getByLabel('Connection target').selectOption(JSON.stringify([3, 'a', '5,7,1']));
    await button('Attach end').click();
    await hand.locator('[data-kind="load"]').first().click();
    await page.getByLabel('Load target').selectOption('port:3:2'); await button('Place load').click();
    await button('End turn').click(); await ready.click();
    await expect.poll(async () => (await head()).turn.turn).toBe(2);
    assert.equal((await head()).turn.reports[0].status, 'pending');
    await button('Inspect').click();
    await expect(page.getByText('Current changes are assessed at the next scheduled checkpoint.', {exact: false})).toBeVisible();
    await page.getByRole('button', {name: 'Close inspection', exact: true}).click();
    assert.deepEqual(wasmResponses, [], 'pending first turn must not request numerical WASM');
    await draw(['connections', 'connections', 'connections', 'connections']);
    await button('Pass').click(); await ready.click();
    await draw(['loads', 'loads', 'loads', 'loads']);
    assert.deepEqual(wasmResponses, [], 'draws and both pending End transitions must not request numerical WASM');
    await button('Pass').click(); await ready.click();
    await expect.poll(async () => (await head()).turn.turn).toBe(4);
    await expect(page.getByRole('complementary', {name: 'Analysis legend'})).toBeVisible();
    assert.ok(wasmResponses.some(response => response.status === 200), 'the due third-turn checkpoint must load the real numerical WASM');
    await expect(button('Load paths')).toHaveAttribute('aria-pressed', 'true');
    await expect(button('Deformation')).toHaveAttribute('aria-pressed', 'true');
    const record = await head();
    assert.equal(record.turn.checkpoints.receipts.length, 1);
    assert.equal(record.turn.checkpoints.lastAnalysis.turn, 3);
    assert.ok(record.turn.reports.every(report => report.status !== 'pending'));
    await button('Shear').click(); await button('Bending').click();
    await page.screenshot({path: resolve(output, 'verified-load-path-and-diagrams.png')});
    const labels = page.getByLabel('Reaction labels');
    await labels.selectOption('off'); await labels.selectOption('large');
    await button('Inspect').click();
    await page.getByLabel('Inspect member').selectOption('3');
    await expect(page.getByText('Committed member · read only')).toBeVisible();
    await expect(page.getByLabel('Draft end x,y,z')).toHaveCount(0);
    await page.getByText('Foundation forces and moments', {exact: true}).click();
    const reactionTables = page.getByRole('table').filter({has: page.getByText('Signed global support reaction', {exact: true})});
    const reactions = await reactionTables.allTextContents();
    assert.equal(reactions.length, 2);
    await reactionTables.last().scrollIntoViewIfNeeded();
    await page.screenshot({path: resolve(output, 'signed-support-reactions.png')});
    assert.deepEqual((await head()).turn, record.turn);
    assert.deepEqual(errors, []);
    return {checks: ['numerical WASM is first requested at the due third-turn checkpoint',
      'real member/connector/gravity plays become a checkpoint after three player turns',
      'normal board exposes calculated deflection and load paths automatically',
      'shear and bending overlays combine with calculated response',
      'reaction labels support Off and Large',
      'committed member is read-only and foundation six-component tables are inspectable',
      'overlay and reaction settings preserve authoritative match state'], reactions, wasmResponses, errors};
  } finally { await context.close(); }
}
