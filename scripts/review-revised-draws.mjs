// Independent normal-Play acceptance for the revised draw and draft lifecycle.
// All writes use visible UI controls. IndexedDB is read only for assertions.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium, expect} from '@playwright/test';
import {preview} from 'vite';

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
    await expect.poll(async () => drawCount(await head())).toBe(count);
  };
  const stageMember = async (a, b) => {
    await page.locator('[data-kind="element"]').first().click();
    await page.getByText('Precise placement', {exact: true}).click();
    await page.getByLabel('End A grid x,y,z').fill(a);
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
  assert.deepEqual(errors, []);
  const output = resolve(process.env.DOF_EVIDENCE_DIR ?? '.venv/revised-independent');
  await mkdir(output, {recursive: true});
  await page.screenshot({path: resolve(output, 'four-load-draw-reloaded.png')});
  const result = {...build, browser: browser.version(), seed: 0, checks: [
    'normal Play starts four deliberate three-deck choices',
    'partial draw reload preserves match, cards and remaining choices',
    'four member choices yield opening standard members',
    'multiple members stage without a per-type allowance',
    'provisional endpoint edit persists and Ctrl+Z undoes one placement',
    'undo preserves original draws and undealt decks',
    'four load choices and three staged loads are legal',
    'draft cancel/reload restores all held loads without extra draws',
  ], errors};
  await writeFile(resolve(output, 'draw-and-draft-review.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await context.close();
} finally {
  await browser?.close();
  await new Promise(resolveClose => server.httpServer.close(resolveClose));
}
