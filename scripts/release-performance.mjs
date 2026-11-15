// Measure the built game on this computer. Hardware identity, active renderer,
// viewport and actual timing samples travel with the result.
import {chromium} from "@playwright/test";
import {preview} from "vite";
import {mkdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import os from "node:os";
import assert from "node:assert/strict";

const root=resolve("apps/web");
const server=await preview({root,preview:{host:"127.0.0.1",port:0}});
const base=server.resolvedUrls.local[0];
let browser;
try {
  const build=await (await fetch(new URL("release-build.json",base))).json();
  browser=await chromium.launch({headless:true,channel:process.env.DOF_BROWSER_CHANNEL || undefined,
    executablePath:process.env.DOF_BROWSER_EXECUTABLE || undefined});
  const page=await browser.newPage({viewport:{width:1366,height:900},deviceScaleFactor:1});
  const devtools=await page.context().newCDPSession(page);
  const browserTools=await browser.newBrowserCDPSession();
  const system=await browserTools.send("SystemInfo.getInfo");
  const button=name=>page.getByRole("button",{name,exact:true});
  const ready=button("Ready · Reveal my hand");
  await page.goto(base+"match?seed=6");await ready.click();
  const hand=page.getByRole("region",{name:"Active hand"});
  const card=(kind,re)=>hand.locator('[data-kind="'+kind+'"]').filter({hasText:re}).first();
  await card("element",/HEB/).click();
  await page.getByText("Precise placement",{exact:true}).click();
  await page.getByLabel("End A grid x,y,z").fill("5,7,1");
  await page.getByLabel("End B grid x,y,z").fill("5,8,2");
  await button("Stage element").click();
  await card("connection",/Fixed/).click();
  await page.getByLabel("Connection target").selectOption(JSON.stringify([3,"a","5,7,1"]));
  await button("Attach end").click();
  await card("load",/kN/).click();
  await page.getByLabel("Load target").selectOption("port:3:2");await button("Place load").click();
  await button("End turn").click();await ready.click();
  const measure=async (count,onSample) => {
    const samples=page.evaluate(n => new Promise(resolveSamples => {
      const frames=[]; let before;
      function sample(now) {
        if (before !== undefined) frames.push(now-before);
        before=now;
        if(frames.length<n) requestAnimationFrame(sample);
        else resolveSamples(frames);
      }
      requestAnimationFrame(sample);
    }),count);
    if(onSample) await onSample();
    return samples;
  };
  await measure(60);
  const memory=async () => {
    await devtools.send("HeapProfiler.collectGarbage");
    const counts=await devtools.send("Memory.getDOMCounters");
    const heap=await devtools.send("Runtime.getHeapUsage");
    return {...counts,heapBytes:heap.usedSize,liveWorkers:page.workers().length};
  };
  const baseline=await memory();
  const frameMs=await measure(360,async()=>{
    for(let n=0;n<12;n++) {
      await page.mouse.move(550,330);await page.mouse.down({button:"right"});
      await page.mouse.move(550+(n%2?90:-90),340,{steps:12});
      await page.mouse.up({button:"right"});
      await button("Inspect").click();await button("Close inspection").click();
    }
  });
  const feedback=await page.evaluate(()=> {
    window.__dofFeedback=[];
    const handler=event=>{
      if(!event.target.closest("[data-card-id]")) return;
      const start=event.timeStamp;
      requestAnimationFrame(()=>window.__dofFeedback.push(performance.now()-start));
    };
    document.addEventListener("click",handler);
    return true;
  });
  assert.ok(feedback);
  for(let i=0;i<12;i++) {await hand.locator("[data-card-id]").first().click();await button("Cancel targeting").click();}
  const acknowledgementMs=await page.evaluate(()=>window.__dofFeedback);
  const after=await memory();
  const sorted=xs=>[...xs].sort((a,b)=>a-b);
  const p95=xs=>sorted(xs)[Math.ceil(xs.length*.95)-1];
  const gpu=system.gpu;
  const result={...build,platform:os.platform()+" "+os.release(),cpu:os.cpus()[0].model,
    ramGiB:os.totalmem()/2**30,browser:browser.version(),width:1366,height:900,dpr:1,
    renderer:gpu.auxAttributes?.glRenderer,devices:gpu.devices.map(d=>({vendor:d.vendorString,device:d.deviceString})),
    scenario:"Default decoration, committed HEB with quarter gravity; orbit camera and toggle inspection; select/cancel cards.",
    warmupFrames:60,measuredFrames:frameMs.length,meanFps:1000*frameMs.length/frameMs.reduce((a,b)=>a+b,0),
    p95FrameMs:p95(frameMs),p95InputToNextFrameMs:p95(acknowledgementMs),acknowledgementMs,before:baseline,after,frameMs};
  const out=resolve(process.env.DOF_EVIDENCE_DIR || ".venv/release-evidence");
  await mkdir(out,{recursive:true});
  await writeFile(resolve(out,"performance.json"),JSON.stringify(result,null,2));
  console.log(JSON.stringify({...result,frameMs:undefined,acknowledgementMs:undefined}));
}finally{
  await browser?.close();
  await new Promise(resolveClose=>server.httpServer.close(resolveClose));
}
