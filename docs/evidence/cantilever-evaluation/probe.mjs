// Run from the repository root: node docs/evidence/cantilever-evaluation/probe.mjs
// This read-only probe reports current behavior; it does not gate a future fix.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const app = path.join(root, "apps/web");
const server = await createServer({
  root: app,
  configFile: path.join(app, "vite.config.ts"),
  server: { middlewareMode: true },
});

try {
  const load = name => server.ssrLoadModule(path.join(app, "src/game", name));
  const rules = await load("turns.ts");
  const catalogue = await load("cardCatalogue.ts");
  const analysis = await load("turnAnalysis.ts");
  const cards = catalogue.createReleaseDecks().flat();
  const frame = cards.find(c => c.kind === "element" && c.type === "heb" && c.maxSteps === 5);
  const fixed = cards.find(c => c.kind === "connection" && c.profile === "fixed");
  if (!frame || !fixed) throw new Error("The evaluation printings are unavailable.");

  // Exact printing fixtures avoid making the findings dependent on a dealt hand.
  const turn = rules.createTurnGame(41, catalogue.RELEASE_CATALOGUE);
  turn.players[0].hand = [frame, fixed];
  const placed = rules.stageElement(turn, frame.id, "5,7,1", "9,7,1");
  if (!placed.ok) throw new Error(placed.reason);
  const attached = rules.stageConnection(placed.state, fixed.id, 3, "a");
  if (!attached.ok) throw new Error(attached.reason);

  // The column top at (5,7,1) is exactly 25% along this new four-unit beam.
  const overhang = rules.stageElement(turn, frame.id, "4,7,1", "8,7,1");
  // Deliberately exercise the JS runtime guard for a source the TS API excludes.
  const interior = rules.stageConnection(placed.state, fixed.id, 3, "midpoint");
  const input = analysis.toTurnVoxelInput(attached.state);
  console.log(JSON.stringify({
    oneEndCantilever: {
      accepted: attached.ok,
      connectionsSpent: attached.state.draft.connections.length,
      analyticalBeam: input.members.find(member => member.id === 3),
      note: "A fixed member-end law at an independent tip node does not restrain that node to ground.",
    },
    newBeamSupportedAtOwnQuarter: {
      accepted: overhang.ok,
      ...(overhang.ok ? {} : { reason: overhang.reason }),
    },
    interiorConnectionSource: {
      accepted: interior.ok,
      ...(interior.ok ? {} : { reason: interior.reason }),
    },
  }, null, 2));
} finally {
  await server.close();
}
