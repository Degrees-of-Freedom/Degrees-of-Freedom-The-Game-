// node resources.cjs <Playwright module> <Chrome executable> <local Vite origin>
// Count GPU allocations made through WebGL2 over repeated specimen changes.
// Counts describe live handles in an unchanged browser context, not GPU bytes.
const { chromium } = require(process.argv[2]);
const [executablePath, origin] = process.argv.slice(3);

async function run() {
  const browser = await chromium.launch({executablePath, headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]});
  try {
    const page = await browser.newPage({ viewport: {width: 1366, height: 900}, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      const prototype = WebGL2RenderingContext.prototype;
      const live = {};
      for (const type of ["Buffer", "Texture", "Framebuffer", "Renderbuffer", "Program", "VertexArray"]) {
        live[type] = 0;
        const allocated = new WeakSet();
        const create = prototype["create" + type], remove = prototype["delete" + type];
        prototype["create" + type] = function(...args) {
          const resource = create.apply(this, args);
          if (resource) { allocated.add(resource); live[type]++; }
          return resource;
        };
        prototype["delete" + type] = function(resource) {
          if (allocated.delete(resource)) live[type]--;
          return remove.call(this, resource);
        };
      }
      window.qaLiveGLHandles = live;
    });
    await page.goto(new URL("/play", origin).href);
    await page.locator("canvas").first().waitFor();
    const client = await page.context().newCDPSession(page);
    const snapshots = [];
    for (let cycle = 0; cycle <= 10; cycle++) {
      for (const id of ["12-midrise", "04-rigid-portal"]) {
        await page.evaluate(async specimen => {
          const { useGameStore } = await import("/src/game/store.ts");
          const response = await fetch("/structures/records/" + specimen + ".json");
          const record = await response.json();
          const state = useGameStore.getState();
          if (state.mode !== "creative") state.setMode("creative");
          const problem = useGameStore.getState().loadLibraryModel(record.save.model);
          if (problem) throw Error(problem);
          if (useGameStore.getState().model.members.length !== record.memberCount) throw Error("Fixture mismatch");
          for (let frame = 0; frame < 3; frame++) await new Promise(requestAnimationFrame);
        }, id);
      }
      if ([0, 5, 10].includes(cycle)) {
        await client.send("HeapProfiler.collectGarbage");
        const dom = await client.send("Memory.getDOMCounters");
        const heap = await client.send("Runtime.getHeapUsage");
        const gl = await page.evaluate(() => ({ ...window.qaLiveGLHandles }));
        snapshots.push({cycle, ...dom, heapBytes: heap.usedSize, gl});
      }
    }
    console.log(JSON.stringify({ chrome: browser.version(), renderer: "SwiftShader", snapshots, errors }));
    if (errors.length) process.exitCode = 1;
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
