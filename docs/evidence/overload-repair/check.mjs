// node check.mjs <workspace> <Playwright module> <Chrome executable> <before|after> [44e9577 workspace]
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const [workspace, playwright, executablePath, phase, legacyWorkspace] = process.argv.slice(2);
assert.ok(["before", "after"].includes(phase));
const root = resolve(workspace, "apps/web");
const server = await createServer({ root, configFile: resolve(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
const { chromium } = createRequire(import.meta.url)(playwright);
const browser = await chromium.launch({ executablePath, headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  await server.listen();
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(() => {
    if (localStorage.getItem("dof-runtime:session")) return;
    const events = [
      { kind: "element", cardId: "element-21", a: "1,3,0", b: "2,3,0" },
      { kind: "connection", cardId: "connection-26", memberId: 3, end: "a" },
      { kind: "connection", cardId: "connection-20", memberId: 3, end: "b" },
      { kind: "end", turn: 1 },
      { kind: "load", cardId: "load-3", jointId: "2,3,0" },
    ];
    localStorage.setItem("dof-runtime:session", JSON.stringify({ version: 1, style: "grow-dusk",
      mode: "multiplayer", turn: { version: 1, catalogue: "shared-table-frame-1", seed: 97, events } }));
  });
  await page.goto(new URL("/play", server.resolvedUrls.local[0]).href);
  const ready = page.getByRole("button", { name: "Ready · Reveal my hand" });
  await ready.click();
  await page.getByRole("button", { name: "End turn", exact: true }).click();
  await page.getByRole("heading", { name: "Pass to Player 1" }).waitFor();
  await page.reload();
  await ready.click();
  const observed = await page.evaluate(async () => {
    const { useGameStore } = await import("/src/game/store.ts");
    const { turn } = useGameStore.getState();
    const report = turn.reports[1], correction = report.correction;
    return { penalty: report.penalty, cause: report.penaltyDecision.event.issueIds, count: turn.board.members.length,
      pre: report.issues.changes.find(c => c.id === "member-overload:3").after.utilization,
      post: correction?.changes.find(c => c.id === "member-overload:3")?.after.utilization,
      supports: correction?.afterFoundations, attempts: correction?.attempts, pending: correction?.pending,
      loadKN: turn.board.loads.reduce((sum,l) => sum + l.magnitude, 0) };
  });
  assert.equal(observed.penalty, -1);
  assert.equal(observed.loadKN, 50);
  assert.deepEqual(observed.cause, ["member-overload:3"]);
  assert.equal(observed.count, phase === "after" ? 4 : 3);
  if (phase === "after") {
    assert.ok(observed.post < .999 && observed.pre > 1.001);
    assert.ok(observed.supports.find(f => f.owner === "neutral").upwardKN > 0);
    assert.deepEqual(observed.pending, []);
  }
  await page.locator("canvas").first().waitFor();
  await page.screenshot({ path: fileURLToPath(new URL(phase + ".png", import.meta.url)) });
  assert.deepEqual(errors, []);
  if (legacyWorkspace) {
    // Generate a REAL v1 instability receipt using the archived commit. Cold
    // replay in this build must reproduce every original object and receipt.
    const oldRoot = resolve(legacyWorkspace, "apps/web");
    const old = await createServer({ root: oldRoot, configFile: resolve(oldRoot, "vite.config.ts"),
      server: { middlewareMode: true, hmr: false, watch: null } });
    try {
      const prior = await old.ssrLoadModule("/src/game/turns.ts");
      const apply = r => { assert.ok(r.ok, r.reason); return r.state; };
      let match = prior.createTurnGame(7, "shared-table-frame-1");
      match = apply(prior.stageElement(match, "element-6", "port:1:1", "port:2:1"));
      match = apply(prior.stageConnection(match, "connection-13", 3, "a"));
      match = apply(prior.stageLoad(match, "load-18", "port:1:1"));
      match = apply(prior.endTurn(match));
      assert.equal(match.reports[0].correction.policy, "local-steel-prop-1");
      const imported = await page.evaluate(async match => {
        const { parseTurnState } = await import("/src/game/turns.ts");
        return parseTurnState(match);
      }, { version: match.version, catalogue: match.catalogue, seed: match.seed, events: match.events });
      assert.deepEqual(JSON.parse(JSON.stringify(imported)), JSON.parse(JSON.stringify(match)));
    } finally { await old.close(); }
  }
  console.log(JSON.stringify({ chrome: browser.version(), phase, seed: 97, observed, exactV1Replay: !!legacyWorkspace, errors }));
} finally { await browser.close(); await server.close(); }
