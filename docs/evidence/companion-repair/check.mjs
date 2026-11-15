// node check.mjs <workspace> <Playwright module> <Chrome executable> <before|after> [single seed]
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const [workspace, playwright, executablePath, phase, singleSeed] = process.argv.slice(2);
assert.ok(["before", "after"].includes(phase));
const root = resolve(workspace, "apps/web");
const server = await createServer({ root, configFile: resolve(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
const browser = await createRequire(import.meta.url)(playwright).chromium.launch({ executablePath, headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  await server.listen();
  const engine = await server.ssrLoadModule("/src/game/turns.ts");
  const seeds = phase === "after" ? [7, 1, 97] : [7, 1];
  if (singleSeed) assert.ok(seeds.includes(Number(singleSeed)));
  for (const seed of singleSeed ? [Number(singleSeed)] : seeds) {
    const pending = seed === 1;
    let turn = engine.createTurnGame(seed, "shared-table-frame-1");
    function apply(result) { assert.ok(result.ok, result.reason); turn = result.state; }
    const card = (kind, profile) => engine.activeTurnHand(turn).find(c =>
      c.kind === kind && (!profile || c.profile === profile)).id;
    if (seed === 97) {
      apply(engine.stageElement(turn, "element-21", "1,3,0", "2,3,0"));
      apply(engine.stageConnection(turn, "connection-26", 3, "a"));
      apply(engine.stageConnection(turn, "connection-20", 3, "b"));
      apply(engine.endTurn(turn));
      apply(engine.stageLoad(turn, "load-3", "2,3,0"));
    } else if (!pending) {
      apply(engine.stageElement(turn, "element-6", "port:1:1", "port:2:1"));
      apply(engine.stageConnection(turn, "connection-13", 3, "a"));
      apply(engine.stageLoad(turn, "load-18", "port:1:1"));
    } else {
      for (const [id, end] of [[3, "1,2,1"], [4, "2,3,1"]]) {
        apply(engine.stageElement(turn, card("element"), "1,3,1", end));
        apply(engine.stageConnection(turn, card("connection", "fixed"), id, "a"));
        if (id === 4) apply(engine.stageLoad(turn, card("load"), "1,3,1"));
        apply(engine.endTurn(turn));
      }
      apply(engine.stageElement(turn, card("element"), "1,3,2", "2,3,2"));
    }
    const page = await browser.newPage({ viewport: { width: pending ? 412 : 1366, height: 900 },
      deviceScaleFactor: 1, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(save => {
      localStorage.setItem("dof.settings", JSON.stringify({ sound: false, reducedMotion: true, showHelpOnStart: false }));
      if (!localStorage.getItem("dof-runtime:session")) localStorage.setItem("dof-runtime:session", JSON.stringify(save));
    }, { version: 1, style: "grow-dusk", mode: "multiplayer",
      turn: { version: 1, catalogue: turn.catalogue, seed, events: turn.events } });
    await page.goto(new URL("/play", server.resolvedUrls.local[0]).href);
    const ready = page.getByRole("button", { name: "Ready · Reveal my hand" });
    const talk = page.getByRole("button", { name: "Talk to Timburr" });
    const note = page.locator(".companion-note");
    const finish = page.getByRole("button", { name: "End turn / pass" });
    const history = () => page.evaluate(async () => {
      const t = (await import("/src/game/store.ts")).useGameStore.getState().turn;
      return JSON.stringify([t.turn, t.events, t.reports, t.board, t.finalScore]);
    });
    await ready.click();
    await page.getByRole("button", { name: "Turn details" }).click();
    await finish.click();
    await ready.waitFor();
    assert.equal(await talk.count(), 0);
    await ready.click();
    if (phase === "before") {
      await talk.click();
      await note.getByText(/tricky joint/i).waitFor();
    } else {
      await note.waitFor();
      const speech = await note.innerText();
      assert.match(speech, /−1 point/);
      assert.match(speech, pending ? /member 5/i : /member 3/i);
      assert.match(speech, pending ? /pending/i : seed === 7 ? /50%/ : /overloaded/i);
      assert.match(speech, pending ? /3 .*rejected/i : /permanent neutral steel prop 4/i);
      if (seed === 97) {
        assert.match(speech, /1\.218/);
        assert.match(speech, /\+40\.564 kN/);
        assert.match(speech, /Player 2 keeps the −1/);
      }
      if (pending) {
        const bubble = await note.boundingBox(), hand = await page.locator(".shared-hand .env-tray").boundingBox();
        assert.ok(bubble.y + bubble.height <= hand.y, "The explanation overlaps the phone hand tray.");
      }
      assert.equal(await page.getByRole("button", { name: "Talk to Conkeldurr" }).count(), 0);
    }
    await page.locator('.figure-stage[data-view="model"]').waitFor();
    await page.screenshot({ path: fileURLToPath(new URL((pending ? "pending-" : seed === 97 ? "overload-" : "") + phase + ".png", import.meta.url)) });
    if (phase === "after") {
      const snapshot = await history();
      await note.getByRole("button", { name: "Dismiss" }).click();
      await page.reload();
      await ready.waitFor();
      assert.equal(await talk.count(), 0);
      await ready.click();
      await talk.waitFor();
      assert.equal(await note.count(), 0);
      await talk.focus();
      await page.keyboard.press("Enter");
      assert.match(await note.innerText(), pending ? /pending/i : seed === 7 ? /50%/ : /overloaded/i);
      assert.equal(await history(), snapshot);
      await page.keyboard.press("Escape");
      assert.equal(await note.count(), 0);
      if (seed === 7) {
        for (let next = 2; next <= 16; next++) {
          await page.getByRole("button", { name: "Turn details" }).click();
          await finish.click();
          if (next < 16) {
            await ready.click();
            await talk.waitFor();
            assert.equal(await note.count(), 0);
          }
        }
        await page.getByRole("heading", { name: "Table complete" }).waitFor();
        await page.reload();
        await page.getByRole("heading", { name: "Table complete" }).waitFor();
        assert.equal(await note.count(), 0);
        await talk.click();
        assert.match(await note.innerText(), /permanent neutral steel prop 4/i);
      }
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ phase, seed, chrome: browser.version(), errors }));
    await page.close();
  }
} finally { await browser.close(); await server.close(); }
