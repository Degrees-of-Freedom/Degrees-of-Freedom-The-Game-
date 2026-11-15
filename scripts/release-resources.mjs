// Exercise repeated in-document route and scene resets so navigator reload
// cannot hide accumulated GPU handles, audio nodes, workers or listeners.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { preview } from "vite";

const dist = resolve(process.env.DOF_TEST_DIST || "apps/web/dist");
const output = resolve(process.env.DOF_EVIDENCE_DIR || ".venv/release-evidence");
const build = JSON.parse(await readFile(resolve(dist, "release-build.json"), "utf8"));

// Instrument public allocation/retirement APIs. Weak references let Chrome
// collect retired contexts. A lost GL context releases all its native handles.
function instrument() {
  const handles = ["Buffer", "Texture", "Framebuffer", "Renderbuffer", "Program", "VertexArray", "Shader"];
  const contexts = [], byContext = new WeakMap(), audio = [], oscillators = new WeakSet();
  let voices = 0, peakVoices = 0, createdVoices = 0;
  const prototype = WebGL2RenderingContext.prototype;
  for (const name of handles) {
    const allocate = prototype["create" + name], free = prototype["delete" + name];
    prototype["create" + name] = function(...args) {
      const handle = allocate.apply(this, args);
      let record = byContext.get(this);
      if (!record) {
        record = { ref: new WeakRef(this), live: Object.fromEntries(handles.map(k => [k, 0])), seen: new WeakSet() };
        byContext.set(this, record); contexts.push(record);
      }
      if (handle) { record.seen.add(handle); record.live[name]++; }
      return handle;
    };
    prototype["delete" + name] = function(handle) {
      const record = byContext.get(this);
      if (record?.seen.delete(handle)) record.live[name]--;
      return free.call(this, handle);
    };
  }
  window.AudioContext = class extends AudioContext {
    constructor(...args) { super(...args); audio.push(new WeakRef(this)); }
    createOscillator() {
      const oscillator = super.createOscillator();
      createdVoices++;
      const connect = oscillator.connect.bind(oscillator), disconnect = oscillator.disconnect.bind(oscillator);
      oscillator.connect = (...args) => {
        const result = connect(...args);
        if (!oscillators.has(oscillator)) { oscillators.add(oscillator); peakVoices = Math.max(peakVoices, ++voices); }
        return result;
      };
      oscillator.disconnect = (...args) => {
        const result = disconnect(...args);
        if (oscillators.delete(oscillator)) voices--;
        return result;
      };
      return oscillator;
    }
  };
  window.releaseResourceSample = () => {
    const active = contexts.filter(({ ref }) => { const gl = ref.deref(); return gl && !gl.isContextLost(); });
    const gl = Object.fromEntries(handles.map(k => [k, active.reduce((sum, record) => sum + record.live[k], 0)]));
    return { contexts: active.length, gl, audio: audio.filter(ref => {
      const ctx = ref.deref(); return ctx && ctx.state !== "closed";
    }).length, voices, createdVoices, peakVoices, canvases: document.querySelectorAll("canvas").length };
  };
}

const host = await preview({ root: resolve("apps/web"), build: { outDir: dist }, preview: { host: "127.0.0.1", port: 0 } });
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.DOF_BROWSER_EXECUTABLE || undefined, headless: true,
    args: process.env.DOF_SOFTWARE_GL ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : [] });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, reducedMotion: "reduce" });
  await page.addInitScript(instrument);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  const evidence = { build, browser: browser.version(), seed: 0, snapshots: [], workersCreated: 0, workersClosed: 0, errors: [] };
  page.on("worker", worker => { evidence.workersCreated++; worker.on("close", () => evidence.workersClosed++); });
  page.on("pageerror", error => evidence.errors.push(error.message));
  const button = name => page.getByRole("button", { name, exact: true });
  const ready = button("Ready · Reveal my hand"), model = page.locator('.figure-stage[data-view="model"]');
  async function sample(cycle, route) {
    await model.waitFor();
    await page.evaluate(async () => { for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame); });
    // Audio render time is independent of animation frames. Sample retained
    // handles once short selection cues have actually disconnected their nodes.
    await page.waitForFunction(() => window.releaseResourceSample().voices === 0, undefined, { timeout: 5000 });
    await cdp.send("HeapProfiler.collectGarbage");
    const memory = await cdp.send("Memory.getDOMCounters");
    const { detachedNodes } = await cdp.send("DOM.getDetachedDomNodes");
    const snapshot = { cycle, route, ...await page.evaluate(() => window.releaseResourceSample()), ...memory,
      detachedCanvases: detachedNodes.filter(node => node.treeNode.nodeName === "CANVAS").length,
      workers: page.workers().length };
    evidence.snapshots.push(snapshot);
  }
  await page.goto(host.resolvedUrls.local[0] + "?seed=0");
  const start = await page.evaluate(() => performance.timeOrigin);
  for (let cycle = 1; cycle <= 10; cycle++) {
    await page.getByRole("link", { name: "Play", exact: true }).click();
    await ready.click();
    if (cycle === 1) {
      await button("Menu").click();
      await button("Settings").click();
      await page.getByRole("checkbox", {name: /^Sound/}).first().check();
      await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
      await ready.click();
    }
    if (cycle === 1) {
      await page.getByLabel("Calculate every", {exact:true}).selectOption("1");
      for (let draw = 0; draw < 4; draw++) {
        await page.locator('[data-deck="members"]').click();
        if (draw < 3) await page.getByText(`${draw + 1} of 4 drawn · any mix of decks`, {exact:true}).waitFor();
      }
      await page.locator('[aria-label="Draw four cards"]').waitFor({state:"detached"});
      await button("Pass").click(); await ready.click();
    }
    if (await page.locator('[data-deck]').count()) {
      for (let draw = 0; draw < 4; draw++) {
        await page.locator('[data-deck="members"]').click();
        if (draw < 3) await page.getByText(`${draw + 1} of 4 drawn · any mix of decks`, {exact:true}).waitFor();
      }
      await page.locator('[aria-label="Draw four cards"]').waitFor({state:"detached"});
    }
    await model.waitFor();
    const first = page.locator("[data-card-id]").first();
    await first.click(); await first.click();
    await button("Inspect").click();
    await page.getByLabel("Board overlay").waitFor();
    await button("Close inspection").click();
    await sample(cycle, "match");
    if (cycle % 2 === 0) await page.keyboard.down("Control");
    await button("Menu").click(); await button("Quit to menu").click();
    if (cycle % 2 === 0) await page.keyboard.up("Control");
    await sample(cycle, "home");
  }
  assert.equal(await page.evaluate(() => performance.timeOrigin), start, "The browser loaded a fresh document");
  await mkdir(output, {recursive:true});
  await writeFile(resolve(output, "resources.json"), JSON.stringify(evidence, null, 2) + "\n");
  assert.deepEqual(evidence.errors, []);
  for (const route of ["match", "home"]) {
    const samples = evidence.snapshots.filter(s => s.route === route);
    for (const s of samples) {
      assert.equal(s.canvases, route === "match" ? 2 : 1);
      assert.equal(s.contexts, s.canvases);
      assert.equal(s.detachedCanvases, 0);
      assert.equal(s.documents, 1);
      assert.equal(s.audio, route === "match" ? 1 : 0);
      assert.equal(s.voices, 0);
      assert.ok(s.peakVoices <= 4);
      assert.ok(s.workers <= 1, "Only the active figure decoder may remain");
    }
    // The first cycle initializes settings, camera memory and shared assets.
    // Require stable retained resources after that warmup on each route.
    const warm = samples.slice(1);
    for (const s of warm) {
      assert.deepEqual(s.gl, warm[0].gl);
      assert.equal(s.jsEventListeners, warm[0].jsEventListeners);
      assert.equal(s.nodes, warm[0].nodes);
    }
  }
  assert.ok(evidence.snapshots.at(-1).createdVoices >= 10);
  assert.ok(evidence.workersCreated >= 20 && evidence.workersCreated - evidence.workersClosed <= 1);
  console.log(JSON.stringify({ snapshots: evidence.snapshots.slice(-2), workersCreated: evidence.workersCreated,
    workersClosed: evidence.workersClosed, assets: build.assetsSha256 }));
} finally {
  await browser?.close();
  await new Promise(done => host.httpServer.close(done));
}
