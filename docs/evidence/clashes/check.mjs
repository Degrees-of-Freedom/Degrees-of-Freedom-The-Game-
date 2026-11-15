// node check.mjs <workspace> <before|after> <playwright module> <Chrome executable>
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const [workspace, phase, playwright, executablePath] = process.argv.slice(2);
assert.ok(["before", "after"].includes(phase));
const root = resolve(workspace, "apps/web");
const server = await createServer({ root, configFile: resolve(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
const { chromium } = createRequire(import.meta.url)(playwright);
const browser = await chromium.launch({ executablePath, headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  await server.listen();
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(new URL("/play", server.resolvedUrls.local[0]).href);
  const fixture = await page.evaluate(async () => {
    const { createTurnGame, activeTurnHand, stageElement, endTurn } = await import("/src/game/turns.ts");
    const { SCORED_CATALOGUE } = await import("/src/game/cardCatalogue.ts");
    const longCard = s => activeTurnHand(s).find(c => c.kind === "element" && c.maxSteps >= 2);
    let state = createTurnGame(0, SCORED_CATALOGUE);
    let step = stageElement(state, longCard(state).id, "1,1,1", "3,3,1");
    if (!step.ok) throw Error(step.reason);
    do {
      step = endTurn(step.state);
      if (!step.ok) throw Error(step.reason);
      state = step.state;
    } while (!longCard(state) && !state.finished);
    localStorage.setItem("dof.settings", JSON.stringify({ sound: false, reducedMotion: true, showHelpOnStart: false }));
    localStorage.setItem("dof-runtime:session", JSON.stringify({ version: 1, mode: "multiplayer", style: "grow-dusk",
      turn: { version: 1, catalogue: state.catalogue, seed: 0, events: state.events } }));
    return { label: longCard(state).label, turn: state.turn };
  });
  await page.reload();
  await page.getByRole("button", { name: /Ready.*Reveal/ }).click();
  await page.getByRole("button", { name: "Turn details" }).click();
  await page.locator(".turn-panel .turn-card").filter({ hasText: fixture.label }).first().click();
  await page.getByText("Quarter-point placement", { exact: true }).click();
  await page.getByLabel("End A grid x,y,z").fill("1,3,1");
  await page.getByLabel("End B grid x,y,z").fill("3,1,1");
  await page.getByRole("button", { name: "Stage element" }).click();
  const expected = phase === "after" ? /Member 4.*intersect material in member 3/ : /Element staged/;
  assert.match(await page.locator("#toast").innerText(), expected);
  const count = await page.evaluate(async () =>
    (await import("/src/game/store.ts")).useGameStore.getState().turn.draft.members.length);
  assert.equal(count, phase === "after" ? 0 : 1);
  await page.screenshot({ path: fileURLToPath(new URL(phase + ".png", import.meta.url)) });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ phase, seed: 0, ...fixture, staged: count, chrome: browser.version() }));
} finally {
  await browser.close();
  await server.close();
}
