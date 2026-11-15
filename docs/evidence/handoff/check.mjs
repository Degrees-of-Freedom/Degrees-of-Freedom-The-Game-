// node check.mjs <repository root> <before|after> <playwright module> <Chrome executable>
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createServer } from "vite";

const [repository, phase, playwright, executablePath] = process.argv.slice(2);
assert.ok(["before", "after"].includes(phase));
const root = resolve(repository, "apps/web");
const output = fileURLToPath(new URL(phase + ".png", import.meta.url));
const server = await createServer({ root, configFile: resolve(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
const { chromium } = createRequire(import.meta.url)(playwright);
const browser = await chromium.launch({ executablePath, headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  await server.listen();
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    if (localStorage.getItem("dof-runtime:session")) return;
    localStorage.setItem("dof.settings", JSON.stringify({ sound: false, reducedMotion: true, showHelpOnStart: false }));
    // Player 1 passed. Player 2 has staged the 5 kN card on the first player's column.
    localStorage.setItem("dof-runtime:session", JSON.stringify({
      version: 1, mode: "multiplayer", style: "grow-dusk", turn: { version: 1, seed: 23,
        events: [{ kind: "end", turn: 1 }, { kind: "load", cardId: "load-20", jointId: "1,3,1" }] }
    }));
  });
  await page.goto(new URL("/play", server.resolvedUrls.local[0]).href);
  const snapshot = () => page.evaluate(async () => {
    const { useGameStore } = await import("/src/game/store.ts");
    const { turn } = useGameStore.getState();
    return { turn: turn.turn, events: turn.events, finished: turn.finished,
      hands: turn.players.map(p => p.hand.map(c => c.id)), draft: turn.draft };
  });
  const ready = page.getByRole("button", { name: "Ready · Reveal my hand" });
  const end = page.getByRole("button", { name: "End turn", exact: true });
  const closed = async player => {
    await page.getByRole("heading", { name: "Pass to Player " + player }).waitFor();
    assert.equal(await page.locator("canvas, .env-tray, .turn-panel, #toast, #hint, #drawer").count(), 0);
    assert.equal(await page.locator("button").count(), 1);
    assert.match(await page.locator("main").innerText(), /^Pass to Player [12]\s+Ready · Reveal my hand$/);
  };
  if (phase === "before") {
    await end.waitFor();
    await page.locator("canvas").waitFor();
    assert.ok(await page.getByRole("button", { name: "Reveal hand" }).isVisible());
    await page.screenshot({ path: output });
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("#who span")?.textContent?.includes("Turn 3"));
    assert.equal((await snapshot()).turn, 3, "baseline advances the unrevealed player's turn");
  } else {
    await closed(2);
    const staged = await snapshot();
    assert.equal(staged.turn, 2);
    assert.equal(staged.draft.loads[0].cardId, "load-20");
    await page.screenshot({ path: output });
    await page.keyboard.press("Enter");
    assert.deepEqual(await snapshot(), staged);
    // Deliberate keyboard reveal now opens both the tray and details together.
    await page.keyboard.press("Tab");
    assert.equal(await ready.evaluate(button => button === document.activeElement), true);
    await page.keyboard.press("Enter");
    await page.getByLabel("Card tray").waitFor();
    await page.getByRole("button", { name: "Turn details" }).click();
    await page.getByLabel("player-2 hand").waitFor();
    assert.equal(await page.getByLabel("player-1 hand").count(), 0);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await closed(2);
    assert.deepEqual(await snapshot(), staged);
    await page.reload();
    await closed(2);
    assert.deepEqual(await snapshot(), staged);
    const readyBounds = await ready.boundingBox();
    assert.ok(readyBounds);
    await page.mouse.dblclick(readyBounds.x + readyBounds.width / 2, readyBounds.y + readyBounds.height / 2);
    assert.deepEqual(await snapshot(), staged);
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("button", { name: "Resume" }).click();
    await closed(2);
    await ready.click();
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await closed(2);
    assert.deepEqual(await snapshot(), staged);
    await ready.click();
    await page.keyboard.down("Enter");
    await closed(1);
    await page.keyboard.down("Enter");
    await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    await closed(1);
    assert.equal((await snapshot()).turn, 3);
    for (let n = 3; n <= 16; n++) {
      await ready.click();
      const bounds = await end.boundingBox();
      assert.ok(bounds);
      await page.mouse.dblclick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      if (n < 16) await closed(n % 2 === 0 ? 1 : 2);
    }
    assert.equal(await ready.count(), 0);
    assert.equal(await page.getByLabel("Card tray").count(), 0);
    const final = await snapshot();
    assert.equal(final.turn, 16);
    assert.equal(final.finished, true);
    assert.equal(final.events.filter(event => event.kind === "end").length, 16);
    await page.getByRole("button", { name: "New match", exact: true }).click();
    await closed(1);
    assert.equal((await snapshot()).turn, 1);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ phase, chrome: browser.version(), seed: 23, result: "passed" }));
} finally {
  await browser.close();
  await server.close();
}
