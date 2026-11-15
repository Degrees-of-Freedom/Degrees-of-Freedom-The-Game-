// Run after npm run build. All gameplay changes go through visible production controls.
// IndexedDB is read only for assertions, including private replay and draw identity.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import { preview } from "vite";
import { testOperationalCases } from "./release-faults.mjs";

const root = fileURLToPath(new URL("../apps/web/", import.meta.url));
const input = process.env.DOF_INPUT || "pointer";
assert.ok(["pointer", "keyboard", "touch"].includes(input), "Expected pointer, keyboard or touch");
const viewport = input === "touch" ? {width:1024,height:768} : {width:1366,height:900};
const output = resolve(process.env.DOF_EVIDENCE_DIR ?? ".venv/release-evidence");
const first = Number(process.env.DOF_FIRST_SEED ?? 0), last = Number(process.env.DOF_LAST_SEED ?? 19);
assert.ok(Number.isInteger(first) && Number.isInteger(last) && first >= 0 && last >= first);
const port = Number(process.env.DOF_PREVIEW_PORT ?? 0);
const host = await preview({root, configFile: resolve(root, "vite.config.ts"),
  build:{outDir:resolve(process.env.DOF_TEST_DIST ?? resolve(root,"dist"))}, preview:{host:"127.0.0.1", port}});
const base = host.resolvedUrls.local[0];
let browser;
try {
  browser = await chromium.launch({ channel: process.env.DOF_BROWSER_CHANNEL || undefined,
    executablePath: process.env.DOF_BROWSER_EXECUTABLE || undefined, headless:true,
    args: process.env.DOF_SOFTWARE_GL ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : [] });
  await mkdir(output, {recursive:true});
  const build = await (await fetch(new URL("release-build.json",base))).json();
  const binary = await (await fetch(new URL("assets/"+build.solverFile,base))).arrayBuffer();
  assert.equal(createHash("sha256").update(Buffer.from(binary)).digest("hex"),build.solverSha256);
  const evidence = { ...build,
    browser: browser.version(), viewport:[viewport.width,viewport.height], matches:[] };
  if (process.argv.includes("--faults")) {
    const checks = await testOperationalCases(browser,base,saved);
    console.log(checks.join("\n"));
    await writeFile(resolve(output,"recovery.json"), JSON.stringify({...evidence,checks},null,2));
  } else {
    for (let seed = first; seed <= last; seed++) {
      evidence.matches.push(await match(seed, false));
      await writeFile(resolve(output,"matches-"+first+"-"+last+".json"), JSON.stringify(evidence,null,2));
    }
    evidence.zeroGravity = await match(0, true);
    await writeFile(resolve(output,"matches-"+first+"-"+last+".json"), JSON.stringify(evidence,null,2));
  }
} finally {
  await browser?.close();
  await new Promise(resolveClose => host.httpServer.close(resolveClose));
}

async function saved(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve,reject) => {
      const r = indexedDB.open("dof-grow-dusk"); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error);
    });
    try {
      return await new Promise((resolve,reject) => {
        const r = db.transaction("match").objectStore("match").get("head");
        r.onsuccess=()=>resolve(JSON.parse(r.result)); r.onerror=()=>reject(r.error);
      });
    } finally { db.close(); }
  });
}

async function match(seed, passOnly) {
  const keyboard = input === "keyboard";
  const context = await browser.newContext({viewport,deviceScaleFactor:1,hasTouch:input === "touch",
    reducedMotion:keyboard ? "reduce" : "no-preference"});
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  const errors = [], wasm = new Set();
  context.on("response", r => { if (/dof_solver.*\.wasm/.test(r.url()) && r.ok()) wasm.add(r.url()); });
  page.on("pageerror", e => errors.push(e.message));
  const results = [], built = new Map();
  const adverse = seed === 1 && !passOnly;
  const button = name => page.getByRole("button",{name,exact:true});
  const ready = button("Ready · Reveal my hand");
  const tray = page.getByRole("region",{name:"Active hand"});
  async function reach(control) {
    await control.waitFor({state:"visible"});
    for (let i=0;i<200;i++) {
      const direction = await control.evaluate(node => document.activeElement === node ? null :
        (document.activeElement.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING) ? "Shift+Tab" : "Tab");
      if (!direction) return;
      await page.keyboard.press(direction);
    }
    throw Error("Control outside the keyboard focus order: "+await control.textContent());
  }
  async function activate(control) {
    if (input === "touch") return control.tap();
    if (!keyboard) return control.click();
    await reach(control); await page.keyboard.press("Enter");
  }
  async function fill(control, value) {
    if (!keyboard) return control.fill(value);
    await reach(control); await page.keyboard.press("Control+a"); await page.keyboard.type(value);
  }
  async function choose(control, value) {
    if (!keyboard) return control.selectOption(value);
    await reach(control);
    const index = await control.evaluate((select, v) => [...select.options].findIndex(o => o.value === v), value);
    assert.ok(index >= 0);
    await page.keyboard.press("Home");
    for(let n=0;n<index;n++) await page.keyboard.press("ArrowDown");
  }
  async function playCard(card, submit) {
    const id = await card.getAttribute("data-card-id");
    await activate(card);
    await submit();
    await tray.locator('[data-card-id="'+id+'"]').waitFor({state:"detached"});
  }
  const capture = async name => {
    if (!passOnly && seed <= 2) await page.screenshot({path:resolve(output,"seed-"+seed+"-"+name+".png")});
  };
  try {
    await page.goto(base+"?seed="+seed);
    await activate(page.getByRole("link",{name:"Play",exact:true}));
    for (let turnNo=1; turnNo<=16; turnNo++) {
      await ready.waitFor();
      assert.equal(await tray.count(),0,"handoff must unmount the private hand");
      const before = await saved(page);
      assert.equal(before.phase,"planning");
      assert.equal(before.turn.turn,turnNo);
      assert.equal(before.turn.seed,seed);
      assert.deepEqual(before.turn.decks.map(d => d.length), [48-2*turnNo,48-2*turnNo]);
      await activate(ready);
      await tray.waitFor();
      const player = before.turn.playerIndex;
      // Build from each player's locked column, fit the base and put gravity on
      // the new member's quarter/tip. One adverse fixture also stages a loose piece.
      const frame = tray.locator('[data-kind="element"]').filter({hasText:/HEB/i}).first();
      const fixed = tray.locator('[data-kind="connection"]').filter({hasText:/Fixed/i}).first();
      const loose = adverse && !built.has("adverse") && turnNo>=5;
      if (!passOnly && turnNo<16 && (loose || !built.has(player)) && await frame.count() && await fixed.count()) {
        const x = player === 0 ? 5 : 10;
        const id = before.turn.nextId;
        const a = loose ? "6,4,2" : x+",7,1";
        const b = loose ? "7,4,2" : x+",8,2";
        await playCard(frame, async () => {
          await activate(page.getByText("Precise placement",{exact:true}));
          await fill(page.getByLabel("End A grid x,y,z"),a);
          await fill(page.getByLabel("End B grid x,y,z"),b);
          await activate(button("Stage element"));
        });
        if (!loose) {
          await playCard(fixed, async () => {
            await choose(page.getByLabel("Connection target"), JSON.stringify([id,"a",a]));
            await activate(button("Attach end"));
          });
        }
        built.set(loose ? "adverse" : player,id);
        await capture("build-"+turnNo);
      }
      const load = tray.locator('[data-kind="load"]').first();
      if (!passOnly && built.size && turnNo<16 && await load.count()) {
        await playCard(load, async () => {
          const target = page.getByLabel("Load target");
          const member = built.get(player) ?? [...built.values()][0];
          const quarter = "port:"+member+":2";
          await choose(target,quarter);
          await activate(button("Place load"));
        });
      }
      if (seed===2 && turnNo===6 && !passOnly) {
        const staged = await saved(page);
        await page.reload();
        await ready.waitFor();
        assert.deepEqual((await saved(page)).turn,staged.turn,"reload changed the draft or draw");
        await capture("interrupted");
        await activate(ready);
      }
      const end = tray.getByRole("button",{name:/^(End turn|Pass)$/});
      if (process.env.DOF_CAPTURE_TURNS) await capture("turn-"+String(turnNo).padStart(2,"0"));
      const start = performance.now();
      await activate(end);
      if (turnNo<16) await ready.waitFor(); else await page.getByRole("region",{name:"Final score"}).waitFor();
      results.push(Math.round(performance.now()-start));
    }
    const final = await saved(page);
    assert.equal(final.phase,"final"); assert.equal(final.turn.finished,true);
    assert.equal(final.turn.reports.length,16);
    assert.equal(new Set(final.turn.reports.map(r=>r.turn)).size,16);
    const actions = final.turn.events.reduce((counts,e) => {counts[e.kind]=(counts[e.kind]??0)+1;return counts;},{});
    assert.equal(actions.end,16);
    assert.equal(final.turn.finalScore.receipt.solver, final.solver);
    if (passOnly) {
      assert.equal(final.turn.finalScore.totalGravityKN,0); assert.equal(final.turn.finalScore.winners.length,2);
    } else {
      for(const kind of ["element","connection","load"]) assert.ok(actions[kind]>0,"missing "+kind+" play for seed "+seed);
      assert.ok(final.turn.finalScore.totalGravityKN>0);
      assert.ok(final.turn.finalScore.receipt.components.some(c=>c.verified),"no verified physical component");
    }
    await capture("final");
    await page.reload(); await page.getByRole("region",{name:"Final score"}).waitFor();
    assert.deepEqual((await saved(page)).turn.finalScore,final.turn.finalScore);
    assert.equal(await tray.count(),0);
    assert.deepEqual(errors,[]);
    const record={seed,passOnly,input:input === "touch" ? "touch-emulated" : input,actions, version:final.rules, solver:final.solver,
      assessments:final.turn.reports.map(({status,penalty})=>({status,penalty})),
      repairObjects: final.turn.board.members.filter(m=>m.system).length, gravityKN:final.turn.finalScore.totalGravityKN,
      partial:final.turn.finalScore.partial, awards:final.turn.finalScore.awards, winners:final.turn.finalScore.winners,
      endToHandoffMs:results, wasmResources:wasm.size, errors};
    console.log(JSON.stringify({seed,passOnly,actions,repairObjects:record.repairObjects,partial:record.partial}));
    return record;
  } catch(error) {
    await page.screenshot({path:resolve(output,"failure-"+seed+".png")}).catch(()=>{});
    console.error("Seed",seed, "UI:",(await page.locator("body").innerText()).slice(0,1600),"errors:",errors);
    throw error;
  } finally { await context.close(); }
}
