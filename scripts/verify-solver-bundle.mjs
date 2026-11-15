import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const digest = async url => createHash("sha256").update(await readFile(url)).digest("hex");
const built = await digest(new URL("crates/dof-solver/target/wasm32-unknown-unknown/release/dof_solver.wasm", root));
const assets = new URL("apps/web/dist/assets/", root);
const modules = (await readdir(assets)).filter(name => /^dof_solver-.*\.wasm$/.test(name));
assert.equal(modules.length, 1, "Expected one hashed structural solver in the production build");
assert.equal(await digest(new URL(modules[0], assets)), built, "Vite distributed a different solver binary");
console.log("Production solver SHA-256", built);

const names = (await readdir(assets)).sort();
const files = Object.fromEntries(await Promise.all(names.map(async name => [name, await digest(new URL(name, assets))])));
const commit = execFileSync("git", ["rev-parse", "HEAD"], {encoding:"utf8"}).trim();
// A cross-compiled WASM file can vary by toolchain. It has its own exact digest.
const changes = execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--",
  "apps/web/src", "apps/web/public", "apps/web/index.html", "apps/web/vite.config.ts", "crates",
  "packages", "package*.json", "apps/*/package.json", ":(exclude)apps/web/src/solver/wasm/dof_solver.wasm"], {encoding:"utf8"}).trim();
const build = {commit, dirtySource: !!changes, solverFile: modules[0], solverSha256:built,
  assetsSha256:createHash("sha256").update(JSON.stringify(files)).digest("hex")};
await writeFile(new URL("apps/web/dist/release-build.json",root), JSON.stringify(build,null,2)+"\n");

