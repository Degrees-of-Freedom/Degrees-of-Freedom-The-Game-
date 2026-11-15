// node check.mjs <checkout> <before|after> <Playwright module> <Chrome> <OpenSees origin>
import assert from 'node:assert/strict';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const [checkout, phase, playwright, executablePath, service] = process.argv.slice(2);
assert.ok(['before', 'after'].includes(phase));
const root = resolve(checkout, 'apps/web');
process.env.VITE_OPENSEES_URL = service;
const server = await createServer({root, configFile: join(root, 'vite.config.ts'), server: {host:'127.0.0.1', port:0, hmr:false}});
const browser = await createRequire(import.meta.url)(playwright).chromium.launch({
  executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
try {
  await server.listen();
  const page = await browser.newPage({viewport:{width:1366,height:900},deviceScaleFactor:1});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(new URL('/play', server.resolvedUrls.local[0]).href);
  await page.locator('canvas').first().waitFor();
  await page.evaluate(async () => {
    const {useGameStore} = await import('/src/game/store.ts');
    const {createGameSave} = await import('/src/game/structuralState.ts');
    useGameStore.getState().setMode('creative');
    const state = useGameStore.getState();
    const model = {nextId:3, members:[
      {id:1,type:'shs',a:'1,3,0',b:'2,3,1'},
      {id:2,type:'shs',a:'3,4,1',b:'4,4,1'}],
      attrs:{'1,3,0':{found:true,joint:true},'2,3,1':{joint:true,load:1},'4,4,1':{load:2}}};
    const issue = state.importModel(createGameSave(state.levelId,model));
    if(issue) throw Error(issue);
  });
  await page.getByRole('button',{name:'Fit',exact:true}).click();
  for(const [mode, name] of [['linear','Run simulation'],['nonlinear','Run nonlinear check']]) {
    const waiting = page.waitForResponse(r => r.url() === service + '/analyze');
    await page.getByRole('button',{name,exact:true}).click();
    const data = await (await waiting).json();
    assert.equal(data.status, mode === 'linear' ? 'unstable' : 'unresolved');
    const panel = page.locator('.stability-check');
    if(phase === 'after'){
      const good = data.components.find(c => c.memberIds.includes('1'));
      const floating = data.components.find(c => c.memberIds.includes('2'));
      assert.equal(good.result.status,'success');
      assert.ok(Math.abs(good.result.reactions['1,3,0'][2]-1000) < 1e-4);
      assert.equal(floating.result.status,data.status);
      assert.equal(floating.result.reactions,undefined);
      await panel.getByText(/1 of 2 connected components returned a response/).waitFor();
      await panel.getByText(/Rz.*1000/).waitFor();
    } else assert.equal(data.components,undefined);
    await panel.getByRole('button',{name:'Run nonlinear check'}).waitFor();
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({path:join(dirname(fileURLToPath(import.meta.url)),phase+'-'+mode+'.png')});
    console.log(JSON.stringify({chrome:browser.version(),mode,status:data.status,
      components:data.components?.map(c=>[c.memberIds,c.result.status])}));
  }
  assert.deepEqual(errors,[]);
} finally {await browser.close();await server.close();}
