// node check.mjs <checkout> <before|after> <Playwright module> <Chrome> <OpenSees origin>
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const [checkout, phase, playwright, executablePath, service] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(playwright);
const root = resolve(checkout, 'apps/web');
process.env.VITE_OPENSEES_URL = service;
const server = await createServer({ root, configFile: join(root, 'vite.config.ts'), server: { host: '127.0.0.1', hmr: false } });
const browser = await chromium.launch({ executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  await server.listen();
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(new URL('/play', server.resolvedUrls.local[0]).href);
  await page.locator('canvas').first().waitFor();
  await page.evaluate(async () => {
    const { useGameStore } = await import('/src/game/store.ts');
    const { createGameSave } = await import('/src/game/structuralState.ts');
    useGameStore.getState().setMode('creative');
    const state = useGameStore.getState();
    const model = { nextId: 2, members: [{ id: 1, type: 'shs', a: '3,3,0', b: '5,3,1' }],
      attrs: { '3,3,0': { found: true, joint: true }, '5,3,1': { joint: true, load: 1 } } };
    const error = state.importModel(createGameSave(state.levelId, model));
    if (error) throw Error(error);
  });
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  const linear = page.waitForResponse(response => response.url() === service + '/analyze');
  await page.getByRole('button', { name: 'Run simulation', exact: true }).click();
  if ((await (await linear).json()).status !== 'success') throw Error('Linear comparison failed');
  await page.locator('.stability-check .verdict').waitFor();
  if (phase === 'after') {
    const post = page.waitForResponse(response => response.url() === service + '/analyze');
    await page.getByRole('button', { name: 'Run nonlinear check' }).click();
    const result = await (await post).json();
    if (result.status !== 'success' || result.nonlinear?.segmentsPerFrame !== 8) throw Error(JSON.stringify(result));
    await page.getByRole('heading', { name: 'Nonlinear response' }).waitFor();
    console.log(JSON.stringify({ chrome: browser.version(), fixture: 'diagonal SHS, fixed, 1 kN -Z', nonlinear: result.nonlinear,
      displacement: result.displacements['5,3,1'], reaction: result.reactions['3,3,0'] }));
  }
  await page.locator('.stability-check').scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(dirname(fileURLToPath(import.meta.url)), phase + '.png') });
} finally {
  await browser.close();
  await server.close();
}
