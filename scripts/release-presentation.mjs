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
  for (const scenario of ["keyboard", "tablet-layout", "portrait-recovery", "narrow-layout", "device-failures", "native-zoom", "model-failure", "decoder-failure", "full-hand", "companion"]) {
    if (process.env.DOF_PRESENTATION_CASE && scenario !== process.env.DOF_PRESENTATION_CASE) continue;
    const viewport = scenario === "tablet-layout" ? { width: 1024, height: 768 }
      : scenario === "portrait-recovery" ? { width: 412, height: 915 }
      : scenario === "narrow-layout" ? { width: 683, height: 384 } : { width: 1366, height: 900 };
    const layout = { viewport, hasTouch: scenario === "tablet-layout" || scenario === "portrait-recovery",
      reducedMotion: scenario === "companion" ? "no-preference" : "reduce" };
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
      let companionResult;
      page.on("pageerror", error => errors.push(error.message));
      if (scenario === "companion" || scenario === "model-failure") {
        // Observe actual Web Audio node retirement across navigation. The
        // 185 Hz accent is distinct from selection and placement tones.
        await page.addInitScript(() => {
          window.foremanNotes = [];
          const create = BaseAudioContext.prototype.createOscillator;
          BaseAudioContext.prototype.createOscillator = function(...args) {
            const oscillator = create.apply(this, args), tune = oscillator.frequency.setValueAtTime.bind(oscillator.frequency);
            let start;
            oscillator.frequency.setValueAtTime = (value, at) => {
              if (value === 185) start = at;
              return tune(value, at);
            };
            const disconnect = oscillator.disconnect.bind(oscillator);
            oscillator.disconnect = (...options) => {
              if (start !== undefined) window.foremanNotes.push(this.currentTime - start);
              return disconnect(...options);
            };
            return oscillator;
          };
        });
      }
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
        else if (layout.hasTouch) await control.tap();
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
      async function drawFour() {
        for (const deck of ["members", "members", "connections", "loads"]) {
          const preferred = page.locator('[data-deck="' + deck + '"]');
          await activate(await preferred.isEnabled() ? preferred : page.locator("[data-deck]:enabled").first());
        }
        assert.equal(await page.locator("[data-deck]").count(), 0);
      }
      await activate(page.getByRole("link", { name: "Play", exact: true }));
      const ready = button("Ready · Reveal my hand");
      await ready.waitFor();
      assert.equal(await page.locator("[data-card-id]").count(), 0);
      await activate(ready);
      await drawFour();
      if (scenario === "companion") {
        await activate(button("Menu")); await activate(button("Settings"));
        await page.getByRole("checkbox", { name: /^Sound/ }).first().check();
        await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); await activate(ready);
      }
      await page.getByRole("region", { name: "Active hand" }).waitFor();
      assert.equal(await page.locator(".release-board").getAttribute("data-still"), String(layout.reducedMotion === "reduce"));
      const width = await page.evaluate(() => ({ body: document.documentElement.scrollWidth, viewport: innerWidth }));
      if (scenario === "native-zoom") {
        assert.ok(width.viewport >= viewport.width/2-1 && width.viewport <= viewport.width/2+1,
          `200% zoom did not halve the layout width (${width.viewport})`);
      }
      assert.ok(width.body <= width.viewport + 1, "Controls overflow horizontally");
      if (scenario === "portrait-recovery") {
        await page.getByText(/For a larger building surface/).waitFor();
        await activate(button("Menu"));
        await activate(button("Save files"));
        const downloaded = page.waitForEvent("download");
        await activate(button("Export private match"));
        assert.match((await downloaded).suggestedFilename(), /private.*\.json$/);
        await page.reload();
        await ready.waitFor();
        assert.equal(await page.locator("[data-card-id]").count(), 0);
        await activate(ready);
      }
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
      const companionTrial = scenario === "companion" || scenario === "model-failure";
      const passes = scenario === "full-hand" ? 6 : companionTrial ? 0 : 3;
      for (let i = 0; i < passes; i++) { await activate(button("Pass")); await activate(ready); await drawFour(); }
      if (scenario === "full-hand") {
        await activate(page.locator("[data-card-id]").last());
        await activate(button("Cancel targeting"));
        assert.ok(await page.locator(".release-cards").evaluate(el => el.scrollWidth > el.clientWidth && el.scrollLeft > 0));
      }
      async function inspectResponse() {
        await activate(button("Inspect"));
        const boardOverlay = page.getByRole("combobox", {name:/^Board overlay/});
        await boardOverlay.waitFor();
        await choose(boardOverlay, 3);
        await page.getByText(/^Frame displacement/).waitFor();
        await page.getByText(/^Signed gravity transfer/).waitFor();
        await activate(page.getByText("Foundation forces and moments", { exact: true }));
        const reactions = page.getByRole("table", {name: "Signed global support reaction"});
        assert.equal(await reactions.count(), 2);
        for (const table of await reactions.all()) {
          const values = await table.locator("tbody td").allTextContents();
          assert.equal(values.length, 6);
          assert.ok(values.every(value => value.trim() !== "" && Number.isFinite(Number(value.replaceAll(",", "")))));
        }
        await activate(page.getByText("Board force diagrams", { exact: true }));
        await choose(page.getByLabel("Shear diagram"), 2);
        await choose(page.getByLabel("Bending diagram"), 1);
        await page.getByText(/kN · mint/).waitFor();
        await page.getByText(/kN·m · pink/).waitFor();
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
      }
      if (!companionTrial) await inspectResponse();
      const frame = page.locator('[data-kind="element"]').first();
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
      if (["keyboard", "model-failure", "companion"].includes(scenario)) {
        await activate(ready);
        const warning = page.locator('.companion-note[data-instability="true"]');
        // The first committed turn is waiting on the third-turn checkpoint.
        assert.equal(await warning.count(), 0);
        assert.equal(await page.locator(".companion-board").getAttribute("data-foreman"), null);
        if (scenario !== "keyboard") {
          // Separate loose members create distinct charged turns for both
          // seats. Reload after their second pair to exercise restored counts.
          for (let turn = 2; turn <= 6; turn++) {
            await drawFour();
            if (turn < 6) {
              await activate(page.locator('[data-kind="element"]').first());
              await activate(page.getByText("Precise placement", { exact: true }));
              await page.getByLabel("End A grid x,y,z").fill(`${turn*2},6,4`);
              await page.getByLabel("End B grid x,y,z").fill(`${turn*2},7,4`);
              await activate(button("Stage element"));
              await activate(button("End turn"));
            } else await activate(button("Pass"));
            await ready.waitFor();
            assert.equal(await page.locator(".companion-board").count(), 0);
            if (turn === 6) {
              await page.evaluate(() => {
                window.companionPhases = [];
                const watch = new MutationObserver(() => {
                  const actor = document.querySelector(".companion-board[data-foreman]");
                  if (!actor || window.companionPhases.at(-1)?.phase === actor.dataset.foreman) return;
                  window.companionPhases.push({phase:actor.dataset.foreman,
                    motion:getComputedStyle(actor.querySelector(".figure-motion")).animationName});
                });
                watch.observe(document.body, {subtree:true, attributes:true, attributeFilter:["data-foreman"], childList:true});
              });
            }
            await activate(ready);
            if (turn === 3 || turn === 6) await warning.waitFor();
            else assert.equal(await warning.count(), 0);
            if (turn === 3) await inspectResponse();
            if (turn < 6) assert.equal(await page.locator(".companion-board").getAttribute("data-foreman"), null);
            if (turn === 4) {
              await page.reload();
              await activate(ready);
              assert.equal(await warning.count(), 0);
            }
          }
          await page.getByText("Conkeldurr has a foreman report for turn 5.", { exact: true }).waitFor();
          await page.getByText(/Player 1 has 3 verified deductions/).waitFor();
          const phases = await page.evaluate(() => window.companionPhases);
          companionResult = { checkpoint:6, originatingTurn:5, player:1, chargedTurns:3, phases };
          if (layout.reducedMotion === "reduce") {
            assert.deepEqual(phases, [{ phase:"reaction", motion:"none" }]);
            await activate(button("Skip transformation"));
          } else {
            assert.deepEqual(phases, [{phase:"shrink",motion:"foreman-shrink"}, {phase:"reaction",motion:"foreman-arrival"}]);
            await page.locator('.companion-board[data-foreman="reaction"] .figure-motion').evaluate(async el => {
              await Promise.all(el.getAnimations().map(animation => animation.finished));
            });
            await page.locator('.companion-board[data-foreman="reaction"] .figure-stage[data-view="model"]').waitFor();
            await page.screenshot({path:resolve(output, "conkeldurr.png")});
          }
          await button("Talk to Timburr").waitFor({timeout:7000});
          const notes = await page.evaluate(() => window.foremanNotes);
          assert.equal(notes.length, scenario === "companion" ? 1 : 0);
          if (notes.length) assert.ok(notes[0] >= .15, "The foreman accent was released before its envelope finished");
          companionResult.foremanVoices = notes.length;
          await page.reload(); await activate(ready);
          assert.equal(await page.getByRole("button", {name:"Talk to Conkeldurr"}).count(), 0);
        }
      }
      assert.deepEqual(errors, []);
      evidence.cases.push({ scenario, viewport, cssWidth: width.viewport, ...(companionResult && {companion:companionResult}),
        input: scenario === "keyboard" ? "keyboard only" : layout.hasTouch ? "emulated touch" : "mouse", result: "pass" });
    } catch (error) {
      const page = context.pages().at(-1);
      if (page) {
        console.error(scenario, await page.locator("h1, .release-status, .release-decks header, .companion-note").allTextContents());
        await page.screenshot({path:resolve(output, scenario + "-failed.png")}).catch(() => {});
      }
      throw error;
    } finally { await context.close(); }
  }
  assert.ok(evidence.cases.length, "No matching presentation case");
  await writeFile(resolve(output, "presentation.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally {
  await browser?.close();
  await new Promise(done => host.httpServer.close(done));
}
