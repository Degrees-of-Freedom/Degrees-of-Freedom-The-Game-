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
const { chromium } = createRequire(import.meta.url)(playwright);
const browser = await chromium.launch({ executablePath, headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const shot = (page, name) => page.screenshot({ path: fileURLToPath(new URL(name + ".png", import.meta.url)) });
try {
  await server.listen();
  const engine = await server.ssrLoadModule("/src/game/turns.ts");
  for (const seed of [7, 1]) {
    let turn = engine.createTurnGame(seed, "shared-table-frame-1");
    function apply(result) { assert.ok(result.ok, result.reason); turn = result.state; }
    const card = (kind, profile) => engine.activeTurnHand(turn).find(c =>
      c.kind === kind && (!profile || c.profile === profile)).id;
    if (seed === 7) {
      apply(engine.stageElement(turn, "element-6", "port:1:1", "port:2:1"));
      apply(engine.stageConnection(turn, "connection-13", 3, "a"));
      apply(engine.stageLoad(turn, "load-18", "port:1:1"));
    } else {
      for (const [member, end] of [[3, "1,2,1"], [4, "2,3,1"]]) {
        apply(engine.stageElement(turn, card("element"), "1,3,1", end));
        apply(engine.stageConnection(turn, card("connection", "fixed"), member, "a"));
        if (member === 4) apply(engine.stageLoad(turn, card("load"), "1,3,1"));
        apply(engine.endTurn(turn));
      }
      apply(engine.stageElement(turn, card("element"), "1,3,2", "2,3,2"));
    }
    const starting = { version: 1, style: "grow-dusk", mode: "multiplayer",
      turn: { version: 1, catalogue: turn.catalogue, seed, events: turn.events } };
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(save => {
      if (!localStorage.getItem("dof-runtime:session")) localStorage.setItem("dof-runtime:session", JSON.stringify(save));
    }, starting);
    await page.goto(new URL("/play", server.resolvedUrls.local[0]).href);
    const ready = page.getByRole("button", { name: "Ready · Reveal my hand" });
    const details = page.getByRole("button", { name: "Turn details" });
    const panel = page.getByLabel("Shared-table turn");
    await ready.click();
    await details.click();
    await panel.getByRole("button", { name: "End turn / pass" }).click();
    await page.getByRole("heading", { name: "Pass to Player 2" }).waitFor();
    assert.equal(await page.locator(".turn-panel").count(), 0);
    await page.reload();
    await ready.click();
    await details.click();
    const report = await page.evaluate(async () => {
      const { useGameStore } = await import("/src/game/store.ts");
      return useGameStore.getState().turn.reports.at(-1);
    });
    const pending = seed === 1;
    assert.equal(report.correction.pending.length > 0, pending);
    assert.equal(report.penalty, -1);
    const summary = panel.locator("summary").filter({ hasText: "Repair history" });
    if (phase === "before") {
      assert.equal(await summary.count(), 0);
      await panel.getByText("Turn deductions (1)", { exact: true }).click();
    } else {
      // Reach the disclosure through tab order and activate it without a pointer.
      const activate = async locator => {
        for (let i = 0; i < 180; i++) {
          if (await locator.evaluate(e => e === document.activeElement)) {
            await page.keyboard.press("Space");
            return;
          }
          await page.keyboard.press("Tab");
        }
        throw Error("Unreachable disclosure");
      };
      await activate(summary);
      const history = panel.getByRole("region", { name: "Repair history" });
      const visible = await history.innerText();
      assert.match(visible, /−1 point/);
      assert.match(visible, pending ? /Repair pending/ : /Verified repair/);
      assert.match(visible, pending ? /Member 5/i : /Member 3/i);
      assert.match(visible, pending ? /3 rejected/ : /50%/);
      const evidence = history.locator("summary").filter({ hasText: "Verification details" });
      await activate(evidence);
      const table = history.getByRole("table");
      assert.equal(await table.count(), 1);
      const results = await table.innerText();
      if (!pending) {
        assert.match(results, /Neutral/);
        assert.match(results, /Unavailable/);
      }
      await activate(evidence);
    }
    await shot(page, (pending ? "pending-" : "") + phase);
    if (phase === "after" && seed === 7) {
      for (let next = 2; next <= 16; next++) {
        await panel.getByRole("button", { name: "End turn / pass" }).click();
        if (next < 16) {
          await ready.click();
          await details.click();
        }
      }
      await page.getByRole("heading", { name: "Table complete" }).waitFor();
      await page.reload();
      await page.getByRole("heading", { name: "Table complete" }).waitFor();
      await summary.click();
      assert.match(await panel.getByRole("region", { name: "Repair history" }).innerText(), /Verified repair/);
    }
    console.log(JSON.stringify({ phase, seed, browser: browser.version(), pending: report.correction.pending,
      attempts: report.correction.attempts.map(a => [a.contact, a.ground, a.status]), errors }));
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally { await browser.close(); await server.close(); }
