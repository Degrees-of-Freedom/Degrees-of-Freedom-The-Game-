// node check.mjs <checkout> <before|after> <Playwright module> <Chrome executable>
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer } from "vite";

const [repo, phase, playwright, executablePath] = process.argv.slice(2);
assert.ok(["before", "after"].includes(phase));
const root = path.resolve(repo, "apps/web");
const output = path.dirname(fileURLToPath(import.meta.url));
const server = await createServer({ root, configFile: path.join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
const { chromium } = createRequire(import.meta.url)(playwright);
await server.listen();
const browser = await chromium.launch({ executablePath, headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(new URL("/play", server.resolvedUrls.local[0]).href);
  await page.locator("canvas").first().waitFor();
  for (const style of ["grow-dusk", "grow", "levels", "blocks", "kit"]) {
    await page.evaluate(async style => {
      const { useGameStore } = await import("/src/game/store.ts");
      const { createGameSave } = await import("/src/game/structuralState.ts");
      const { environmentExample } = await import("/src/game/environmentExamples.ts");
      const game = () => useGameStore.getState();
      game().setMode("creative");
      game().setStyle(style);
      const portal = environmentExample("portal");
      // The established reference fixture, with the columns HEB and roof IPE.
      for (const m of portal.members) m.type = m.id < 3 ? "heb" : "ipe";
      const issue = game().importModel(createGameSave(game().levelId, portal));
      if (issue) throw Error(issue);
      game().setWorkK(3);
    }, style);
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await page.mouse.move(0, 0);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator(".scene-fallback").count(), 0);
    await page.screenshot({ path: path.join(output, phase + "-" + style + ".png") });
  }
  assert.deepEqual(errors, []);
  console.log(phase, browser.version(), "5 wide-flange presenters");
} finally {
  await browser.close();
  await server.close();
}
