// node check.mjs <workspace> <Playwright module> <Chrome executable> <before|after> [trichord]
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const [workspace, playwright, executablePath, phase, family = 'planar'] = process.argv.slice(2);
assert.ok(['planar','trichord'].includes(family));
const trichord = family === 'trichord';
const root = resolve(workspace,'apps/web'), out = resolve(dirname(fileURLToPath(import.meta.url)),'..',family);
const server = await createServer({root,configFile:resolve(root,'vite.config.ts'),server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
const {chromium} = createRequire(import.meta.url)(playwright);
const browser = await chromium.launch({executablePath,headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  await server.listen();
  const page = await browser.newPage({viewport:{width:1366,height:900},deviceScaleFactor:1});
  page.setDefaultTimeout(16000);
  const errors = [];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(new URL('/setup/multiplayer',server.resolvedUrls.local[0]).href);
  if (phase === 'after' || trichord) await page.getByLabel('Physical catalogue').selectOption(
    trichord && phase === 'after' ? 'shared-table-trusses-1' : 'shared-table-planar-1');
  await page.screenshot({path:resolve(out,phase+'-setup.png')});
  await page.getByRole('button',{name:'Start',exact:true}).click();
  const ready = page.getByRole('button',{name:'Ready · Reveal my hand'});
  const details = page.getByRole('button',{name:'Turn details'});
  const panel = page.getByLabel('Shared-table turn');
  const hand = panel.locator('.turn-cards[aria-label]');
  const read = () => page.evaluate(async () => (await import('/src/game/store.ts')).useGameStore.getState().turn);
  await ready.click();
  await page.getByRole('button',{name:'End turn',exact:true}).click();
  await ready.click();
  await details.click();
  const cardName = phase === 'after' ? (trichord ? /Trichord truss/i : /Planar truss/i) : (trichord ? /Planar truss/i : /GLULAM/i);
  await hand.getByRole('button',{name:cardName}).click();
  async function stage(a,b) {
    const form = panel.locator('details').filter({hasText:'Quarter-point placement'});
    await form.locator('summary').click();
    for (const [side,value] of [['A',a],['B',b]]) {
      if (value.startsWith('port')) await form.getByLabel('End '+side+' port').selectOption(value);
      else await form.getByLabel('End '+side+' grid x,y,z').fill(value);
    }
    await form.getByRole('button',{name:'Stage element'}).click();
    assert.equal((await read()).draft.members.length,1);
  }
  async function fixed(id) {
    await hand.getByRole('button',{name:/Fixed \/ moment/i}).first().click();
    await panel.getByRole('button',{name:new RegExp('Member '+id+' · end A')}).first().click();
  }
  await stage('1,3,1','2,4,1');
  await fixed(3);
  await panel.getByRole('button',{name:'End turn / pass'}).click();
  await ready.click();
  await page.getByRole('button',{name:'Fit',exact:true}).first().click();
  await page.mouse.move(0,0);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await page.screenshot({path:resolve(out,phase+'-board.png')});
  if (trichord) {
    // Orbit and zoom with the same inputs on both builds so all three faces
    // can be distinguished from the silhouette of the planar printing.
    await page.mouse.move(720,360);
    await page.mouse.down();
    await page.mouse.move(670,335,{steps:12});
    await page.mouse.up();
    await page.mouse.move(690,320);
    await page.mouse.wheel(0,-950);
    await page.waitForTimeout(850);
    await page.screenshot({path:resolve(out,phase+'-detail.png'),clip:{x:265,y:115,width:855,height:510}});
    await page.reload();
    await ready.click();
    await page.getByRole('button',{name:'Fit',exact:true}).first().click();
  }
  if (phase==='after') {
    const state = await read();
    assert.equal(state.board.members[2].assembly,trichord ? 'trichord-ring-1' : 'planar-welded-1');
    const branchName = trichord ? /HEB/i : /GLULAM/i;
    const trayCard = page.getByLabel('Card tray').getByRole('button',{name:branchName}).first();
    await trayCard.click();
    // Observe the renderer's current camera to aim genuine mouse hits at
    // exact material stations. State changes below use ordinary player UI.
    await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').find(r=>/\/three\.js(?:\?|$)/.test(r.name))?.name;
      const {Vector3} = await import(url);
      const project = Vector3.prototype.project;
      Vector3.prototype.project = function(camera) {
        Vector3.prototype.project = project;
        window.portPixel = quarter => {
          const p = new Vector3(2+quarter/2,6+quarter/2,2).project(camera);
          const box = document.querySelector('.scene canvas,canvas').getBoundingClientRect();
          return [box.x+(1+p.x)*box.width/2,box.y+(1-p.y)*box.height/2];
        };
        return project.call(this,camera);
      };
    });
    await page.mouse.move(640,390);
    for (const q of [1,2,3]) {
      await trayCard.click();
      const [x,y] = await page.evaluate(q=>window.portPixel(q),q);
      await page.mouse.move(x,y);
      const title = await page.locator('canvas[title]').getAttribute('title');
      assert.ok(title.includes('Member 3 · '+q*25+'%'),title);
      await page.mouse.click(x,y);
      assert.equal(await page.evaluate(async()=>(await import('/src/game/store.ts')).useGameStore.getState().chainStart),'port:3:'+q);
    }
    await details.click();
    await hand.getByRole('button',{name:branchName}).first().click();
    await stage('port:3:2','2,3,1');
    await fixed(4);
    await hand.getByRole('button',{name:/5 kN down/i}).first().click();
    await panel.getByLabel('Load at joint').selectOption('port:3:2');
    await panel.getByRole('button',{name:'End turn / pass'}).click();
    await ready.waitFor();
    const committed = await read();
    assert.equal(committed.board.loads[0].jointId,'port:3:2');
    await page.reload();
    await ready.waitFor();
    assert.deepEqual((await read()).board,committed.board);
    console.log('Selected original 25/50/75 percent and transferred persistent 5 kN at midpoint, reloaded');
  }
  assert.deepEqual(errors,[]);
  console.log(phase,browser.version());
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  console.error('Visible controls', (await page?.locator('body').innerText())?.slice(-1900));
  throw error;
} finally { await browser.close(); await server.close(); }
