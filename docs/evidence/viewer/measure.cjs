// node measure.cjs <playwright module> <Chrome executable> <local Vite origin> [auto]
// Measure presentation separately from the in-process applied-load analysis.
const { cpus } = require("node:os");
const [modulePath, executablePath, origin, graphics = "swiftshader"] = process.argv.slice(2);
const { chromium } = require(modulePath);

async function measure() {
  const browser = await chromium.launch({
    executablePath, headless: true,
    args: graphics === "auto" ? [] : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(new URL("/play", origin).href);
    await page.locator("canvas").first().waitFor();
    const renderer = await page.evaluate(() => {
      for (const canvas of document.querySelectorAll("canvas")) {
        const gl = canvas.getContext("webgl2");
        const ext = gl?.getExtension("WEBGL_debug_renderer_info");
        if (ext) return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
      }
      return "Browser did not expose a WebGL2 renderer name";
    });
    const fixtures = ["04-rigid-portal", "12-midrise"];
    const measurements = [];
    for (const fixture of fixtures) {
      const row = await page.evaluate(async id => {
        const { useGameStore } = await import("/src/game/store.ts");
        const { analyzeGame } = await import("/src/game/analysis.ts");
        const record = await (await fetch("/structures/records/" + id + ".json")).json();
        const state = () => useGameStore.getState();
        state().setMode("creative");
        state().loadLibraryModel(record.save.model);
        if (state().model.members.length !== record.memberCount) throw Error("Fixture load failed");
        const intervals = [];
        const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
        let previous = await frame();
        for (let i = 0; i < 150; ++i) {
          const now = await frame();
          if (i >= 30) intervals.push(now - previous);
          previous = now;
        }
        const times = [];
        let preview;
        for (let i = 0; i < 25; ++i) {
          const start = performance.now();
          const result = analyzeGame(state().model, { type: "sandbox", q0: 0, loadCase: "applied", budget: Infinity, inv: null });
          if (result.error || !result.combos.length) throw Error(result.error ?? "No analysis");
          if (i >= 5) times.push(performance.now() - start);
          preview = result;
        }
        const p95 = values => values.sort((a, b) => a - b)[Math.ceil(0.95 * values.length) - 1];
        return { fixture: id, members: record.memberCount, frameP95ms: p95(intervals), solverP95ms: p95(times),
          freeDofs: preview.ctx.nf, verification: preview.combos[0].components.map(scope => scope.verification) };
      }, fixture);
      measurements.push(row);
    }
    console.log(JSON.stringify({
      cpu: cpus()[0].model, chrome: browser.version(), graphics, renderer, width: 1366, height: 900,
      frameWarmup: 30, measuredFrames: 120, solverWarmup: 5, measuredSolves: 20,
      measurements, pageErrors: errors,
    }));
    if (errors.length) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

measure().catch(error => { console.error(error); process.exitCode = 1; });
