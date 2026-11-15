// Exercise the built client with real browser input. The small viewport and
// touch context are desktop emulation, recorded separately from device gates.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { preview } from "vite";

const root = resolve("apps/web");
const output = resolve(process.env.DOF_EVIDENCE_DIR || ".venv/release-evidence");
const host = await preview({ root, build: { outDir: resolve(process.env.DOF_TEST_DIST || "apps/web/dist") },
  preview: { host: "127.0.0.1", port: 0 } });
const evidence = { cases: [] };
let browser;
try {
  const launch = { headless: true, executablePath: process.env.DOF_BROWSER_EXECUTABLE || undefined,
    args: process.env.DOF_SOFTWARE_GL ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : [] };
  browser = await chromium.launch(launch);
  evidence.browser = browser.version();
  await mkdir(output, { recursive: true });
  for (const scenario of ["keyboard", "tablet-layout", "narrow-layout", "device-failures", "native-zoom"]) {
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
      async function activate(control) {
        if (scenario === "keyboard") {
          for (let i = 0; i < 100; i++) {
            if (await control.evaluate(el => el === document.activeElement)) { await page.keyboard.press("Enter"); return; }
            const earlier = await control.evaluate(el => !!(document.activeElement.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING));
            await page.keyboard.press(earlier ? "Shift+Tab" : "Tab");
          }
          throw new Error("Keyboard focus could not reach " + await control.textContent());
        }
        if (scenario === "tablet-layout") await control.tap();
        else await control.click();
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
      if (scenario === "device-failures") {
        await page.getByRole("heading", { name: "The 3D view could not start." }).waitFor();
        assert.equal(await page.locator(".figure-stage").getAttribute("data-view"), "portrait");
      }
      await activate(button("Inspect"));
      await activate(button("Inspect committed response"));
      await page.getByLabel("Board overlay").waitFor();
      await activate(button("Close inspection"));
      const frame = page.locator('[data-kind="element"]').filter({ hasText: /HEB/i }).first();
      await activate(frame);
      await activate(page.getByText("Precise placement", { exact: true }));
      for (const [label, value] of [["End A grid x,y,z", "5,7,1"], ["End B grid x,y,z", "5,8,2"]]) {
        const input = page.getByLabel(label);
        if (scenario === "keyboard") {
          for (let i = 0; i < 100 && !await input.evaluate(el => el === document.activeElement); i++) await page.keyboard.press("Tab");
          assert.ok(await input.evaluate(el => el === document.activeElement));
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
        input: scenario === "keyboard" ? "Tab/Enter" : scenario === "tablet-layout" ? "emulated touch" : "mouse", result: "pass" });
    } finally { await context.close(); }
  }
  await writeFile(resolve(output, "presentation.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally {
  await browser?.close();
  await new Promise(done => host.httpServer.close(done));
}
