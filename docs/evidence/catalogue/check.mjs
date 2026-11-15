// node check.mjs <repository root> <before|after|strength> <playwright module> <Chrome executable>
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const [repository, phase, playwright, executablePath] = process.argv.slice(2);
assert.ok(['before', 'after', 'strength'].includes(phase));
const root = resolve(repository, 'apps/web');
const server = await createServer({ root, configFile: resolve(root, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
const { chromium } = createRequire(import.meta.url)(playwright);
const browser = await chromium.launch({ executablePath, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  await server.listen();
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('dof.settings', JSON.stringify({ sound: false, reducedMotion: true, showHelpOnStart: false }));
    localStorage.setItem('dof-runtime:session', JSON.stringify({
      version: 1, mode: 'multiplayer', style: 'grow-dusk', turn: { version: 1, seed: 5, events: [] },
    }));
  });
  await page.goto(new URL('/play', server.resolvedUrls.local[0]).href);
  if (phase !== 'before') await page.getByRole('button', { name: 'Ready · Reveal my hand' }).click();
  await page.getByRole('button', { name: 'Turn details' }).click();
  if (phase === 'before') await page.getByRole('button', { name: /Reveal Player 1/ }).click();
  const hand = page.getByLabel('player-1 hand');
  await hand.getByRole('button', { name: /IPE/ }).click();
  if (phase !== 'before') {
    await page.getByText('Printed card properties', { exact: true }).click();
    const contents = await page.locator('details[open]').filter({ hasText: 'Printed card properties' }).innerText();
    for (const value of ['IPE 300', '210 GPa', '8 m on each grid axis', 'flange 10.7 mm', 'element/ipe/axis-4', 'playtest-1']) {
      assert.ok(contents.includes(value), value);
    }
    if (phase === 'strength') {
      assert.ok(contents.includes('355 / 355 / 355 / 205 MPa'));
      assert.ok(contents.includes('Torsion limit 3.5 kN·m · card-strength-1'));
    }
  } else {
    assert.equal(await page.getByText('Printed card properties').count(), 0);
  }
  await page.mouse.move(0, 0);
  await page.screenshot({ path: fileURLToPath(new URL(phase + '.png', import.meta.url)) });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ phase, seed: 5, chrome: browser.version(), result: 'passed' }));
} finally {
  await browser.close();
  await server.close();
}
