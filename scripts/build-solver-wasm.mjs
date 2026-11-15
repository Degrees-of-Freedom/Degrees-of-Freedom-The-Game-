// Build the Rust solver to WebAssembly and copy the module into the web app.
//
// Cargo is run from the crate directory because the crate's `.cargo/config.toml`
// (which sets the WebAssembly stack size) only applies from there.
//
// Requires a Rust toolchain with the wasm32-unknown-unknown target:
//   rustup target add wasm32-unknown-unknown
import { spawnSync } from 'node:child_process';
import { copyFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const crate = fileURLToPath(new URL('../crates/dof-solver/', import.meta.url));
const built = fileURLToPath(new URL('../crates/dof-solver/target/wasm32-unknown-unknown/release/dof_solver.wasm', import.meta.url));
const bundled = fileURLToPath(new URL('../apps/web/src/solver/wasm/dof_solver.wasm', import.meta.url));

const cargo = spawnSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], { cwd: crate, stdio: 'inherit' });
if (cargo.error) {
  console.error(`Could not run cargo: ${cargo.error.message}`);
  process.exit(1);
}
if (cargo.status !== 0) process.exit(cargo.status ?? 1);

copyFileSync(built, bundled);
console.log(`Copied ${(statSync(bundled).size / 1024).toFixed(0)} kB to ${bundled}`);
