import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/** These checks inject failures at the storage/worker boundary. Positive gameplay
 * always enters through the same controls a player uses. No synthetic match is dealt. */
export async function testOperationalCases(browser, base, saved) {
  const context = await browser.newContext({ viewport:{width:1366,height:900}, reducedMotion:"reduce" });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const button = name => page.getByRole("button",{name,exact:true});
  const ready = button("Ready · Reveal my hand");
  const checks=[];
  const drawFour = async () => {
    const rack = page.locator('[aria-label="Draw four cards"]');
    while (await rack.count()) {
      const label = await rack.locator('header span').textContent();
      const count = Number(label.match(/^(\d)/)?.[1]);
      await rack.locator('button:not(:disabled)').first().click();
      if (count < 3) await page.getByText(`${count + 1} of 4 drawn · any mix of decks`, {exact:true}).waitFor();
      else await rack.waitFor({state:"detached"});
    }
  };
  const openFiles = async () => { await button("Menu").click(); await button("Save files").click(); };
  const download = async action => {
    const [file] = await Promise.all([page.waitForEvent("download"), action()]);
    return readFile(await file.path());
  };
  const chooseFile = async bytes => {
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"),button("Import private match").click()]);
    await chooser.setFiles({name:"private.json",mimeType:"application/json",buffer:bytes});
    await button("Validate and replace").click();
  };
  try {
    await page.goto(base+"match?seed=0"); await ready.click(); await drawFour();
    await openFiles();
    const original = await download(()=>button("Export private match").click());
    const publicBytes = await download(()=>button("Export public summary").click());
    const exposed = JSON.parse(publicBytes);
    assert.deepEqual(Object.keys(exposed).sort(),["activePlayerId","board","finished","reports","turn","version"]);
    assert.doesNotMatch(publicBytes.toString(),/"(hand|hands|decks|seed|draft|cardId|definitionId|matchId)"/);
    for(const rejected of [Buffer.from("{"), Buffer.from(JSON.stringify({...JSON.parse(original),version:999})),
      Buffer.from(JSON.stringify({...JSON.parse(original),turn:{...JSON.parse(original).turn,players:[]}})),
      Buffer.alloc(8*1024*1024+1,32)]) {
      await chooseFile(rejected);
      await page.getByRole("alert").waitFor();
      assert.ok((await download(()=>button("Download original file").click())).equals(rejected));
      assert.equal((await saved(page)).commitId,JSON.parse(original).commitId);
      await button("Cancel import").click();
    }
    checks.push("redacted summary, valid private export, corrupt/future/oversize/altered import and exact byte preservation");
    await chooseFile(original);
    await ready.click();
    const prior = await saved(page);
    await button("Menu").click(); await button("Restart").click(); await button("Cancel").click();
    assert.equal((await saved(page)).commitId,prior.commitId);
    await button("Restart").click();
    // Throw from the same IndexedDB boundary used by disabled/quota-limited browsers.
    const failNextWrite = () => page.evaluate(() => {
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function(...args) {
        if (this.name==="dof-grow-dusk" && args[1]==="readwrite") {
          IDBDatabase.prototype.transaction = transaction;
          throw new DOMException("Storage quota exceeded", "QuotaExceededError");
        }
        return transaction.apply(this,args);
      };
    });
    await failNextWrite();
    await button("Restart").click();
    await page.getByRole("heading",{name:"Save interrupted"}).waitFor();
    assert.equal((await saved(page)).commitId,prior.commitId);
    const pending = JSON.parse(await download(()=>button("Download unsaved private match").click()));
    assert.notEqual(pending.matchId,prior.matchId);
    await button("Retry save").click(); await ready.waitFor();
    assert.equal((await saved(page)).commitId,pending.commitId);
    checks.push("restart cancellation and quota failure preserve prior match; retry installs exactly exported replacement");

    const other = await context.newPage();
    await other.goto(base+"match");
    const otherReady = other.getByRole("button",{name:"Ready · Reveal my hand"});
    await otherReady.waitFor();
    await page.bringToFront(); await ready.click(); await drawFour();
    await page.getByLabel("Calculate every").selectOption("1");
    await button("Pass").dblclick();
    await ready.waitFor();
    await other.getByRole("heading",{name:"Saved session changed"}).waitFor();
    assert.equal((await saved(page)).turn.reports.length,1);
    await other.close();
    checks.push("rapid End input and stale tab render one accepted event");

    // Reload while End has a durable intent but the solver binary cannot yet arrive.
    let releaseRequest;
    const hold = new Promise(resolve=>{ releaseRequest=resolve; });
    await context.route(/dof_solver-.*\.wasm/,async route => { await hold; await route.continue().catch(()=>{}); });
    await ready.click(); await drawFour(); await button("Pass").click();
    await page.waitForFunction(async () => {
      const req = indexedDB.open("dof-grow-dusk");
      const db = await new Promise(resolve => {req.onsuccess=()=>resolve(req.result);});
      const read = db.transaction("match").objectStore("match").get("head");
      const raw = await new Promise(resolve=>{read.onsuccess=()=>resolve(read.result);}); db.close();
      return JSON.parse(raw).phase==="assessing";
    });
    const intent=await saved(page);
    const reload=page.reload({waitUntil:"domcontentloaded"});
    await reload;
    releaseRequest();
    await context.unroute(/dof_solver-.*\.wasm/);
    await ready.waitFor();
    const committed=await saved(page);
    assert.equal(committed.turn.turn,3);
    assert.equal(committed.turn.reports.length,2);
    assert.equal(committed.parentId,intent.commitId);
    checks.push("worker interrupted after durable End intent resumes once behind handoff");
    await context.route(/dof_solver-.*\.wasm/,route=>route.abort("failed"));
    await page.reload();
    await page.getByRole("heading",{name:"Couldn’t open the match"}).waitFor();
    assert.equal(await button("Restore previous save").count(),0);
    assert.equal(JSON.parse(await download(()=>button("Download original private save").click())).commitId,committed.commitId);
    await context.unroute(/dof_solver-.*\.wasm/);
    await button("Retry").click(); await ready.waitFor();
    assert.equal((await saved(page)).commitId,committed.commitId);
    checks.push("missing WASM on reload permits retry and exact private export without replacing a valid save");
    // Deliberately damage only the head; the prior validated record remains.
    await page.evaluate(async () => {
      const r=indexedDB.open("dof-grow-dusk");
      const db=await new Promise(resolve=>{r.onsuccess=()=>resolve(r.result);});
      const tx=db.transaction("match","readwrite");tx.objectStore("match").put("{bad","head");
      await new Promise(resolve=>{tx.oncomplete=resolve;});db.close();
    });
    await page.reload();
    await page.getByRole("heading",{name:"Recover saved session"}).waitFor();
    const source=await download(()=>button("Download original private save").click());
    assert.equal(source.toString(),"{bad");
    await button("Restore previous save").click();
    await failNextWrite();
    await page.getByRole("button",{name:/I saved a copy/}).click();
    await button("Retry recovery save").waitFor();
    assert.equal((await download(()=>button("Download original private save").click())).toString(),"{bad");
    const recovering=JSON.parse(await download(()=>button("Download pending private match").click()));
    assert.equal(recovering.phase,"assessing");
    await button("Retry recovery save").click();
    await ready.waitFor();
    const restored=await saved(page);
    assert.deepEqual(restored.turn,committed.turn);
    checks.push("failed recovery preserves both damaged source and pending replacement, then restores identical state");
    return checks;
  } finally { await context.close(); }
}
