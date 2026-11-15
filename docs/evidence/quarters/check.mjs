// node check.mjs <workspace> <playwright module> <Chrome executable> <before|after>
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer } from "vite";

const [workspace, playwright, executablePath, phase] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(playwright);
const root = path.resolve(workspace, "apps/web");
const out = path.dirname(fileURLToPath(import.meta.url));
const server = await createServer({ root, configFile: path.join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const browser = await chromium.launch({ executablePath, headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem("dof.settings", JSON.stringify({ sound: false, reducedMotion: true, showHelpOnStart: false }));
    localStorage.setItem("dof-runtime:session", JSON.stringify({ version: 1, mode: "multiplayer", style: "grow-dusk",
      turn: { version: 1, seed: 6, events: [
        { kind: "element", cardId: "element-13", a: "1,3,1", b: "3,5,1" },
        { kind: "connection", cardId: "connection-14", memberId: 3, end: "a" }, { kind: "end", turn: 1 },
        { kind: "element", cardId: "element-15", a: "5,3,1", b: "3,5,1" },
        { kind: "connection", cardId: "connection-4", memberId: 4, end: "a" }, { kind: "end", turn: 2 },
      ] } }));
  });
  await page.goto(new URL("/play", server.resolvedUrls.local[0]).href);
  await page.getByRole("button", { name: /reveal/i }).first().click();
  await page.locator("canvas").first().waitFor();
  const card = page.getByRole("button", { name: /IPE.*4/i }).first();
  await card.click();
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await page.mouse.move(0, 0);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: path.join(out, phase + ".png") });
  if (phase === "after") {
    // Observe the production picker's camera to convert known fixture points
    // to CSS pixels. The moves and clicks below use ordinary pointer input.
    await page.evaluate(async () => {
      const url = performance.getEntriesByType("resource").find(r => /\/three\.js(?:\?|$)/.test(r.name))?.name;
      if (!url) throw Error("Three.js module not found");
      const { Vector3 } = await import(url);
      const project = Vector3.prototype.project;
      Vector3.prototype.project = function(camera) {
        Vector3.prototype.project = project;
        window.quarterPixel = coordinates => {
          const p = new Vector3(...coordinates).multiplyScalar(2).project(camera);
          const box = document.querySelector("canvas").getBoundingClientRect();
          return [box.x + (1 + p.x) * box.width / 2, box.y + (1 - p.y) * box.height / 2];
        };
        return project.call(this, camera);
      };
    });
    await page.mouse.move(650, 400);
    for (const [memberId, point] of [[3, [1.5,3.5,1]], [4, [4.5,3.5,1]]]) {
      const [x,y] = await page.evaluate(p => window.quarterPixel(p), point);
      await page.mouse.move(x,y);
      const title = await page.locator("canvas").first().getAttribute("title");
      if (!title?.includes(`Member ${memberId} · 25%`)) throw Error(`Unexpected pick ${title}`);
      await page.mouse.click(x,y);
    }
    const endTargets = await page.evaluate(async () =>
      (await import("/src/game/store.ts")).useGameStore.getState().turn.draft.members[0]?.endTargets);
    if (endTargets?.a !== "port:3:1" || endTargets.b !== "port:4:1") throw Error("Distinct parent IDs missing");
    console.log("Staged by pointer", endTargets);
  }
  if (errors.length) throw Error(errors.join("\n"));
  console.log("Quarter scene", phase, browser.version());
} finally {
  await browser.close();
  await server.close();
}
