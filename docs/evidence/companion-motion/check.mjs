// node check.mjs <workspace> <Playwright module> <Chrome executable>
//
// 1. Renders every motion clip on the live 3D Timburr and on the portrait
//    fallback (via the same CSS transform the app applies) into motion-sheet.png.
// 2. Plays a Grow Dusk match through visible controls and asserts the
//    scenario → clip sequence that the companion's figure reports in
//    `data-clip`, including the post-handoff result reactions.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const [workspace, playwright, executablePath] = process.argv.slice(2);
const root = resolve(workspace, "apps/web");
const server = await createServer({ root, configFile: resolve(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
const browser = await createRequire(import.meta.url)(playwright).chromium.launch({ executablePath, headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];

  const sheetPage = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  await sheetPage.goto(new URL("/about", origin).href);
  const sheet = await sheetPage.evaluate(async () => {
    const { createFigure } = await import("/src/companion/figure.ts");
    const { CLIPS, MOTIONS, sampleClip, portraitTransform } = await import("/src/companion/motion.ts");
    const frames = 7, cell = 110;
    const canvas = document.createElement("canvas");
    canvas.width = cell * (frames * 2 + 1); canvas.height = cell * MOTIONS.length;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#24333d"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = "13px sans-serif"; ctx.fillStyle = "#f3ead8";
    const stage = createFigure(cell);
    await stage.show("timburr");
    const img = new Image(); img.src = "/companion/timburr.png"; await img.decode();
    MOTIONS.forEach((name, row) => {
      ctx.fillText(name, 6, row * cell + cell / 2);
      for (let f = 0; f < frames; f++) {
        const pose = sampleClip(CLIPS[name], CLIPS[name].duration * (f + .5) / frames);
        stage.apply(pose);
        ctx.drawImage(stage.canvas, cell * (f + 1), row * cell, cell, cell);
        const css = portraitTransform(pose).replace(/translateY\(([-\d.]+)%\)/, (_, p) => `translateY(${p * cell / 100}px)`);
        const m = new DOMMatrix(css);
        ctx.save(); ctx.translate(cell * (frames + 1 + f) + cell / 2, row * cell + cell * .96);
        ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
        ctx.drawImage(img, -cell / 2, -cell * .96, cell, cell); ctx.restore();
      }
    });
    stage.dispose();
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await writeFile(fileURLToPath(new URL("motion-sheet.png", import.meta.url)), Buffer.from(sheet, "base64"));
  await sheetPage.close();

  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, reducedMotion: "no-preference" });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const clips = [];
  await page.exposeFunction("logClip", c => clips.push(c));
  await page.addInitScript(() => new MutationObserver(() => {
    for (const s of document.querySelectorAll(".figure-stage")) {
      if (s.dataset.clip && s.dataset.clip !== s.lastClip) window.logClip(s.dataset.clip);
      s.lastClip = s.dataset.clip;
    }
  }).observe(document, { attributes: true, subtree: true, childList: true, attributeFilter: ["data-clip"] }));
  await page.goto(new URL("/match", origin).href);
  await page.getByRole("button", { name: /Ready/ }).click();
  await page.waitForTimeout(1500);
  const card = kind => page.locator(`.release-card[data-kind="${kind}"]`).first();
  const stage = async (a, b) => {
    await page.locator(".release-targetbar details").evaluate(d => { d.open = true; });
    const inputs = page.locator(".release-targetbar input");
    await inputs.nth(0).fill(a); await inputs.nth(1).fill(b);
    await page.getByRole("button", { name: "Stage element" }).click();
  };
  const expectations = [];
  const step = async (label, expected, act) => {
    const from = clips.length;
    await act();
    await page.waitForTimeout(1300);
    expectations.push({ label, expected, actual: clips.slice(from) });
  };
  expectations.push({ label: "first sight", expected: ["perk"], actual: clips.slice() });
  await step("select element", ["measure"], () => card("element").click());
  await step("cancel targeting", ["stepBack"], () => page.getByRole("button", { name: "Cancel targeting" }).click());
  await step("select connection", ["point"], () => card("connection").click());
  await step("deselect", ["stepBack"], () => card("connection").click());
  await step("select element", ["measure"], () => card("element").click());
  await step("invalid target", ["puzzled"], () => stage("99,99,9", "98,99,9"));
  await step("stage member", ["measure"], () => stage("1,3,0", "1,3,1"));
  await step("select connection", ["point"], () => card("connection").click());
  await step("attach end", ["nod"], () => page.getByRole("button", { name: "Attach end" }).click());
  await step("cancel draft", ["stepBack"], () => page.getByRole("button", { name: "Cancel draft" }).click());
  await step("stage again", ["measure", "measure"], async () => { await card("element").click(); await stage("1,3,0", "1,3,1"); });
  // Turn 1 is recorded as partial with a deduction: Conkeldurr's entrance supersedes concern.
  await step("end penalized turn", ["foreman"], async () => {
    await page.locator(".release-end").click();
    await page.getByRole("button", { name: /Ready/ }).click({ timeout: 60_000 });
  });
  // Turn 2 passes and is recorded stable: a small cheer at the next reveal.
  await step("pass stable turn", ["cheer"], async () => {
    await page.locator(".release-end").click();
    await page.getByRole("button", { name: /Ready/ }).click({ timeout: 60_000 });
  });
  for (const { label, expected, actual } of expectations) {
    console.log(label.padEnd(20), actual.join(", "));
    assert.deepEqual(actual, expected, label);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await server.close();
}
