// node stress-preview.cjs <playwright module> <Chrome executable> <local Vite origin>
// Exercise the ordinary Creative analysis entry point on one large connected frame.
const { cpus } = require("node:os");
const [modulePath, executablePath, origin] = process.argv.slice(2);
const { chromium } = require(modulePath);

function stressFrame() {
  const model = { members: [], attrs: {}, nextId: 1 };
  const add = (a, b) => model.members.push({ id: model.nextId++, a, b, type: "heb" });
  // Eight storeys of 42 columns. Four horizontal spanning trees connect all
  // column stacks into a single region with 2,016 unconstrained equations.
  for (let z = 0; z <= 8; z++) {
    for (let x = 0; x < 7; x++) {
      for (let y = 0; y < 6; y++) {
        const joint = [x,y,z].join(",");
        model.attrs[joint] = { joint: true, ...(z === 0 && { found: true }) };
        if (z > 0) add([x,y,z - 1].join(","), joint);
        if (z === 0 || z % 2) continue;
        if (y > 0) add([x,y - 1,z].join(","), joint);
        else if (x > 0) add([x - 1,y,z].join(","), joint);
      }
    }
  }
  model.attrs["6,5,8"].load = 5;
  return model;
}

async function measure() {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    await page.goto(new URL("/play", origin).href);
    const row = await page.evaluate(async model => {
      const { analyzeGame } = await import("/src/game/analysis.ts");
      const level = { type: "sandbox", q0: 0, loadCase: "applied", budget: Infinity, inv: null };
      const ms = [];
      let verification;
      for (let i = 0; i < 25; i++) {
        const start = performance.now();
        const result = analyzeGame(model, level);
        const elapsed = performance.now() - start;
        const scopes = result.combos?.[0]?.components;
        if (result.ctx?.nf !== 2016 || model.members.length !== 500 || scopes?.length !== 1
          || scopes[0].verification?.status !== "verified-linear") {
          throw new Error(JSON.stringify({ error: result.error, equations: result.ctx?.nf, scope: scopes?.[0]?.verification }));
        }
        verification = scopes[0].verification;
        if (i >= 5) ms.push(elapsed);
      }
      ms.sort((a,b) => a - b);
      return { members: model.members.length, joints: Object.keys(model.attrs).length, freeEquations: 2016,
        medianMs: ms[9], p95Ms: ms[18], maxMs: ms[19], verification };
    }, stressFrame());
    console.log(JSON.stringify({ cpu: cpus()[0].model, browser: browser.version(), warmups: 5, samples: 20, ...row }));
  } finally {
    await browser.close();
  }
}

measure().catch(error => { console.error(error); process.exitCode = 1; });
