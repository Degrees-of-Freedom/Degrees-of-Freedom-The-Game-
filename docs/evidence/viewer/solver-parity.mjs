// node docs/evidence/viewer/solver-parity.mjs [workspace]
// Run on both checkouts. An exact hash covers all stored signed values,
// component verification, mechanism decisions and design buckling estimates.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";

const root = resolve(process.argv[2] ?? ".", "apps/web");
const server = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false, watch: null } });
try {
  const { analyzeGame } = await server.ssrLoadModule("/src/game/analysis.ts");
  const records = resolve(root, "public/structures/records");
  const hash = createHash("sha256");
  let analyses = 0;
  for (const file of (await readdir(records)).filter(name => name.endsWith(".json")).sort()) {
    const { save } = JSON.parse(await readFile(resolve(records, file), "utf8"));
    for (const loadCase of ["applied", "design"]) {
      const result = analyzeGame(save.model, { type: "sandbox", q0: 0, loadCase, budget: Infinity, inv: null });
      const combos = result.combos.map(c => ({
        components: c.components, fail: c.fail, reactions: c.reac, displacements: c.u,
        partialDisplacements: c.partialDisplacements && [...c.partialDisplacements],
        forces: c.ef && [...c.ef].map(([e, response]) => [e.m.id, response.f, response.ul, response.slack]),
      }));
      const summary = { file, loadCase, error: result.error, mechanism: result.mechanism,
        unresolved: result.unresolved, alpha: result.alpha, combos };
      hash.update(JSON.stringify(summary, (_key, value) =>
        typeof value === "number" && !Number.isFinite(value) ? String(value) : value));
      analyses++;
    }
  }
  console.log(JSON.stringify({ analyses, sha256: hash.digest("hex") }));
} finally {
  await server.close();
}
