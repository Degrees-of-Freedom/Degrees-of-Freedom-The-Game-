// node check.mjs <repo> <before|after> <Playwright module> <Chrome executable>
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const [work, phase, playwright, executablePath] = process.argv.slice(2);
assert.ok(["before","after"].includes(phase));
const root = resolve(work,"apps/web"), out = dirname(fileURLToPath(import.meta.url));
const server = await createServer({root,configFile:join(root,"vite.config.ts"),server:{host:"127.0.0.1",port:0,watch:null,hmr:false}});
const browser = await createRequire(import.meta.url)(playwright).chromium.launch({executablePath,headless:true});
let page;
try {
  await server.listen();
  page = await browser.newPage({viewport:{width:1366,height:900},deviceScaleFactor:1});
  const errors = [];
  page.on("pageerror",e=>{errors.push(e.message); console.error(e.message);});
  await page.addInitScript(() => {
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.fixtureScenes = [];
    window.__THREE_DEVTOOLS__.addEventListener("observe",e=>{ if(e.detail.isScene) window.fixtureScenes.push(e.detail); });
    localStorage.setItem("dof.settings",JSON.stringify({sound:false,reducedMotion:true,showHelpOnStart:false}));
  });
  await page.addInitScript(()=>{
    const model = { nextId:4, members:[
      {id:1,type:"heb",a:"3,3,0",b:"3,3,1"}, {id:2,type:"heb",a:"3,3,1",b:"3,3,4"},
      {id:3,type:"ipe",a:"5,3,1",b:"6,3,1"}],
      attrs:{"3,3,0":{found:true,joint:true},"3,3,1":{joint:true,load:1,loadDirection:"+X"},
        "3,3,4":{joint:true,load:4,loadDirection:"+X"}} };
    localStorage.setItem("dof-runtime:session",JSON.stringify({version:1,mode:"creative",style:"grow-dusk",turn:null}));
    localStorage.setItem("dof-mode:creative:environment",JSON.stringify({format:"dof-voxel-save",version:1,levelId:"environment",model}));
  });
  await page.goto(new URL("/play",server.resolvedUrls.local[0]).href);
  await page.getByText("Grow · dusk · Creative",{exact:true}).waitFor();
  const savedModel = () => page.evaluate(()=>JSON.parse(localStorage.getItem("dof-mode:creative:environment")).model);
  const original = await savedModel();
  await page.getByRole("button",{name:"Fit",exact:true}).click();
  await page.getByRole("button",{name:"Run simulation",exact:true}).click();
  await page.getByLabel("Deformed shape",{exact:true}).check();
  if (phase === "after") {
    await page.getByText(/Reference geometry only for members #3/).waitFor();
    await page.getByLabel("Displacement scale",{exact:true}).selectOption("1");
    const vertex = () => page.evaluate(()=>{
      const scene=window.fixtureScenes.find(s=>s.getObjectByName("Displaced member 2"));
      const mesh=scene.getObjectByName("Displaced member 2"), attr=mesh.geometry.getAttribute("position");
      if (scene.getObjectByName("Displaced member 3")) throw Error("Unknown member received a shape");
      return [attr.getX(0),attr.getY(0),attr.getZ(0)];
    });
    const trueVertex = await vertex();
    await page.getByLabel("Displacement scale",{exact:true}).selectOption("100");
    const amplified = await vertex();
    assert.ok(Math.hypot(...amplified.map((v,i)=>v-trueVertex[i])) > .01);
    await page.getByLabel("Undeformed reference",{exact:true}).uncheck();
    assert.ok(await page.evaluate(()=>window.fixtureScenes.every(s=>!s.getObjectByName("Undeformed reference"))));
    await page.getByLabel("Undeformed reference",{exact:true}).check();
    assert.ok(await page.evaluate(()=>window.fixtureScenes.some(s=>s.getObjectByName("Undeformed reference"))));
    await page.getByLabel("Displacement scale",{exact:true}).selectOption("0");
    await page.screenshot({path:join(out,"inspector.png")});
  }
  await page.getByRole("button",{name:"Close drawer"}).click();
  await page.mouse.move(0,0);
  await page.locator("#toast").waitFor({state:"hidden"});
  await page.screenshot({path:join(out,phase+".png")});
  assert.deepEqual(await savedModel(), original);
  assert.deepEqual(errors,[]);
  console.log(browser.version(),phase,"two horizontal loads, separate unsupported member, model unchanged");
  if (phase === "after") {
    const match = await browser.newPage();
    await match.addInitScript(() => {
      // A recovered seed-23 match starts at the same private handoff as live play.
      if (!localStorage.getItem("dof-runtime:session")) localStorage.setItem("dof-runtime:session",JSON.stringify({
        version:1,mode:"multiplayer",style:"grow-dusk",turn:{version:1,seed:23,catalogue:"shared-table-frame-1",events:[
          {kind:"end",turn:1,status:"stable"}]}}));
    });
    await match.goto(new URL("/play",server.resolvedUrls.local[0]).href);
    const ready = match.getByRole("button",{name:/Ready.*reveal/i});
    await ready.click();
    await match.getByRole("button",{name:"Run simulation",exact:true}).click();
    await match.getByText("Committed board · all persistent gravity cards combined.").waitFor();
    assert.equal(await match.getByText("Load case",{exact:true}).count(),0);
    await match.getByRole("button",{name:"Close drawer"}).click();
    await match.getByRole("button",{name:"Turn details"}).click();
    const panel = match.getByRole("region",{name:"Shared-table turn"});
    await panel.getByRole("button",{name:/5 kN down/}).first().click();
    await panel.getByLabel("Load at joint").selectOption("1,3,1");
    await match.getByRole("button",{name:"Close drawer"}).click();
    await match.getByRole("button",{name:"Run simulation",exact:true}).click();
    await match.getByText("Draft preview · staged and persistent gravity cards combined.").waitFor();
    await match.getByText("Support reactions",{exact:true}).click();
    assert.match(await match.locator(".analysis").innerText(),/0\.00, 0\.00, 5\.00 kN/);
    console.log("Shared table seed 23 · deliberate reveal · 5 kN staged card · signed +5 kN with self-weight excluded");
  }
} catch (error) {
  if(page) console.error((await page.locator("body").innerText()).slice(-4500));
  throw error;
} finally { await browser.close(); await server.close(); }
