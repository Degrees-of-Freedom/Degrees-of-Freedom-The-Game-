// node check.mjs <workspace> <Playwright module> <Chrome executable> <output directory> [standard|partial] [mouse|keyboard|touch]
// A fresh browser starts the normal two-seat preset at seed 1. All mutations
// below are player controls. Read-only snapshots verify draws, identity and replay.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createServer } from "vite";

const [workspace, playwright, executablePath, output, variant = "standard", method = "mouse"] = process.argv.slice(2);
assert.ok(["standard", "partial"].includes(variant));
assert.ok(["mouse", "keyboard", "touch"].includes(method));
const root = resolve(workspace, "apps/web");
const server = await createServer({ root, configFile: resolve(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
const { chromium } = createRequire(import.meta.url)(playwright);
const browser = await chromium.launch({ executablePath, headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  await mkdir(output, { recursive: true });
  await server.listen();
  const touch = method === "touch";
  const viewport = touch ? { width: 412, height: 915 } : { width: 1366, height: 900 };
  const page = await browser.newPage({ viewport, hasTouch: touch, deviceScaleFactor: 1 });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(new URL("/setup/multiplayer", server.resolvedUrls.local[0]).href);
  // Focus must be reachable in real tab order. Deliberately avoid locator.focus(),
  // injected game actions, or a click to jump into the keyboard workflow.
  async function reach(locator) {
    await locator.waitFor({state: "visible"});
    for (let index = 0; index < 230; index++) {
      const direction = await locator.evaluate(node => {
        const active = document.activeElement;
        if (active === node) return null;
        return active && (active.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING)
          ? "Shift+Tab" : "Tab";
      });
      if (!direction) return;
      await page.keyboard.press(direction);
    }
    throw Error("Keyboard could not reach " + await locator.textContent());
  }
  async function activate(locator) {
    if (method === "keyboard") {
      await reach(locator);
      await page.keyboard.press("Enter");
    } else if (touch) await locator.tap();
    else await locator.click();
  }
  async function choose(locator, value) {
    if (method !== "keyboard") return locator.selectOption(value);
    await reach(locator);
    const index = await locator.evaluate((select, value) => [...select.options].findIndex(o => o.value === value), value);
    assert.ok(index >= 0);
    await page.keyboard.press("Alt+ArrowDown");
    await page.keyboard.press("Home");
    for (let i = 0; i < index; i++) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
  }
  async function enterText(locator, value) {
    if (method !== "keyboard") return locator.fill(value);
    await reach(locator);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(value);
  }
  await activate(page.getByRole("button", { name: "Start", exact: true }));
  const read = () => page.evaluate(async () => {
    const { useGameStore } = await import("/src/game/store.ts");
    const { turn } = useGameStore.getState();
    return { seed: turn.seed, turn: turn.turn, hands: turn.players.map(p => p.hand.map(c => c.id)),
      events: turn.events, board: turn.board, draft: turn.draft, reports: turn.reports, finalScore: turn.finalScore };
  });
  const ready = page.getByRole("button", { name: "Ready · Reveal my hand" });
  const details = page.getByRole("button", { name: "Turn details" });
  const turnPanel = page.getByLabel("Shared-table turn");
  const selectedHand = turnPanel.locator(".turn-cards[aria-label]");
  const end = turnPanel.getByRole("button", { name: "End turn / pass" });
  let capturedBoard = false;
  async function showHand(player) {
    await page.getByRole("heading", { name: "Pass to Player " + player }).waitFor();
    assert.equal(await page.locator("canvas,.turn-panel,.env-tray").count(), 0);
    await activate(ready);
    if (touch && !capturedBoard) {
      await page.screenshot({ path: resolve(output, "touch-hand-controls.png") });
      capturedBoard = true;
    }
    await activate(details);
    await turnPanel.waitFor();
  }
  async function element(card, first, last) {
    await activate(selectedHand.getByRole("button", { name: card }));
    const picker = turnPanel.locator("details").filter({ hasText: "Quarter-point placement" });
    await activate(picker.locator("summary"));
    if (method === "keyboard" && !capturedBoard) {
      await page.screenshot({ path: resolve(output, "keyboard-quarter-form.png") });
      capturedBoard = true;
    }
    for (const [side, target] of [["A", first], ["B", last]]) {
      if (target.startsWith("port:")) await choose(picker.getByLabel("End " + side + " port"), target);
      else await enterText(picker.getByLabel("End " + side + " grid x,y,z"), target);
    }
    await activate(picker.getByRole("button", { name: "Stage element" }));
    assert.equal((await read()).draft.members.length, 1);
  }
  async function fixedAt(member, side, port) {
    await activate(selectedHand.getByRole("button", { name: /Fixed \/ moment/i }).first());
    const targets = turnPanel.getByRole("button", { name: new RegExp("Member " + member + " · end " + side) });
    await activate(port ? targets.filter({ hasText: port }) : targets.first());
    assert.equal((await read()).draft.connections.length, 1);
  }
  // The vertical parent carries card gravity axially. The alternate horizontal
  // cantilever exceeds the small-motion envelope, exercising partial evidence.
  // Both use the same midpoint, card sequence and precise player controls.
  await showHand(1);
  const opening = await read();
  assert.equal(opening.seed, 1);
  // An ordinary opposing foundation is a legal gravity target even before
  // either player activates a quarter port. Cancel restores the original hand.
  const oppositeBase = opening.board.joints.find(joint => joint.foundationOwner === "player-2").id;
  await activate(selectedHand.getByRole("button", { name: /5 kN down/i }));
  await choose(turnPanel.getByLabel("Load at joint"), oppositeBase);
  assert.equal((await read()).draft.loads[0].jointId, oppositeBase);
  await activate(turnPanel.getByRole("button", { name: "Cancel draft" }));
  assert.deepEqual((await read()).hands, opening.hands);
  assert.equal((await read()).draft.loads.length, 0);
  await element(/GLULAM/i, "1,3,1", variant === "partial" ? "3,3,1" : "1,3,3");
  await fixedAt(3, "A");
  await activate(end);
  await showHand(2);
  await element(/GLULAM/i, "port:3:2", variant === "partial" ? "2,4,1" : "2,3,2");
  await fixedAt(4, "A", "50%");
  await activate(selectedHand.getByRole("button", { name: /10 kN down/i }));
  await choose(turnPanel.getByLabel("Load at joint"), "port:3:2");
  const staged = await read();
  assert.equal(staged.draft.loads[0].magnitude, 10);
  await page.reload();
  await showHand(2);
  assert.deepEqual((await read()).draft, staged.draft);
  assert.deepEqual((await read()).hands, staged.hands);
  await activate(end);
  await showHand(1);
  await element(/HEB · ≤1 cells\/axis/i, "3,5,1", "4,5,1");
  await activate(end);
  for (let turn = 4; turn <= 16; turn++) {
    await showHand(turn % 2 === 0 ? 2 : 1);
    await activate(end);
  }
  await page.getByRole("heading", { name: "Table complete" }).waitFor();
  const complete = await read();
  assert.equal(complete.reports.length, 16);
  assert.equal(complete.events.filter(e => e.kind === "end").length, 16);
  assert.equal(complete.board.loads[0].jointId, "port:3:2");
  assert.equal(complete.finalScore.totalGravityKN, 10);
  const third = complete.reports[2];
  assert.equal(third.penalty, -1);
  assert.equal(complete.reports.filter(report => report.penalty < 0).length, 1);
  assert.deepEqual(third.penaltyDecision.event.issueIds, ["instability:5"]);
  const accepted = third.correction.attempts.filter(attempt => attempt.status === "verified");
  assert.equal(accepted.length, 1);
  assert.deepEqual(third.correction.pending, []);
  const prop = complete.board.members.find(member => member.id === accepted[0].propId);
  assert.equal(prop.system.turn, 3);
  assert.equal(prop.owner, "neutral");
  assert.equal(complete.board.members.filter(member => member.system).length, 1);
  assert.ok(third.correction.repairChecks.length >= 3);
  assert.ok(third.correction.repairChecks.every(check => check.validity === "verified" && !check.active));
  assert.equal(complete.finalScore.partial, variant === "partial");
  assert.equal(complete.finalScore.unknownGravityKN, variant === "partial" ? 10 : 0);
  assert.equal(complete.finalScore.awards[0].penaltyPoints, 1);
  assert.ok(Math.abs(complete.finalScore.awards[0].finalScore - (variant === "partial" ? -1 : 99)) < 1e-8);
  await page.reload();
  await page.getByRole("heading", { name: "Table complete" }).waitFor();
  const resumed = await read();
  for (const key of ["finalScore", "board", "reports", "events", "hands"]) assert.deepEqual(resumed[key], complete[key]);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: resolve(output, variant + "-" + method + "-final.png") });
  console.log(JSON.stringify({ browser: browser.version(), seed: complete.seed, variant, method, viewport,
    players: complete.finalScore.awards, reactionsPartial: complete.finalScore.partial,
    gravityKN: complete.finalScore.totalGravityKN, reports: complete.reports.length,
    turn3: { penalty: third.penalty, issues: third.penaltyDecision.event.issueIds,
      accepted, checks: third.correction.repairChecks.map(({id, utilization}) => ({id, utilization})) }, pageErrors: errors }));
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  if (page) {
    await page.screenshot({ path: resolve(output, variant + "-" + method + "-interrupted.png") });
    console.error("Visible game state at interruption", (await page.locator("body").innerText()).slice(-1600));
  }
  throw error;
} finally {
  await browser.close();
  await server.close();
}
