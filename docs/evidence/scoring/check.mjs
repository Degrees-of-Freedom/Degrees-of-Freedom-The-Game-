// node check.mjs <workspace> <playwright module> <Chrome executable> <before|after>
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createServer } from "vite";

const [workspace, playwright, executablePath, phase] = process.argv.slice(2);
assert.ok(["before", "after"].includes(phase));
const root = resolve(workspace, "apps/web");
const server = await createServer({ root, configFile:resolve(root,"vite.config.ts"), server:{host:"127.0.0.1", port:0, hmr:false, watch:null} });
const { chromium } = createRequire(import.meta.url)(playwright);
const browser = await chromium.launch({ executablePath, headless:true,
  args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
try {
  await server.listen();
  const page = await browser.newPage({viewport:{width:1366,height:900},deviceScaleFactor:1});
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(phase => {
    if (localStorage.getItem("dof-runtime:session")) return;
    const events = [];
    for (let turn=1; turn<16; turn++) {
      if (turn === 2) events.push({kind:"load",cardId:"load-20",jointId:"1,3,1"});
      events.push({kind:"end",turn,status:"stable"});
    }
    localStorage.setItem("dof.settings", JSON.stringify({sound:false,reducedMotion:true,showHelpOnStart:false}));
    localStorage.setItem("dof-runtime:session",JSON.stringify({version:1,mode:"multiplayer",style:"grow-dusk",turn:{
      version:1,seed:23,events, ...(phase === "after" && {catalogue:"shared-table-frame-1"}),
    }}));
  }, phase);
  await page.goto(new URL("/play",server.resolvedUrls.local[0]).href);
  if (phase === "after") await page.getByRole("button",{name:/Ready.*reveal/i}).click();
  const end = page.getByRole("button",{name:"End turn",exact:true});
  await end.focus();
  await page.keyboard.press("Enter");
  if (phase === "before") await page.getByRole("button",{name:"Turn details"}).click();
  await page.getByRole("heading",{name:"Table complete"}).waitFor();
  await page.mouse.move(0,0);
  await page.screenshot({path:fileURLToPath(new URL(phase + ".png",import.meta.url))});
  if (phase === "after") {
    const check = async () => {
      await page.getByRole("heading",{name:"Player 1 wins"}).waitFor();
      const rows = await page.getByRole("region",{name:"Final score"}).locator("tbody tr").allTextContents();
      assert.deepEqual(rows,["Player 1100%0100","Player 20%00"]);
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("dof-runtime:session")).turn.events);
      assert.equal(stored.filter(e=>e.final).length,1);
      assert.equal(stored.at(-1).final.totalGravityKN,5);
      return stored;
    };
    const prior = await check();
    await page.reload();
    assert.deepEqual(await check(),prior);
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({phase,chrome:browser.version(),seed:23,turn:16,gravityKN:5}));
} finally { await browser.close(); await server.close(); }
