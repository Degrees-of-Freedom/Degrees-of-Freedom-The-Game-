// node check.mjs <workspace> <Playwright module> <Chrome executable> <before|after>
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const [workspace, playwright, executablePath, phase]=process.argv.slice(2);
const out=dirname(fileURLToPath(import.meta.url)), root=resolve(workspace,'apps/web');
const server=await createServer({root,configFile:resolve(root,'vite.config.ts'),server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
const {chromium}=createRequire(import.meta.url)(playwright);
const browser=await chromium.launch({executablePath,headless:true});
try {
  await server.listen();
  const page=await browser.newPage({viewport:{width:1366,height:900},deviceScaleFactor:1});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const origin=server.resolvedUrls.local[0], catalogue=phase==='after'?'shared-table-cables-1':'shared-table-frame-1';
  await page.goto(new URL('/setup/multiplayer',origin).href);
  await page.getByLabel('Physical catalogue').selectOption(catalogue);
  await page.screenshot({path:resolve(out,phase+'-setup.png')});
  // The ordinary setup fixes seed 1. Restore a fresh, zero-event seed 8
  // fixture through the normal validated session boundary. Every play below
  // is made with a visible hand, board or placement control.
  await page.evaluate(catalogue=>localStorage.setItem('dof-runtime:session',JSON.stringify({
    version:1,style:'grow-dusk',mode:'multiplayer',turn:{version:1,catalogue,seed:8,events:[]},
  })),catalogue);
  await page.goto(new URL('/play',origin).href);
  const ready=page.getByRole('button',{name:'Ready · Reveal my hand'});
  const pass=page.getByRole('button',{name:'End turn',exact:true});
  const panel=page.getByLabel('Shared-table turn'), hand=panel.locator('.turn-cards[aria-label]');
  const read=()=>page.evaluate(async()=>(await import('/src/game/store.ts')).useGameStore.getState().turn);
  for(let i=0;i<8;i++) {await ready.click(); await pass.click();}
  async function build(card,a,b,id) {
    await page.getByRole('button',{name:'Turn details'}).click();
    await hand.getByRole('button',{name:card}).first().click();
    const form=panel.locator('details').filter({hasText:'Quarter-point placement'});
    if(!await form.getByRole('button',{name:'Stage element'}).isVisible()) await form.locator('summary').click();
    for(const [end,key] of [['A',a],['B',b]]) {
      if(key.startsWith('port:')) await form.getByLabel('End '+end+' port').selectOption(key);
      else await form.getByLabel('End '+end+' grid x,y,z').fill(key);
    }
    await form.getByRole('button',{name:'Stage element'}).click();
    assert.equal((await read()).draft.members[0]?.id,id,'Member placement failed');
    for(const end of ['A','B']) {
      await hand.getByRole('button',{name:/Fixed \/ moment/i,disabled:false}).first().click();
      await panel.getByRole('button',{name:new RegExp('Member '+id+' · end '+end)}).first().click();
    }
  }
  await ready.click();
  if(phase==='after') {
    await build(/Cable Ø24 · ≤4/i,'1,3,1','5,3,1',3);
    await panel.getByRole('button',{name:'End turn / pass'}).click();
  } else await pass.click();
  await ready.click();
  const fit=page.getByRole('button',{name:'Fit',exact:true}).first();
  const fitHit=await fit.evaluate(button=>{
    const box=button.getBoundingClientRect(), x=box.x+box.width/2,y=box.y+box.height/2;
    const target=document.elementFromPoint(x,y);
    return {x,y,hit:target?.tagName,label:target?.textContent?.trim(),reachable:!!target && button.contains(target)};
  });
  console.log('Turn 10 Fit pointer hit',JSON.stringify(fitHit));
  await page.keyboard.press('f');
  await page.mouse.move(0,0);
  await page.screenshot({path:resolve(out,phase+'-board.png')});
  if(phase==='after') {
    // Measure the real scene camera to direct pointer input to the physical cable.
    await page.evaluate(async()=>{
      const url=performance.getEntriesByType('resource').find(r=>/\/three\.js(?:\?|$)/.test(r.name)).name;
      const {Vector3}=await import(url),project=Vector3.prototype.project;
      Vector3.prototype.project=function(camera){
        Vector3.prototype.project=project;
        window.cablePixel=q=>{
          const p=new Vector3(2+2*q,6,2).project(camera);
          const box=document.querySelector('.scene canvas,canvas').getBoundingClientRect();
          return [box.x+(1+p.x)*box.width/2,box.y+(1-p.y)*box.height/2];
        };
        return project.call(this,camera);
      };
    });
    await page.mouse.move(610,380);
    const card=page.getByLabel('Card tray').getByRole('button',{name:/SHS/i}).first();
    for(const q of [1,2,3]) {
      await card.click();
      const [x,y]=await page.evaluate(q=>window.cablePixel(q),q);
      await page.mouse.move(x,y);
      assert.match(await page.locator('canvas[title]').getAttribute('title'),new RegExp('Member 3 · '+q*25+'%'));
      await page.mouse.click(x,y);
      assert.equal(await page.evaluate(async()=>(await import('/src/game/store.ts')).useGameStore.getState().chainStart),'port:3:'+q);
    }
    for(const [id,foot,q] of [[4,'1,3,0',1],[5,'5,3,0',3]]) {
      const target='port:3:'+q;
      await build(/SHS/i,foot,target,id);
      await hand.getByRole('button',{name:/5 kN down/i}).first().click();
      await panel.getByLabel('Load at joint').selectOption(target);
      await panel.getByRole('button',{name:'End turn / pass'}).click();
      await ready.click();
    }
    const committed=await read();
    assert.deepEqual(committed.board.loads.map(l=>l.jointId),['port:3:1','port:3:3']);
    const check=await page.evaluate(async()=>{
      const {analyzeTurn}=await import('/src/game/turnAnalysis.ts'), {useGameStore}=await import('/src/game/store.ts');
      return analyzeTurn(useGameStore.getState().turn,'card-gravity').capacity.members[3];
    });
    assert.equal(check.status,'verified');assert.ok(Math.abs(check.actions.N-2.9996205256)<1e-8);
    await page.screenshot({path:resolve(out,'loaded-board.png')});
    await page.reload();await ready.waitFor();assert.deepEqual((await read()).board,committed.board);
    console.log('All three pointer picks; 10 kN across two clamps; '+check.actions.N+' kN governing cable tension; exact board replay.');
  }
  assert.deepEqual(errors,[]);
  console.log(phase,browser.version(),catalogue);
} finally {await browser.close(); await server.close();}
