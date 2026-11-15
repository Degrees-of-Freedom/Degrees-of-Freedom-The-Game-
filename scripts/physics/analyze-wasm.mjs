// Pipe one SI AnalysisModel + options JSON request through the production artifact.
import { readFileSync } from 'node:fs';
const bytes = readFileSync(new URL('../../apps/web/src/solver/wasm/dof_solver.wasm', import.meta.url));
const {instance: {exports: solver}} = await WebAssembly.instantiate(bytes);
const input = readFileSync(0);
const ptr = solver.dof_alloc(input.length);
new Uint8Array(solver.memory.buffer, ptr, input.length).set(input);
const output = solver.dof_analyze(ptr, input.length);
solver.dof_free(ptr, input.length);
const length = new DataView(solver.memory.buffer).getUint32(output, true);
process.stdout.write(new Uint8Array(solver.memory.buffer, output + 4, length));
solver.dof_free(output, length + 4);
