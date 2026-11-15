// Real-input Shared table acceptance. Run with DOF_BROWSER_EXECUTABLE if needed.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

const root = path.resolve("apps/web");
const output = path.resolve(process.env.DOF_EVIDENCE_DIR || "/tmp/dof-cantilever-evidence");
const server = await createServer({root, cacheDir: path.join(output, "vite-cache"), configFile: path.join(root, "vite.config.ts"), server: {host: "127.0.0.1", port: 0, hmr: false}});
await server.listen();
const rules = await server.ssrLoadModule(path.join(root, "src/game/turns.ts"));
const catalogue = await server.ssrLoadModule(path.join(root, "src/game/cardCatalogue.ts"));
let deal;
for (let seed = 0; seed < 1000; seed++) {
  let turn = rules.createReleaseGame(seed, catalogue.CANTILEVER_CATALOGUE);
  for (const source of ["members", "connections", "connections", "loads"]) {
    const draw = rules.chooseTurnDraw(turn, source);
    if (!draw.ok) throw Error(draw.reason);
    turn = draw.state;
  }
  const hand = rules.activeTurnHand(turn);
  const frame = hand.find(c => c.kind === "element" && c.type === "heb" && c.maxSteps >= 4);
  const load = hand.find(c => c.kind === "load" && c.magnitude === 5);
  const fixed = hand.find(c => c.kind === "connection" && c.profile === "fixed");
  if (frame && load && fixed) {deal = {seed, frame, load, fixed}; break;}
}
assert.ok(deal, "No genuine opening deal supplies the fixture");
const browser = await chromium.launch({headless: true, executablePath: process.env.DOF_BROWSER_EXECUTABLE || undefined,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]});
const evidence = {browser: browser.version(), seed: deal.seed, cases: []};
await mkdir(output, {recursive: true});
try {
  for (const input of (process.env.DOF_INPUTS || "pointer,scene,precise,keyboard,touch,gpu-fallback").split(",")) {
    const context = await browser.newContext({viewport: input === "touch" ? {width: 1180, height: 820} : {width: 1440, height: 1000},
      hasTouch: input === "touch", reducedMotion: "reduce"});
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(({fallback}) => {
        localStorage.setItem("dof.settings", JSON.stringify({sound: false, reducedMotion: true, showCompanion: false}));
        if (fallback) {
          const get = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function(kind, ...args) {return String(kind).startsWith("webgl") ? null : get.call(this, kind, ...args);};
        }
      }, {fallback: input === "gpu-fallback"});
      const button = name => page.getByRole("button", {name, exact: true});
      async function activate(locator) {
        if (input === "keyboard") {
          for (let i = 0; i < 150; i++) {
            if (await locator.evaluate(el => el === document.activeElement)) break;
            const earlier = await locator.evaluate(el => !!(document.activeElement.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING));
            await page.keyboard.press(earlier ? "Shift+Tab" : "Tab");
          }
          assert.ok(await locator.evaluate(el => el === document.activeElement));
          await page.keyboard.press("Enter");
        } else if (input === "touch") await locator.tap();
        else await locator.click();
      }
      async function select(locator, value) {
        if (input === "keyboard") {
          await locator.focus();
          const index = await locator.evaluate((el, wanted) => [...el.options].findIndex(option => option.value === wanted), value);
          assert.ok(index >= 0, "Missing exact candidate " + value);
          await page.keyboard.press("Home");
          for (let i = 0; i < index; i++) await page.keyboard.press("ArrowDown");
          await page.keyboard.press("Tab");
        } else await locator.selectOption(value);
        await expect(locator).toHaveValue(value);
      }
      await page.goto(server.resolvedUrls.local[0] + "match?seed=" + deal.seed);
      await activate(button("Ready · Reveal my hand"));
      for (const [index, source] of ["members", "connections", "connections", "loads"].entries()) {
        await activate(page.locator(`[data-deck="${source}"]`));
        await page.waitForFunction(expected => {
          const cards = document.querySelectorAll("[data-card-id]");
          return cards.length === expected;
        }, index + 1);
      }
      await page.waitForFunction(async () => (await import("/src/game/store.ts")).useGameStore.getState().sessionSave === "idle");
      await select(page.getByRole("combobox", {name: /^Calculate every/}), "1");
      await page.waitForFunction(async () => (await import("/src/game/store.ts")).useGameStore.getState().sessionSave === "idle");
      await activate(page.locator(`[data-card-id="${deal.frame.id}"]`));
      if (input === "scene") {
        // Observe the production camera for projection; placement itself uses
        // ordinary canvas pointer events through the real picker.
        await page.evaluate(async () => {
          const url = performance.getEntriesByType("resource").find(resource => /\/three\.js(?:\?|$)/.test(resource.name))?.name;
          if (!url) throw Error("Three.js module not found");
          const {Vector3} = await import(url), project = Vector3.prototype.project;
          Vector3.prototype.project = function(camera) {
            Vector3.prototype.project = project;
            window.cantileverPixel = point => {
              const p = new Vector3(...point).multiplyScalar(2).project(camera);
              const rect = document.querySelector("canvas").getBoundingClientRect();
              return {x: rect.x + (1+p.x)*rect.width/2, y: rect.y + (1-p.y)*rect.height/2};
            };
            return project.call(this, camera);
          };
        });
        await page.mouse.move(700, 350);
        await page.waitForFunction(() => !!window.cantileverPixel);
        const at = await page.evaluate(() => window.cantileverPixel([5,7,1]));
        await page.mouse.click(at.x, at.y);
      } else await select(page.getByLabel("Element attachment point", {exact: true}), "5,7,1");
      await activate(button("Attach at ¼"));
      if (input === "scene") {
        const at = await page.evaluate(() => window.cantileverPixel([8,7,1]));
        await page.mouse.move(at.x, at.y);
        await page.locator("#growth-length").filter({hasText: /8.00 m.*2.00 m.*6.00 m/}).waitFor();
        await page.screenshot({path: path.join(output, `${input}-preview.png`)});
        await page.mouse.click(at.x, at.y);
      } else if (input === "precise") {
        await activate(page.getByText("Precise placement", {exact: true}));
        await page.getByLabel("End A grid x,y,z", {exact: true}).fill("4,7,1");
        await page.getByLabel("End B grid x,y,z", {exact: true}).fill("8,7,1");
        await activate(button("Stage element"));
      } else {
        await select(page.getByLabel("Element free tip", {exact: true}), "8,7,1");
        await page.locator(".release-placement-note").filter({hasText: /8 m.*2 m.*6 m/}).waitFor();
        await page.screenshot({path: path.join(output, `${input}-preview.png`)});
        await activate(button("Place element"));
      }
      const attachment = page.getByLabel("Staged element attachments");
      await attachment.getByText("Unconnected", {exact: true}).waitFor();
      await activate(button("Attach with Fixed connector"));
      await attachment.getByText("Attached", {exact: true}).waitFor();
      const inspectDraft = () => page.evaluate(async () => {
        const game = (await import("/src/game/store.ts")).useGameStore.getState();
        return {catalogue: game.turn.catalogue, draft: game.turn.draft, board: game.turn.board};
      });
      const draft = await inspectDraft();
      assert.equal(draft.catalogue, catalogue.CANTILEVER_CATALOGUE);
      assert.equal(draft.draft.members.length, 1);
      assert.equal(draft.draft.connections.length, 1);
      assert.equal(draft.draft.members[0].a, "4,7,1");
      assert.equal(draft.draft.members[0].b, "8,7,1");
      assert.equal(draft.draft.connections[0].end, "q1");
      await page.reload();
      await activate(button("Ready · Reveal my hand"));
      assert.deepEqual((await inspectDraft()).draft, draft.draft);
      await activate(page.locator(`[data-card-id="${deal.load.id}"]`));
      await select(page.getByRole("combobox", {name: /^Load target/}), "endpoint:3:b");
      await activate(button("Place load"));
      await activate(button("End turn"));
      await button("Ready · Reveal my hand").waitFor();
      assert.equal(await page.locator("[data-card-id]").count(), 0, "Private hand leaked across handoff");
      await activate(button("Ready · Reveal my hand"));
      const committed = await inspectDraft();
      assert.equal(committed.board.connections.filter(c => c.memberId === 3 && c.end === "q1").length, 1);
      assert.equal(committed.board.loads[0].magnitude, 5);
      assert.equal(committed.board.members.find(member => member.id === 3).b, "8,7,1");
      const size = await page.evaluate(() => ({width: innerWidth, scroll: document.documentElement.scrollWidth}));
      assert.ok(size.scroll <= size.width + 1, "Controls overflow horizontally");
      assert.deepEqual(errors, []);
      await page.screenshot({path: path.join(output, `${input}-committed.png`)});
      evidence.cases.push({input, passed: true, source: "q1", endpoints: ["4,7,1", "8,7,1"], loadKN: 5});
      console.log(`${input}: quarter support, explicit connector, reload, load, assessment and private handoff passed`);
    } catch (error) {
      const page = context.pages()[0];
      if (page) await page.screenshot({path: path.join(output, `${input}-failure.png`)}).catch(() => {});
      throw error;
    } finally {await context.close();}
  }
  await writeFile(path.join(output, "results.json"), JSON.stringify(evidence, null, 2) + "\n");
} finally {
  await browser.close(); await server.close();
}
