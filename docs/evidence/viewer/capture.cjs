// Run against a local Vite dev server so dormant environment presenters and the
// existing portal fixture can be selected through the current game store.
// node capture.cjs <playwright module> <Chrome executable> <origin> <output directory>
const path = require("node:path");
const fs = require("node:fs/promises");
const [modulePath, executablePath, origin, outputDir] = process.argv.slice(2);
const { chromium } = require(modulePath);

async function capture() {
  await fs.mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1366, height: 900 },
      deviceScaleFactor: 1,
    });
    page.on("pageerror", (error) => console.error(error.message));
    await page.goto(new URL("/play", origin).href);
    await page.locator("canvas").first().waitFor({ timeout: 45000 });
    for (const style of ["grow-dusk", "grow", "levels", "blocks", "kit"]) {
      const description = await page.evaluate(async (style) => {
        const { useGameStore } = await import("/src/game/store.ts");
        const { createGameSave } = await import("/src/game/structuralState.ts");
        const { environmentExample } = await import("/src/game/environmentExamples.ts");
        const state = () => useGameStore.getState();
        state().setMode("creative");
        state().setStyle(style);
        const error = state().importModel(createGameSave(state().levelId, environmentExample("portal")));
        if (error) throw Error(error);
        state().setWorkK(3);
        return { style: state().style, members: state().model.members.length };
      }, style);
      await page.getByRole("button", { name: "Fit", exact: true }).click();
      await page.mouse.move(0, 0);
      await page.evaluate(() => new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if (await page.locator(".scene-fallback").count()) throw Error("3D unavailable");
      console.log(browser.version(), description, await page.locator(".brand-sub").first().textContent());
      await page.screenshot({ path: path.join(outputDir, style + ".png") });
    }
  } finally {
    await browser.close();
  }
}
capture().catch(error => { console.error(error); process.exitCode = 1; });
