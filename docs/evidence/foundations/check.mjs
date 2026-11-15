// node check.mjs <workspace> <Playwright module> <Chrome executable> <before|after> [auto|swiftshader] [output.png]
// Walk the actual Creative setup, select the foundation tool, and click a
// visible soil point. The fixture observes the model only to verify results.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createServer } from "vite";

const [workspace, playwright, executablePath, phase, graphics = "swiftshader", output] = process.argv.slice(2);
assert.ok(["before", "after"].includes(phase));
const root = resolve(workspace, "apps/web");
const server = await createServer({ root, configFile: resolve(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
const { chromium } = createRequire(import.meta.url)(playwright);
const browser = await chromium.launch({ executablePath, headless: true,
  args: graphics === "auto" ? [] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  await server.listen();
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("dof.settings", JSON.stringify({
    sound: false, reducedMotion: true, showHelpOnStart: false,
  })));
  await page.goto(new URL("/setup/creative", server.resolvedUrls.local[0]).href);
  await page.getByRole("button", { name: "Start with example", exact: true }).click();
  const canvas = page.locator("canvas").first();
  await canvas.waitFor();
  if (phase === "before") {
    await page.getByRole("button", { name: "Build options" }).click();
    await page.getByRole("button", { name: "Place foundation", exact: true }).click();
    await page.getByRole("button", { name: "Close drawer" }).click();
  } else {
    await page.getByRole("navigation", { name: "Building tools" }).getByRole("button", { name: /Foundation/ }).click();
  }
  const state = () => page.evaluate(async () => {
    const game = (await import("/src/game/store.ts")).useGameStore.getState();
    return { tool: game.tool, selected: game.selected, attrs: game.model.attrs, level: game.levelId };
  });
  assert.equal((await state()).tool, "found");
  const [x, y] = [665, 536];
  await page.mouse.move(x, y);
  const hover = await canvas.getAttribute("title");
  assert.match(hover, /^\d+, \d+, 0 m$/);
  const key = hover.replace(" m", "").split(", ").map(n => Number(n) / 2).join(",");
  assert.equal(key, "4,4,0");
  assert.ok(!(await state()).attrs[key]?.found);
  await page.mouse.click(x, y);
  const observed = await state();
  assert.equal(observed.selected?.key, key);
  assert.equal(Boolean(observed.attrs[key]?.found), phase === "after");
  await page.screenshot({ path: output ?? fileURLToPath(new URL(phase + ".png", import.meta.url)) });
  if (phase === "after") {
    await page.getByText("6 of 6 locked", { exact: true }).waitFor();
    await page.mouse.click(x, y);
    assert.equal((await state()).attrs[key].found, true);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    assert.ok(!(await state()).attrs[key]?.found);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await page.reload();
    await canvas.waitFor();
    assert.equal((await state()).attrs[key].found, true);
    await page.getByRole("navigation", { name: "Building tools" }).getByRole("button", { name: /Foundation/ }).click();
    const beforeInvalid = (await state()).attrs;
    await page.mouse.click(55, 190);
    await page.getByText("Choose a solid ground point on the board.", { exact: true }).waitFor();
    assert.deepEqual((await state()).attrs, beforeInvalid);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ phase, browser: browser.version(), key, level: observed.level,
    foundation: Boolean(observed.attrs[key]?.found), consoleErrors: errors }));
} finally { await browser.close(); await server.close(); }
