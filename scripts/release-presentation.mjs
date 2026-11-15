// Exercise the built client with real browser input. The small viewport and
// touch context are desktop emulation, recorded separately from device gates.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { preview } from "vite";

const root = resolve("apps/web");
const output = resolve(process.env.DOF_EVIDENCE_DIR || ".venv/release-evidence");
const dist = resolve(process.env.DOF_TEST_DIST || "apps/web/dist");
const host = await preview({ root, build: { outDir: dist },
  preview: { host: "127.0.0.1", port: 0 } });
const evidence = { build: JSON.parse(await readFile(resolve(dist, "release-build.json"), "utf8")), seed: 0, cases: [] };
let browser;
try {
  const launch = { headless: true, executablePath: process.env.DOF_BROWSER_EXECUTABLE || undefined,
    args: process.env.DOF_SOFTWARE_GL ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : [] };
  browser = await chromium.launch(launch);
  evidence.browser = browser.version();
  await mkdir(output, { recursive: true });
  for (const scenario of ["keyboard", "tablet-layout", "narrow-layout", "device-failures", "native-zoom", "model-failure", "decoder-failure", "full-hand"]) {
    const viewport = scenario === "tablet-layout" ? { width: 1024, height: 768 }
      : scenario === "narrow-layout" ? { width: 683, height: 384 } : { width: 1366, height: 900 };
    const layout = { viewport, hasTouch: scenario === "tablet-layout", reducedMotion: "reduce" };
    // The browser's own zoom preference is profile-scoped. Playwright creates
    // and removes an isolated temporary profile for this single test.
    const context = scenario === "native-zoom" ? await chromium.launchPersistentContext("", { ...launch, ...layout })
      : await browser.newContext(layout);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      if (scenario === "native-zoom") {
        await page.goto("chrome://settings/appearance");
        await page.getByRole("combobox", { name: "Page zoom", exact: true }).selectOption({ label: "200%" });
      }
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      const blocked = scenario === "model-failure" ? "**/companion/timburr.glb"
        : scenario === "decoder-failure" ? "**/companion/draco/**" : undefined;
      let blockedRequests = 0;
      if (blocked) await page.route(blocked, route => { blockedRequests++; return route.abort("failed"); });
      if (scenario === "device-failures") {
        await page.route("**/companion/*.glb", route => route.abort("failed"));
        await page.addInitScript(() => {
          const get = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
            return String(kind).startsWith("webgl") ? null : get.call(this, kind, ...args);
          };
          window.AudioContext = class { constructor() { throw new Error("No output device"); } };
        });
      }
      await page.goto(host.resolvedUrls.local[0] + "?seed=0");
      const button = name => page.getByRole("button", { name, exact: true });
      async function tabTo(control) {
        for (let i = 0; i < 100; i++) {
          if (await control.evaluate(el => el === document.activeElement)) return;
          const earlier = await control.evaluate(el => !!(document.activeElement.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING));
          await page.keyboard.press(earlier ? "Shift+Tab" : "Tab");
        }
        throw new Error("Keyboard focus could not reach " + await control.textContent());
      }
      async function activate(control) {
        if (scenario === "keyboard") { await tabTo(control); await page.keyboard.press("Enter"); }
        else if (scenario === "tablet-layout") await control.tap();
        else await control.click();
      }
      async function choose(control, index) {
        if (scenario === "keyboard") {
          await tabTo(control);
          await page.keyboard.press("Home");
          for (let i = 0; i < index; i++) await page.keyboard.press("ArrowDown");
        } else await control.selectOption({ index });
        assert.equal(await control.evaluate(el => el.selectedIndex), index);
      }
      await activate(page.getByRole("link", { name: "Play", exact: true }));
      const ready = button("Ready · Reveal my hand");
      await ready.waitFor();
      assert.equal(await page.locator("[data-card-id]").count(), 0);
      await activate(ready);
      await page.getByRole("region", { name: "Active hand" }).waitFor();
      assert.equal(await page.locator(".release-board").getAttribute("data-still"), "true");
      const width = await page.evaluate(() => ({ body: document.documentElement.scrollWidth, viewport: innerWidth }));
      if (scenario === "native-zoom") {
        assert.ok(width.viewport >= viewport.width/2-1 && width.viewport <= viewport.width/2+1,
          `200% zoom did not halve the layout width (${width.viewport})`);
      }
      assert.ok(width.body <= width.viewport + 1, "Controls overflow horizontally");
      if (blocked) {
        await activate(button("Talk to Timburr"));
        const retry = button("Retry 3D model");
        await retry.waitFor();
        assert.ok(blockedRequests > 0);
        assert.ok(await page.locator('.companion-board .figure-stage[data-view="portrait"] img').evaluate(el => el.complete && el.naturalWidth > 0));
        await page.unroute(blocked);
        await activate(retry);
        await page.locator('.companion-board .figure-stage[data-view="model"]').waitFor();
        await activate(button("Dismiss"));
      }
      if (scenario === "device-failures") {
        await page.getByRole("heading", { name: "The 3D view could not start." }).waitFor();
        assert.equal(await page.locator(".figure-stage").getAttribute("data-view"), "portrait");
      }
      if (scenario === "full-hand") {
        for (let i = 0; i < 6; i++) { await activate(button("Pass")); await activate(ready); }
        await activate(page.locator("[data-card-id]").last());
        await activate(button("Cancel targeting"));
        assert.ok(await page.locator(".release-cards").evaluate(el => el.scrollWidth > el.clientWidth && el.scrollLeft > 0));
      }
      await activate(button("Inspect"));
      await activate(button("Inspect committed response"));
      await page.getByLabel("Board overlay").waitFor();
      await choose(page.getByRole("combobox", { name: /^Inspect member/ }), 1);
      await choose(page.getByLabel("Section action"), 4);
      await page.getByRole("img", { name: /Moment My .* kN·m/ }).waitFor();
      await activate(page.getByText("Signed station readings", { exact: true }));
      for (const selector of [".release-header", ".release-stage", ".release-tray", ".release-end"]) {
        const fits = await page.locator(selector).evaluate(el => {
          const rect = el.getBoundingClientRect(); return rect.left >= -1 && rect.right <= innerWidth + 1;
        });
        assert.ok(fits, selector + " left the viewport while inspecting this hand");
      }
      await activate(button("Close inspection"));
      const frame = page.locator('[data-kind="element"]').filter({ hasText: /HEB/i }).first();
      await activate(frame);
      await activate(page.getByText("Precise placement", { exact: true }));
      for (const [label, value] of [["End A grid x,y,z", "5,7,1"], ["End B grid x,y,z", "5,8,2"]]) {
        const input = page.getByLabel(label);
        if (scenario === "keyboard") {
          await tabTo(input);
          await page.keyboard.type(value);
        } else await input.fill(value);
      }
      await activate(button("Stage element"));
      await button("Cancel draft").waitFor();
      if (scenario === "device-failures") {
        await activate(button("Menu"));
        await activate(button("Settings"));
        const toggle = page.getByRole("checkbox", { name: /^Sound/ }).first();
        await toggle.check();
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
        await activate(ready);
      }
      await page.screenshot({ path: resolve(output, scenario + ".png") });
      await activate(button("End turn"));
      await ready.waitFor();
      assert.equal(await page.locator("[data-card-id], .companion-board").count(), 0);
      assert.deepEqual(errors, []);
      evidence.cases.push({ scenario, viewport, cssWidth: width.viewport,
        input: scenario === "keyboard" ? "keyboard only" : scenario === "tablet-layout" ? "emulated touch" : "mouse", result: "pass" });
    } finally { await context.close(); }
  }
  await writeFile(resolve(output, "presentation.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally {
  await browser?.close();
  await new Promise(done => host.httpServer.close(done));
}
