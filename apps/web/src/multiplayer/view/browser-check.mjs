/** Optional standalone browser acceptance check. No production or package configuration changes. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// Install Playwright outside this repository or provide its module URL explicitly.
const { chromium } = await import(process.env.DOF_PLAYWRIGHT_MODULE || 'playwright');
const output = resolve(process.env.DOF_VIEW_EVIDENCE || 'docs/implementation-handoffs/session-3-evidence');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.DOF_CHROMIUM || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(process.env.DOF_VIEW_URL || 'http://127.0.0.1:5174/src/multiplayer/view/preview.html');
  await page.locator('.mp-inspector h2').waitFor();
  assert.match(await page.locator('.mp-inspector').innerText(), /effective k = 10000/);
  assert.equal(await page.getByRole('button', { name: 'Apply draft endpoint' }).count(), 0);
  const canvasChangesOverFrames = () => page.evaluate(async () => {
    const canvas = document.querySelector('.mp-overlay');
    for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
    const before = canvas.toDataURL();
    for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
    return before !== canvas.toDataURL();
  });
  assert.equal(await canvasChangesOverFrames(), true, 'Current load flow must animate in normal motion');
  const mode = await page.locator('.mp-render-mode').count() ? 'projected fallback' : 'WebGL';
  await page.getByRole('button', { name: 'Toggle stale checkpoint' }).click();
  assert.match(await page.locator('.mp-scene-status').innerText(), /current structure not yet analyzed/);
  assert.match(await page.locator('.mp-inspector').innerText(), /No current segment results/);
  await page.getByRole('button', { name: 'Toggle stale checkpoint' }).click();
  await page.getByRole('button', { name: 'Reduced motion: off' }).click();
  assert.equal(await canvasChangesOverFrames(), false, 'Reduced motion must retain static directional arrows');
  await page.getByLabel('Section scale', { exact: true }).selectOption('true');
  assert.match(await page.locator('.mp-scene-status').innerText(), /true scale/);
  await page.getByLabel('Section scale', { exact: true }).selectOption('readable');
  await page.getByLabel('Joint DOFs').selectOption('all');
  await page.screenshot({ path: resolve(output, 'desktop.png'), fullPage: true });

  await page.getByRole('button', { name: 'Placement targets: off' }).click();
  const targets = page.getByLabel('Legal placement target');
  assert.ok(await targets.locator('option').count() > 1000);
  await targets.selectOption('beam@0.5');
  await page.getByRole('button', { name: 'Use target', exact: true }).click();
  assert.match(await page.locator('.mp-preview-target').innerText(), /beam@0.5/);
  const canvas = page.locator('.mp-overlay');
  await canvas.focus(); await canvas.press('ArrowRight');
  const focused = await targets.inputValue(); assert.ok(focused);
  await canvas.press('Enter');
  assert.ok((await page.locator('.mp-preview-target').innerText()).includes(focused));
  const rect = await canvas.boundingBox();
  await page.mouse.move(rect.x + rect.width * 0.5, rect.y + rect.height * 0.5);
  await page.screenshot({ path: resolve(output, 'targets.png'), fullPage: true });
  await page.getByRole('button', { name: 'Placement targets: on' }).click();
  await page.getByRole('button', { name: 'Inspect editable draft' }).click();
  await page.getByLabel('Draft end X').fill('7.5'); await page.getByLabel('Draft end Y').fill('12'); await page.getByLabel('Draft end Z').fill('6');
  await page.getByRole('button', { name: 'Apply draft endpoint' }).click();
  assert.match(await page.locator('.mp-inspector').innerText(), /3\.000 \/ 5 game units/);
  await page.getByLabel('Draft end X').fill('15'); await page.getByLabel('Draft end Y').fill('15'); await page.getByLabel('Draft end Z').fill('12');
  await page.getByRole('button', { name: 'Apply draft endpoint' }).click();
  assert.match(await page.locator('.mp-inspector .mp-error').innerText(), /printed maximum/);
  await page.getByLabel('Inspect an element').selectOption('column-A');
  assert.match(await page.locator('.mp-inspector').innerText(), /Locked starting column/);
  assert.equal(await page.getByRole('button', { name: 'Apply draft endpoint' }).count(), 0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Inspect editable draft' }).click();
  await page.getByLabel('Draft end X').fill('7.5'); await page.getByLabel('Draft end Y').fill('12'); await page.getByLabel('Draft end Z').fill('6');
  await page.getByRole('button', { name: 'Apply draft endpoint' }).click();
  const sizes = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
  assert.ok(sizes.content <= sizes.width, `Horizontal overflow: ${JSON.stringify(sizes)}`);
  await page.screenshot({ path: resolve(output, 'narrow.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ mode, desktop: '1440x1000', narrow: '390x844', checks: 'inspector permissions, draft length guard, stale results, quarter target, keyboard target sync, no horizontal overflow', pageErrors: errors, output }, null, 2));
} finally { await browser.close(); }
