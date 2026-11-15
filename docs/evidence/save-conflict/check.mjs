// node check.mjs <workspace> <playwright module> <Chrome executable> <before|after>
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
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

try {
  await server.listen();
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 });
  const pages = await Promise.all([context.newPage(), context.newPage()]);
  const errors = [];
  pages.forEach(page => page.on("pageerror", err => errors.push(err.message)));
  const url = new URL("/play", server.resolvedUrls.local[0]).href;
  // Both views open the same legacy saved match before either makes a move.
  await context.addInitScript(() => {
    if (!localStorage.getItem("dof-runtime:session")) {
      localStorage.setItem("dof-runtime:session", JSON.stringify({ version: 1, mode: "multiplayer",
        style: "grow-dusk", turn: { version: 1, seed: 23, events: [] } }));
    }
  });
  await Promise.all(pages.map(page => page.goto(url)));
  await Promise.all(pages.map(page => page.evaluate(async () => {
    const { useGameStore } = await import("/src/game/store.ts");
    if (useGameStore.getState().turn.turn !== 1) throw Error("Expected both views at turn 1");
  })));
  const action = (page, fn) => page.evaluate(async fn => {
    const { useGameStore } = await import("/src/game/store.ts");
    return useGameStore.getState()[fn]();
  }, fn);
  const [first, second] = pages;
  const bytes = page => page.evaluate(() => localStorage.getItem("dof-runtime:session"));
  const ends = raw => JSON.parse(raw).turn.events.filter(event => event.kind === "end").length;
  if (phase === "before") {
    await action(first, "endTurn");
    await action(first, "endTurn");
    assert.equal(ends(await bytes(first)), 2);
    await action(second, "endTurn");
    assert.equal(ends(await bytes(first)), 1, "Baseline regresses turn 3 to turn 2");
    await second.bringToFront();
  } else {
    // Force both in-memory actions to queue against the exact same head. The
    // browser's real lock manager schedules the competing tabs when released.
    await first.evaluate(async () => {
      await new Promise(resolve => navigator.locks.request("dof-runtime:session", () => {
        resolve();
        return new Promise(release => { window.releaseFixtureLock = release; });
      }));
    });
    assert.deepEqual(await Promise.all(pages.map(page => action(page, "endTurn"))), [null, null]);
    await first.evaluate(() => window.releaseFixtureLock());
    await Promise.any(pages.map(page => page.getByRole("heading", { name: "Saved session changed" }).waitFor()));
    const loser = await first.getByText("Saved session changed").count() ? first : second;
    const winner = loser === first ? second : first;
    await winner.evaluate(async () => {
      await navigator.locks.request("dof-runtime:session", () => {});
    });
    assert.equal(ends(await bytes(winner)), 1);
    await action(winner, "endTurn");
    await winner.waitForFunction(() => JSON.parse(localStorage.getItem("dof-runtime:session")).revision === 2);
    const head = await bytes(winner);
    assert.equal(ends(head), 2);
    assert.match(await action(loser, "endTurn"), /Another tab/);
    assert.equal(await bytes(loser), head);
    await loser.bringToFront();
    assert.equal(await loser.locator("canvas, .turn-panel, .env-tray").count(), 0);
    await loser.screenshot({ path: fileURLToPath(new URL("after.png", import.meta.url)) });
    await loser.getByRole("button", { name: "Reload saved game" }).click();
    await loser.getByRole("heading", { name: "Pass to Player 1" }).waitFor();
    assert.equal(await bytes(loser), head);
    assert.equal(await loser.locator("canvas, .turn-panel, .env-tray").count(), 0);
    assert.deepEqual(errors, []);
  }
  if (phase === "before") await second.screenshot({ path: fileURLToPath(new URL("before.png", import.meta.url)) });
  console.log(JSON.stringify({ result: "passed", phase, seed: 23, chrome: browser.version() }));
} finally {
  await browser.close();
  await server.close();
}
