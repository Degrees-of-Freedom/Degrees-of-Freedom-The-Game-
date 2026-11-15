// node check.mjs <workspace> <playwright module> <Chrome executable> <before|after>
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
const key = "dof-runtime:session";
const seed = 23;
const fixture = (events = []) => JSON.stringify({ version: 1, mode: "multiplayer", style: "grow-dusk",
  turn: { version: 1, seed, catalogue: "shared-table-frame-1", events } });
const primary = page => page.evaluate(key => localStorage.getItem(key), key);
const privateUI = page => page.locator("canvas, .turn-panel, .env-tray, [aria-label='Final score']");
async function concealed(page) {
  assert.equal(await privateUI(page).count(), 0);
  assert.equal(await page.evaluate(() => window.privateMountsBeforeReady), 0);
}
const ready = page => page.getByRole("button", { name: /Ready.*reveal/i });
const end = page => page.getByRole("button", { name: "End turn", exact: true });
const hold = keeper => keeper.evaluate(key => new Promise(acquired => {
  navigator.locks.request(key, () => new Promise(release => {
    window.releaseTestLock = release;
    acquired();
  }));
}), key);
const release = keeper => keeper.evaluate(() => window.releaseTestLock());

try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const keeper = await context.newPage();
  // A plain same-origin page holds real Web Locks across game reloads.
  const anchorURL = new URL("/fixture-lock", origin).href;
  await keeper.route(anchorURL, route => route.fulfill({ contentType: "text/html", body: "<title>Fixture lock</title>" }));
  await keeper.goto(anchorURL);
  const install = (raw, backup = null) => keeper.evaluate(({ key, raw, backup }) => {
    localStorage.clear();
    localStorage.setItem(key, raw);
    if (backup) localStorage.setItem(key + ":previous", backup);
    localStorage.setItem("dof.settings", JSON.stringify({ sound: false, reducedMotion: true, showHelpOnStart: false }));
  }, { key, raw, backup });
  const original = fixture();
  await install(original);
  const game = await context.newPage();
  await game.addInitScript(() => {
    let watch = sessionStorage.getItem("public-final-fixture") !== "yes";
    window.privateMountsBeforeReady = 0;
    const privateNode = "canvas, .turn-panel, .env-tray, [aria-label='Final score']";
    const observer = new MutationObserver(records => {
      if (!watch) return;
      for (const record of records) for (const node of record.addedNodes) {
        if (node.nodeType === 1 && (node.matches(privateNode) || node.querySelector(privateNode))) window.privateMountsBeforeReady++;
      }
    });
    observer.observe(document, { childList: true, subtree: true });
    document.addEventListener("click", e => {
      if (e.target.closest?.("button")?.textContent?.includes("Reveal my hand")) watch = false;
    }, true);
  });
  const errors = [];
  game.on("pageerror", error => errors.push(error.message));
  await game.goto(new URL("/play", origin).href);
  await ready(game).click();
  await hold(keeper);
  await end(game).click();
  if (phase === "before") {
    await game.getByRole("heading", { name: "Pass to Player 2" }).waitFor();
  } else {
    await game.getByRole("heading", { name: "Saving turn" }).waitFor();
    assert.equal(await ready(game).count(), 0);
    assert.equal(await privateUI(game).count(), 0);
  }
  assert.equal(await primary(game), original);
  await game.screenshot({ path: fileURLToPath(new URL(phase + ".png", import.meta.url)) });
  if (phase === "after") {
    await game.reload();
    await game.getByRole("heading", { name: "Pass to Player 1" }).waitFor();
    await concealed(game);
    await release(keeper);
    assert.equal(await primary(game), original);
    await ready(game).click();
    await game.evaluate(key => {
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k, v) {
        if (k === key && window.simulateQuota) throw new DOMException("Fixture quota", "QuotaExceededError");
        return write.call(this, k, v);
      };
      window.simulateQuota = true;
    }, key);
    await end(game).click();
    await game.getByRole("heading", { name: "Save interrupted" }).waitFor();
    assert.equal(await primary(game), original);
    assert.equal(await privateUI(game).count(), 0);
    const downloaded = game.waitForEvent("download");
    await game.getByRole("button", { name: "Download unsaved private match" }).click();
    const exported = JSON.parse(await readFile(await (await downloaded).path(), "utf8"));
    assert.equal(exported.turn.events.filter(e => e.kind === "end").length, 1);
    await game.evaluate(() => { window.simulateQuota = false; });
    await game.getByRole("button", { name: "Retry save" }).click();
    await game.getByRole("heading", { name: "Pass to Player 2" }).waitFor();
    const next = await primary(game);
    assert.deepEqual(JSON.parse(next).turn, exported.turn);
    assert.equal(JSON.parse(next).revision, 1);
    assert.equal(await game.evaluate(key => localStorage.getItem(key + ":previous"), key), original);
    await game.reload();
    await game.getByRole("heading", { name: "Pass to Player 2" }).waitFor();
    await concealed(game);
    assert.equal(await primary(game), next);

    const events = Array.from({ length: 15 }, (_, i) => ({ kind: "end", turn: i + 1, status: "stable" }));
    const last = fixture(events);
    await install(last);
    await game.reload();
    await ready(game).click();
    await hold(keeper);
    await end(game).click();
    await game.getByRole("heading", { name: "Saving turn" }).waitFor();
    assert.equal(await privateUI(game).count(), 0);
    assert.equal(await primary(game), last);
    await release(keeper);
    await game.getByRole("heading", { name: "Table complete" }).waitFor();
    const final = await primary(game);
    assert.equal(JSON.parse(final).turn.events.filter(e => e.final).length, 1);
    await game.evaluate(() => sessionStorage.setItem("public-final-fixture", "yes"));
    await game.reload();
    await game.getByRole("heading", { name: "Table complete" }).waitFor();
    assert.equal(await primary(game), final);
    await game.evaluate(() => sessionStorage.removeItem("public-final-fixture"));

    for (const damaged of ["{incomplete", JSON.stringify({ version: 91 }), " ".repeat(2_000_001)]) {
      await install(damaged, next);
      await game.reload();
      await game.getByRole("heading", { name: "Recover saved session" }).waitFor();
      await concealed(game);
      assert.equal(await primary(game), damaged);
      const download = game.waitForEvent("download");
      await game.getByRole("button", { name: "Download original private save" }).click();
      assert.equal(await readFile(await (await download).path(), "utf8"), damaged);
      await game.getByRole("button", { name: "Restore previous save" }).click();
      await game.getByRole("heading", { name: "Pass to Player 2" }).waitFor();
      await concealed(game);
      assert.deepEqual(JSON.parse(await primary(game)).turn, JSON.parse(next).turn);
      assert.equal(await game.evaluate(key => localStorage.getItem(key + ":damaged"), key), damaged);
    }
    await install("{incomplete");
    await game.reload();
    await game.getByRole("button", { name: "Keep damaged save and start new match" }).click();
    await game.getByRole("heading", { name: "Pass to Player 1" }).waitFor();
    await concealed(game);
    assert.equal(JSON.parse(await primary(game)).turn.events.length, 0);
    await install("{unarchivable", next);
    await game.reload();
    await game.evaluate(key => {
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k, v) {
        if (k === key + ":damaged") throw new DOMException("Fixture quota", "QuotaExceededError");
        return write.call(this, k, v);
      };
    }, key);
    await game.getByRole("button", { name: "Restore previous save", exact: true }).click();
    await game.getByText(/Local storage could not keep a copy/).waitFor();
    assert.equal(await primary(game), "{unarchivable");
    const external = game.waitForEvent("download");
    await game.getByRole("button", { name: "Download original private save" }).click();
    assert.equal(await readFile(await (await external).path(), "utf8"), "{unarchivable");
    await game.getByRole("button", { name: /I saved a copy/ }).click();
    await game.getByRole("heading", { name: "Pass to Player 2" }).waitFor();
    await concealed(game);
    assert.deepEqual(errors, []);
  }
  console.log(JSON.stringify({ phase, seed, chrome: browser.version(), result: "passed" }));
} finally { await browser.close(); await server.close(); }
