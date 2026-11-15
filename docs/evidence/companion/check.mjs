// node check.mjs <workspace> <Playwright module> <Chrome executable> <before|after|portraits>
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const [workspace, playwright, executablePath, phase] = process.argv.slice(2);
assert.ok(["before", "after", "portraits"].includes(phase));
const root = resolve(workspace, "apps/web");
const server = await createServer({ root, configFile: resolve(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
const browser = await createRequire(import.meta.url)(playwright).chromium.launch({ executablePath, headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const directory = resolve(root, "public/companion");
  if (phase === "portraits") {
    const page = await browser.newPage();
    await page.goto(new URL("/about", origin).href);
    const sources = JSON.parse(await readFile(resolve(directory, "sources.json"), "utf8"));
    for (const source of sources.models) {
      const bytes = await readFile(resolve(directory, source.file));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256);
      const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
      assert.equal(gltf.animations?.length ?? 0, 0);
      const name = source.file.split(".")[0];
      const png = await page.evaluate(async name => {
        const { createFigure } = await import("/src/companion/figure.ts");
        const stage = createFigure(256);
        await stage.show(name);
        stage.draw();
        const snapshot = stage.canvas.toDataURL("image/png");
        stage.dispose();
        return snapshot.split(",")[1];
      }, name);
      await writeFile(resolve(directory, name + ".png"), Buffer.from(png, "base64"));
      console.log({ name, meshes: gltf.meshes.length, clips: gltf.animations?.length ?? 0, sha256: source.sha256 });
    }
  } else {
    for (const [label, viewport] of [["desktop", { width: 1366, height: 900 }], ["phone", { width: 412, height: 915 }]]) {
      const page = await browser.newPage({ viewport, hasTouch: label === "phone", reducedMotion: "reduce" });
      const errors = [];
      page.on("pageerror", e => errors.push(e.message));
      if (phase === "after") await page.addInitScript(() => {
        window.figureDraws = 0;
        for (const name of ["drawElements", "drawArrays"]) {
          const original = WebGL2RenderingContext.prototype[name];
          WebGL2RenderingContext.prototype[name] = function (...args) {
            if (this.canvas.closest?.(".figure-stage")) window.figureDraws++;
            return original.apply(this, args);
          };
        }
      });
      const shot = name => page.screenshot({ path: fileURLToPath(new URL(name + ".png", import.meta.url)) });
      for (const [path, view] of [["/", "menu"], ["/play", "board"]]) {
        await page.goto(new URL(path, origin).href);
        if (view === "board") await page.locator("#stage canvas").first().waitFor();
        else await page.getByRole("link", { name: "Play", exact: true }).waitFor();
        if (phase === "after") await page.locator(".figure-stage[data-view='model']").waitFor();
        await shot([phase, label, view].join("-"));
        if (phase === "after") {
          const buddy = page.getByRole("button", { name: "Talk to Timburr" });
          const before = await page.evaluate(() => window.figureDraws);
          assert.ok(before > 0);
          await page.waitForTimeout(250);
          assert.equal(await page.evaluate(() => window.figureDraws), before);
          // Check rendered hit-testing, including against the existing board UI.
          assert.ok(await buddy.evaluate(el => {
            const r = el.getBoundingClientRect();
            return el.contains(document.elementFromPoint(r.x + r.width/2, r.y + r.height/2));
          }));
          if (view === "menu" && label === "desktop") {
            await buddy.focus();
            await page.keyboard.press("Enter");
            await page.getByRole("button", { name: "Preview Conkeldurr" }).click();
            await page.locator(".figure-stage[data-view='model']").waitFor();
            const preview = page.getByRole("button", { name: "Talk to Conkeldurr" });
            await preview.waitFor();
            await shot("foreman-preview");
            await page.locator(".figure-stage canvas").evaluate(canvas =>
              canvas.getContext("webgl2").getExtension("WEBGL_lose_context").loseContext());
            await page.getByRole("button", { name: "Retry 3D model" }).waitFor();
            assert.match(await page.locator(".figure-stage img").getAttribute("src"), /conkeldurr\.png$/);
            assert.ok(await page.locator(".figure-stage img").evaluate(img => img.complete && img.naturalWidth > 0));
            await shot("fallback");
            await page.getByRole("button", { name: "Retry 3D model" }).click();
            await page.locator(".figure-stage[data-view='model']").waitFor();
            await page.getByRole("button", { name: "Dismiss" }).click();
            await buddy.waitFor();
          }
        }
      }
      if (phase === "after") {
        // All logical menu destinations retain a usable control and a genuinely
        // loaded model. A new private game mounts the neutral cover alone.
        for (const path of ["/modes", "/setup/multiplayer", "/how", "/about", "/settings", "/missing"]) {
          await page.goto(new URL(path, origin).href);
          await page.getByRole("button", { name: "Talk to Timburr" }).waitFor();
          await page.locator(".figure-stage[data-view='model']").waitFor();
        }
        await page.goto(new URL("/setup/multiplayer", origin).href);
        await page.getByRole("button", { name: "Start", exact: true }).click();
        await page.getByRole("button", { name: /Ready.*Reveal/ }).waitFor();
        assert.equal(await page.locator(".companion, canvas").count(), 0);
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(JSON.stringify({ phase, chrome: browser.version() }));
  }
} finally { await browser.close(); await server.close(); }
