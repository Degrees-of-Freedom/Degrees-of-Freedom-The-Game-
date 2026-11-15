// node check.mjs <workspace> <Playwright module> <Chrome executable> <before|after|brace-before|brace-after>
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const [workspace, playwright, executablePath, phase] = process.argv.slice(2);
assert.ok(["before", "after", "brace-before", "brace-after"].includes(phase));
const root = resolve(workspace, "apps/web");
const server = await createServer({ root, configFile: resolve(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
const { chromium } = createRequire(import.meta.url)(playwright);
const browser = await chromium.launch({ executablePath, headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  await server.listen();
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    // Resume the same unfinished draft on both builds. The end action below
    // is the first opportunity to assess, charge or publish the outcome.
    if (!localStorage.getItem("dof-runtime:session")) localStorage.setItem("dof-runtime:session",
      JSON.stringify({ version: 1, style: "grow-dusk", mode: "multiplayer", turn: {
        version: 1, catalogue: "shared-table-frame-1", seed: 7, events: [
          { kind: "element", cardId: "element-6", a: "port:1:1", b: "port:2:1" },
          { kind: "connection", cardId: "connection-13", memberId: 3, end: "a" },
          { kind: "load", cardId: "load-18", jointId: "port:1:1" },
        ],
      } }));
  });
  await page.goto(new URL("/play", server.resolvedUrls.local[0]).href);
  const ready = page.getByRole("button", { name: "Ready · Reveal my hand" });
  const details = page.getByRole("button", { name: "Turn details" });
  const panel = page.getByLabel("Shared-table turn");
  await ready.click();
  await details.click();
  await panel.getByRole("button", { name: "End turn / pass" }).click();
  await page.getByRole("heading", { name: "Pass to Player 2" }).waitFor();
  await page.reload();
  await ready.click();
  if (phase.startsWith("brace-")) {
    const props = await page.evaluate(async () => {
      const { useGameStore } = await import("/src/game/store.ts");
      return useGameStore.getState().turn.board.members.filter(member => member.system);
    });
    assert.equal(props.length, phase === "brace-after" ? 1 : 0);
    if (props.length) {
      assert.equal(props[0].owner, "neutral");
      assert.equal(props[0].endTargets.a, "port:3:2");
      assert.equal(props[0].b, "3,2,0");
    }
    await page.getByRole("button", { name: "Fit", exact: true }).first().click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: fileURLToPath(new URL("../match/" + phase + ".png", import.meta.url)) });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ browser: browser.version(), phase, props }));
  } else {
    await details.click();
    await panel.waitFor();
    const summary = panel.getByText("Turn deductions (1)", { exact: true });
    const publicReport = await page.evaluate(async () => {
      const { useGameStore } = await import("/src/game/store.ts");
      const { publicTurnModel } = await import("/src/game/publicTurnModel.ts");
      return publicTurnModel(useGameStore.getState().turn).reports[0];
    });
    if (phase === "after") {
      assert.equal(publicReport.penalty, -1);
      assert.deepEqual(publicReport.penaltyReasons.map(r => r.id), ["instability:3"]);
      await summary.click();
      await panel.getByText("Turn 1 · Player 1 · −1 point", { exact: true }).waitFor();
      await panel.getByText(/Member 3 · new instability/).waitFor();
    } else {
      assert.equal(publicReport.penalty, 0);
      assert.equal(await summary.count(), 0);
    }
    await page.screenshot({ path: fileURLToPath(new URL(phase + ".png", import.meta.url)) });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ browser: browser.version(), phase, publicReport, errors }));
  }
} finally {
  await browser.close();
  await server.close();
}
