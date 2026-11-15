// node check.mjs <workspace> <Playwright module> <Chrome executable> <before|after>
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const [workspace, playwright, executablePath, phase] = process.argv.slice(2);
const out = dirname(fileURLToPath(import.meta.url)), root = resolve(workspace,'apps/web');
const server = await createServer({root,configFile:resolve(root,'vite.config.ts'),server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
const {chromium} = createRequire(import.meta.url)(playwright);
const browser = await chromium.launch({executablePath,headless:true});
try {
  await server.listen();
  const page = await browser.newPage({viewport:{width:1366,height:900},deviceScaleFactor:1});
  page.setDefaultTimeout(25000);
  const errors = [];
  page.on('pageerror',e => errors.push(e.message));
  await page.goto(new URL('/setup/multiplayer',server.resolvedUrls.local[0]).href);
  const catalogue = phase === 'after' ? 'shared-table-springs-1' : 'shared-table-planar-1';
  await page.getByLabel('Physical catalogue').selectOption(catalogue);
  await page.screenshot({path:resolve(out,phase+'-setup.png')});
  await page.getByRole('button',{name:'Start',exact:true}).click();
  const ready = page.getByRole('button',{name:'Ready · Reveal my hand'});
  const details = page.getByRole('button',{name:'Turn details'}), panel=page.getByLabel('Shared-table turn');
  const hand=panel.locator('.turn-cards[aria-label]');
  const read = () => page.evaluate(async () => (await import('/src/game/store.ts')).useGameStore.getState().turn);
  for (let i=0;i<2;i++) {
    await ready.click();
    await page.getByRole('button',{name:'End turn',exact:true}).click();
  }
  async function build(name,a,b,id) {
    await details.click();
    await hand.getByRole('button',{name}).first().click();
    const form = panel.locator('details').filter({hasText:'Quarter-point placement'});
    if (!await form.getByRole('button',{name:'Stage element'}).isVisible()) await form.locator('summary').click();
    for (const [end,value] of [['A',a],['B',b]]) {
      if(value.startsWith('port:')) await form.getByLabel('End '+end+' port').selectOption(value);
      else await form.getByLabel('End '+end+' grid x,y,z').fill(value);
    }
    await form.getByRole('button',{name:'Stage element'}).click();
    assert.equal((await read()).draft.members[0]?.id,id,'Placement '+id+' failed: '+(await page.locator('#toast').allTextContents()).join(' '));
    for(const end of ['A','B']) {
      await hand.getByRole('button',{name:/Fixed \/ moment/i,disabled:false}).first().click();
      await panel.getByRole('button',{name:new RegExp('Member '+id+' · end '+end)}).first().click();
    }
  }
  await ready.click();
  await build(/HEB/i,'1,3,1','3,1,1',3);
  await panel.getByRole('button',{name:'End turn / pass'}).click();
  await ready.click();
  if (phase==='after') {
    await build(/Axial spring/i,'3,1,1','5,3,1',4);
    await panel.getByRole('button',{name:'End turn / pass'}).click();
  } else {
    // No axial spring is available from setup on the baseline build.
    await page.getByRole('button',{name:'End turn',exact:true}).click();
  }
  await ready.click();
  await page.getByRole('button',{name:'Fit',exact:true}).first().click();
  await page.mouse.move(0,0);
  await page.screenshot({path:resolve(out,phase+'-board.png')});
  // Capture the renderer's projection matrix for targeting 3D material; all
  // writes go through the real hand, board and placement controls.
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(r=>/\/three\.js(?:\?|$)/.test(r.name)).name;
    const {Vector3} = await import(url);
    const project = Vector3.prototype.project;
    Vector3.prototype.project = function(camera) {
      Vector3.prototype.project = project;
      window.springPixel = q => {
        const p = new Vector3(6+q,2+q,2).project(camera);
        const box = document.querySelector('.scene canvas,canvas').getBoundingClientRect();
        return [box.x+(1+p.x)*box.width/2,box.y+(1-p.y)*box.height/2];
      };
      return project.call(this,camera);
    };
  });
  await page.mouse.move(610,380);
  const [cx,cy] = await page.evaluate(()=>window.springPixel(2));
  await page.mouse.move(cx,cy); await page.mouse.wheel(0,-650); await page.waitForTimeout(700);
  const [x,y] = await page.evaluate(()=>window.springPixel(2));
  await page.screenshot({path:resolve(out,phase+'-detail.png'),clip:{x:Math.max(0,Math.min(800,x-275)),y:Math.max(0,Math.min(600,y-145)),width:550,height:290}});
  await page.getByRole('button',{name:'Fit',exact:true}).first().click();
  if(phase==='after') {
    const tray = page.getByLabel('Card tray').getByRole('button',{name:/HEB/i}).first();
    for(const q of [1,2,3]) {
      await tray.click();
      const [px,py] = await page.evaluate(q=>window.springPixel(q),q);
      await page.mouse.move(px,py);
      assert.match(await page.locator('canvas[title]').getAttribute('title'),new RegExp('Member 4 · '+q*25+'%'));
      await page.mouse.click(px,py);
      assert.equal(await page.evaluate(async()=>(await import('/src/game/store.ts')).useGameStore.getState().chainStart),'port:4:'+q);
    }
    await build(/HEB/i,'5,3,0','port:4:2',5);
    await hand.getByRole('button',{name:/5 kN down/i}).first().click();
    await panel.getByLabel('Load at joint').selectOption('port:4:2');
    await panel.getByRole('button',{name:'End turn / pass'}).click();
    await ready.waitFor();
    const committed = await read();
    assert.equal(committed.board.loads[0].jointId,'port:4:2');
    const capacity = await page.evaluate(async () => {
      const {analyzeTurn}=await import('/src/game/turnAnalysis.ts'), {useGameStore}=await import('/src/game/store.ts');
      return analyzeTurn(useGameStore.getState().turn,'card-gravity').capacity.members[4];
    });
    assert.equal(capacity.status,'verified');
    assert.ok(Math.abs(capacity.actions.N-.043750059)<1e-8);
    await page.reload(); await ready.waitFor();
    assert.deepEqual((await read()).board,committed.board);
    console.log('Selected all three original collars; 5 kN load, signed axial action '+capacity.actions.N+' kN, board/replay identical.');
  }
  assert.deepEqual(errors,[]);
  console.log(phase,browser.version(),catalogue);
} catch(e) {
  console.error((await browser.contexts()[0]?.pages()[0]?.locator('body').innerText())?.slice(-1700));
  throw e;
} finally { await browser.close(); await server.close(); }
