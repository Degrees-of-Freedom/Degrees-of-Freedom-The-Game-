// node check.mjs <workspace> <Playwright module> <Chrome executable> <before|after>
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const [workspace, playwright, executablePath, phase] = process.argv.slice(2);
assert.ok(["before", "after"].includes(phase));
const out = dirname(fileURLToPath(import.meta.url));
const root = resolve(workspace, "apps/web");
const server = await createServer({ root, configFile: resolve(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
const { chromium } = createRequire(import.meta.url)(playwright);
const browser = await chromium.launch({ executablePath, headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  await server.listen();
  for (const [device, width, height] of [["desktop", 1366, 900], ["touch", 430, 890]]) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: device === "touch" });
    page.setDefaultTimeout(45000);
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(() => {
      if (!localStorage.getItem("dof.settings")) localStorage.setItem("dof.settings", JSON.stringify({ sound: false, reducedMotion: true, showHelpOnStart: false }));
      if (!localStorage.getItem("dof-runtime:session")) localStorage.setItem("dof-runtime:session",
        JSON.stringify({ version: 1, mode: "multiplayer", style: "grow-dusk", turn: { version: 1, seed: 6, events: [] } }));
    });
    await page.goto(new URL("/play", server.resolvedUrls.local[0]).href);
    await page.getByRole("button", { name: /reveal/i }).first().click();
    await page.locator("canvas").first().waitFor();
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await page.getByRole("button", { name: "Build options" }).click();
    const openBuild = () => page.getByRole("button", { name: "Build options" }).click();
    const closeBuild = () => page.getByRole("button", { name: "Close drawer" }).click();
    const original = await page.evaluate(() => localStorage.getItem("dof-runtime:session"));
    if (phase === "after") {
      const mode = page.getByLabel("Joint display");
      const joint = page.getByLabel("Inspect joint");
      assert.equal(await mode.inputValue(), "selected");
      await joint.focus();
      await joint.press("ArrowDown");
      assert.equal(await joint.inputValue(), "1,3,0");
      assert.equal(await page.getByRole("table", { name: "Ground restraints" }).getByText("Locked").count(), 6);
      assert.equal(await page.getByRole("table", { name: "Connection permissions" }).getByText("Locked").count(), 6);
      await mode.selectOption("all");
      await page.screenshot({ path: resolve(out, device + "-inspector.png") });
    }
    await closeBuild();
    await page.mouse.move(0, 0);
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    await page.screenshot({ path: resolve(out, phase + "-" + device + ".png") });
    if (phase === "after") {
      await openBuild();
      const mode = page.getByLabel("Joint display");
      await mode.selectOption("off");
      assert.equal(await page.evaluate(() => localStorage.getItem("dof-runtime:session")), original);
      await page.reload();
      assert.equal(await page.getByLabel("Joint display").count(), 0);
      assert.equal(await page.locator("canvas").count(), 0);
      await page.getByRole("button", { name: /reveal/i }).first().click();
      await openBuild();
      assert.equal(await mode.inputValue(), "off");
    }
    assert.deepEqual(errors, []);
    await page.close();
    console.log(phase, device, browser.version());
  }
  if (phase === "after") {
    const engine = await server.ssrLoadModule("/src/game/turns.ts");
    const { JOINT_CATALOGUE } = await server.ssrLoadModule("/src/game/cardCatalogue.ts");
    for (const profile of ["ball", "hinge-diagonal", "seat-20"]) {
      // Replay ordinary legal events. The incoming connector at the original
      // quarter is the only inspected attachment, even after a neutral repair.
      let fixture;
      for (let seed = 1; seed <= 100 && !fixture; seed++) {
        const turn = engine.createTurnGame(seed, JOINT_CATALOGUE);
        const hand = engine.activeTurnHand(turn);
        const end = hand.find(c => c.kind === "connection" && c.profile === profile);
        const member = hand.find(c => c.kind === "element" && c.maxSteps >= 4);
        if (!end || !member) continue;
        const placed = engine.stageElement(turn, member.id, "port:1:1", "port:2:1");
        if (!placed.ok) continue;
        const joined = engine.stageConnection(placed.state, end.id, 3, "a");
        if (!joined.ok) continue;
        const committed = engine.endTurn(joined.state);
        if (committed.ok) fixture = { version: 1, seed, catalogue: JOINT_CATALOGUE, events: committed.state.events };
      }
      assert.ok(fixture, "Committed " + profile + " original-port fixture");
      const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, reducedMotion: "reduce" });
      await page.addInitScript(turn => localStorage.setItem("dof-runtime:session", JSON.stringify({
        version: 1, style: "grow-dusk", mode: "multiplayer", turn })), fixture);
      await page.goto(new URL("/play", server.resolvedUrls.local[0]).href);
      await page.getByRole("button", { name: /reveal/i }).first().click();
      await page.getByRole("button", { name: "Build options" }).click();
      await page.getByLabel("Inspect joint").selectOption("port:1:1");
      await page.getByText(/original 25% port/).waitFor();
      const table = page.getByRole("table", { name: "Connection permissions" });
      assert.equal(await page.getByRole("table", { name: "Ground restraints" }).count(), 0);
      if (profile === "ball") assert.equal(await table.getByText("Free", { exact: true }).count(), 3);
      if (profile === "seat-20") assert.equal(await table.getByText("Elastic", { exact: true }).count(), 1);
      if (profile === "hinge-diagonal") {
        assert.equal(await table.getByText("Coupled", { exact: true }).count(), 2);
        await page.getByLabel("Reference axes").selectOption("local");
        assert.equal(await table.getByText("Free", { exact: true }).count(), 1);
        await page.getByText(/0\.707, 0\.707, 0/).waitFor();
        await page.getByRole("button", { name: "Close drawer" }).click();
        await page.getByRole("button", { name: "Rotate left" }).click();
        await page.getByRole("button", { name: "Build options" }).click();
        await page.getByLabel("Reference axes").selectOption("local");
        assert.equal(await table.getByText("Free", { exact: true }).count(), 1);
      }
      await page.screenshot({ path: resolve(out, profile + "-port.png") });
      await page.close();
      console.log("Committed quarter", profile, "seed", fixture.seed);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
