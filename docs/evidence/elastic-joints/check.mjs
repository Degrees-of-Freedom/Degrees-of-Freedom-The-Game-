// node check.mjs <repo or archived repo> <before|after> <playwright module> <Chrome executable>
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';

const [work,phase,playwright,executablePath] = process.argv.slice(2);
assert.ok(['before','after'].includes(phase));
const root = resolve(work,'apps/web'), out = dirname(fileURLToPath(import.meta.url));
const server = await createServer({root,configFile:resolve(root,'vite.config.ts'),server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
const {chromium} = createRequire(import.meta.url)(playwright);
const browser = await chromium.launch({executablePath,headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  await server.listen();
  const page = await browser.newPage({viewport:{width:1366,height:900},deviceScaleFactor:1});
  page.setDefaultTimeout(20000);
  const errors=[];
  page.on('pageerror',err=>errors.push(err.message));
  await page.goto(new URL('/setup/multiplayer',server.resolvedUrls.local[0]).href);
  if (phase==='after') await page.getByLabel('Physical catalogue').selectOption('shared-table-joints-1');
  await page.getByRole('button',{name:'Start',exact:true}).click();
  const ready = page.getByRole('button',{name:'Ready · Reveal my hand'});
  for(let i=1;i<=5;i++) {
    await ready.click();
    await page.getByRole('button',{name:'End turn',exact:true}).click();
  }
  await ready.click();
  await page.getByRole('button',{name:'Turn details'}).click();
  const panel = page.getByLabel('Shared-table turn');
  const hand = page.getByLabel('player-2 hand');
  const state = () => page.evaluate(async() => (await import('/src/game/store.ts')).useGameStore.getState().turn);
  await hand.getByRole('button',{name: phase==='after' ? /Elastic seat · 20 MN\/m/ : /Fixed \/ moment/}).first().click();
  await panel.getByText('Printed card properties',{exact:true}).click();
  await page.mouse.move(0,0);
  await page.screenshot({path:resolve(out,phase+'-printing.png')});
  if (phase==='after') {
    assert.ok((await panel.innerText()).includes('400 kN resultant force'));
    await hand.getByRole('button',{name:/GLULAM/}).first().click();
    const form = panel.locator('details').filter({hasText:'Quarter-point placement'});
    await form.locator('summary').click();
    await form.getByLabel('End A grid x,y,z').fill('1,3,1');
    await form.getByLabel('End B grid x,y,z').fill('1,3,2');
    await form.getByRole('button',{name:'Stage element'}).click();
    for(const [name,side] of [[/Fixed \/ moment/,'A'],[/Elastic seat · 20 MN\/m/,'B']]) {
      await hand.getByRole('button',{name}).first().click();
      await panel.getByRole('button',{name:new RegExp('Member 3 · end '+side)}).first().click();
    }
    await hand.getByRole('button',{name:/10 kN down/}).first().click();
    await panel.getByLabel('Load at joint').selectOption('1,3,2');
    await panel.getByRole('button',{name:'End turn / pass'}).click();
    await ready.waitFor();
    const built = await state();
    assert.equal(built.board.connections.at(-1).profile,'seat-20');
    assert.equal(built.board.loads.at(-1).magnitude,10);
    await page.reload();
    await ready.waitFor();
    assert.deepEqual((await state()).events,built.events);
    await ready.click();
    const observed = await page.evaluate(async() => {
      const game = (await import('/src/game/store.ts')).useGameStore.getState();
      const result = (await import('/src/game/turnAnalysis.ts')).analyzeTurn(game.turn,'card-gravity');
      const e = result.ctx.els.find(e=>e.m.id===3), combo = result.combos[0];
      const end = (await import('/src/solver/frameMath.ts')).vecToGlobal(combo.ef.get(e).ul,e.R);
      const base = result.ctx.aid[result.ctx.idx.get('1,3,0')];
      return {slipM:combo.u[6*e.b+2]-end[8],reactionKN:combo.reac[base][2],capacity:result.capacity.connections['3:b'].utilization};
    });
    assert.ok(Math.abs(observed.slipM+0.0005)<1e-10);
    assert.ok(Math.abs(observed.reactionKN-10)<1e-8);
    assert.ok(Math.abs(observed.capacity-0.025)<1e-8);
    console.log(JSON.stringify(observed));
  }
  assert.deepEqual(errors,[]);
  console.log(phase,browser.version(),'seed 1');
} finally {await browser.close();await server.close();}
