// node check.mjs <workspace> <Playwright module> <Chrome executable> <before|after>
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const [workspace, playwright, executablePath, phase] = process.argv.slice(2);
assert.ok(["before", "after"].includes(phase));
const root = resolve(workspace, "apps/web");
const server = await createServer({ root, configFile: resolve(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
const browser = await createRequire(import.meta.url)(playwright).chromium.launch({ executablePath, headless: true });
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    // Observe the real browser audio graph. Natural stop times and releases
    // are separate from a stop requested while a voice is still sounding.
    const connections = new Map(), live = new Set();
    let starts = 0, immediateStops = 0, maxLive = 0, closed = 0, mix = [], muteNext = false;
    const connect = AudioNode.prototype.connect, disconnect = AudioNode.prototype.disconnect;
    AudioNode.prototype.connect = function(...args) {
      connections.set(this, args[0]); return connect.apply(this, args);
    };
    AudioNode.prototype.disconnect = function(...args) {
      connections.delete(this); live.delete(this); return disconnect.apply(this, args);
    };
    const start = OscillatorNode.prototype.start, stop = OscillatorNode.prototype.stop;
    OscillatorNode.prototype.start = function(...args) {
      starts++; live.add(this); maxLive = Math.max(maxLive, live.size);
      const gain = connections.get(this), effects = connections.get(gain), master = connections.get(effects);
      mix = [master?.gain?.value, effects?.gain?.value];
      if (muteNext) {
        muteNext = false;
        // Issue a normal toolbar mute between native start and natural end.
        queueMicrotask(() => document.querySelector('button[aria-label="Sound"]').click());
      }
      return start.apply(this, args);
    };
    OscillatorNode.prototype.stop = function(...args) {
      if (!args.length && live.has(this)) immediateStops++;
      return stop.apply(this, args);
    };
    const close = AudioContext.prototype.close;
    AudioContext.prototype.close = function() { closed++; return close.call(this); };
    window.soundProbe = { read: () => ({ starts, immediateStops, maxLive, live: live.size, closed, mix }),
      muteNext: () => { muteNext = true; } };
  });
  const stats = () => page.evaluate(() => window.soundProbe.read());
  const visit = path => page.goto(new URL(path, origin).href);
  await visit("/settings");
  const soundSetting = page.getByRole("checkbox", { name: /^Sound/ });
  await soundSetting.press("Space");
  assert.equal(await soundSetting.isChecked(), true);
  if (phase === "after") {
    for (const [label, value] of [["Master volume", 40], ["Effects volume", 75]]) {
      const slider = page.getByRole("slider", { name: label });
      await slider.press("Home");
      for (let i = 0; i < value; i++) await slider.press("ArrowRight");
      assert.equal(await slider.getAttribute("aria-valuetext"), value + "%");
    }
  }
  await page.screenshot({ path: fileURLToPath(new URL(phase + "-settings.png", import.meta.url)) });
  await visit("/setup/creative");
  await page.getByRole("button", { name: "Start with example", exact: true }).click();
  const toggle = page.getByRole("button", { name: "Sound", exact: true });
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute("aria-pressed"), phase === "after" ? "true" : "false");
  if (phase === "after") {
    const place = page.getByRole("button", { name: "Load example", exact: true });
    await place.click();
    await page.waitForFunction(() => window.soundProbe.read().starts === 1);
    const levels = (await stats()).mix;
    assert.ok(Math.abs(levels[0] - 0.4) < 1e-6 && levels[1] === 0.75);
    // Fire the existing editor control in separate tasks faster than a cue can
    // finish, then verify natural cleanup before testing mid-note mute.
    await place.evaluate(async button => {
      for (let i = 0; i < 12; i++) {
        button.click();
        await new Promise(resolve => setTimeout(resolve, 6));
      }
    });
    await page.waitForFunction(() => window.soundProbe.read().live === 0);
    const burst = await stats();
    assert.ok(burst.starts >= 10 && burst.maxLive > 1 && burst.maxLive <= 4, JSON.stringify(burst));
    await page.evaluate(() => window.soundProbe.muteNext());
    await place.click();
    await page.waitForFunction(prior => window.soundProbe.read().immediateStops > prior, burst.immediateStops);
    assert.equal(await toggle.getAttribute("aria-pressed"), "false");
    const muted = await stats();
    assert.equal(muted.live, 0);
    await place.click();
    assert.equal((await stats()).starts, muted.starts);
    await page.reload();
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute("aria-pressed"), "false");
    await page.keyboard.down("m");
    await page.keyboard.down("m");
    await page.keyboard.up("m");
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");
    await toggle.press("Space");
    assert.equal(await toggle.getAttribute("aria-pressed"), "false");
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    assert.equal(await soundSetting.isChecked(), false);
    await soundSetting.press("Space");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");
    await place.click();
    await page.waitForFunction(() => window.soundProbe.read().starts >= 1);
    const other = await page.context().newPage();
    await other.goto(new URL("/settings", origin).href);
    await other.getByRole("checkbox", { name: /^Sound/ }).press("Space");
    await page.waitForFunction(() => document.querySelector('button[aria-label="Sound"]')?.getAttribute("aria-pressed") === "false");
    await other.close();
    await visit("/setup/multiplayer");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    const ready = page.getByRole("button", { name: /Ready.*Reveal my hand/ });
    await ready.click();
    assert.equal(await toggle.getAttribute("aria-pressed"), "false");
    await toggle.press("Space");
    await page.getByRole("button", { name: "End turn", exact: true }).click();
    await ready.waitFor();
    assert.equal((await stats()).starts, 0);
    await ready.click();
    assert.equal((await stats()).starts, 0);
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("button", { name: "Quit to menu", exact: true }).click();
    await page.waitForFunction(() => window.soundProbe.read().closed === 1);
    assert.equal((await stats()).live, 0);
    console.log(JSON.stringify({ browser: browser.version(), levels, burst, muted, errors }));
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close(); await server.close();
}
