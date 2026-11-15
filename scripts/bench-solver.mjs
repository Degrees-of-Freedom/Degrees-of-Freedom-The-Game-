// Time the WebAssembly solver on a representative game state and on the
// stress case from the solver criteria (about 500 members).
//
//   node scripts/bench-solver.mjs [runs] [case label substring]
//
// Times include JSON encoding and decoding on both sides, as the app pays
// them. They depend on the machine; record the hardware with the numbers.
import { readFileSync } from 'node:fs';
import os from 'node:os';

const bytes = readFileSync(process.env.DOF_BENCH_WASM ?? new URL('../apps/web/src/solver/wasm/dof_solver.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(bytes, {});
const solver = instance.exports;

function analyze(model, options) {
  const input = new TextEncoder().encode(JSON.stringify({ model, options }));
  const pointer = solver.dof_alloc(input.length);
  new Uint8Array(solver.memory.buffer, pointer, input.length).set(input);
  const out = solver.dof_analyze(pointer, input.length);
  solver.dof_free(pointer, input.length);
  const length = new DataView(solver.memory.buffer).getUint32(out, true);
  const text = new TextDecoder().decode(new Uint8Array(solver.memory.buffer, out + 4, length));
  solver.dof_free(out, length + 4);
  return JSON.parse(text);
}

const steel = { id: 'steel', E: 210e9, G: 81e9, A: 7.49e-3, Iy: 4.47e-5, Iz: 4.47e-5, J: 7.03e-5, density: 7850 };
const rod = { id: 'rod', E: 210e9, A: 3e-4, density: 7850 };

/** A braced multi-storey frame: fixed bases, rigid joints, some pinned beams and cables. */
function frame(baysX, baysY, storeys) {
  const model = { nodes: [], sections: [steel, rod], members: [], foundations: [], loads: [] };
  const id = (i, j, k) => `${i}-${j}-${k}`;
  let count = 0;
  const add = (a, b, extra = {}) => model.members.push({ id: `m${count++}`, startNodeId: a, endNodeId: b, sectionId: 'steel', ...extra });
  const hinge = { laws: ['rigid', 'rigid', 'rigid', 'rigid', 'free', 'free'] };
  for (let k = 0; k <= storeys; k++)
    for (let j = 0; j <= baysY; j++)
      for (let i = 0; i <= baysX; i++) {
        model.nodes.push({ id: id(i, j, k), position: [4 * i, 4 * j, 3 * k] });
        if (k === 0) model.foundations.push({ id: `f${i}-${j}`, nodeId: id(i, j, 0), restrained: [true, true, true, true, true, true] });
        if (k > 0) {
          add(id(i, j, k - 1), id(i, j, k));
          model.loads.push({ id: `l${id(i, j, k)}`, nodeId: id(i, j, k), force: [k === storeys ? 2e3 : 0, 5e2, -2e4] });
        }
        if (k > 0 && i > 0) add(id(i - 1, j, k), id(i, j, k), (i + j + k) % 3 === 0 ? { start: hinge, end: hinge } : {});
        if (k > 0 && j > 0) add(id(i, j - 1, k), id(i, j, k));
        if (k > 0 && i > 0 && j === 0) add(id(i - 1, j, k - 1), id(i, j, k), { kind: i % 2 ? 'cable' : 'brace', sectionId: 'rod' });
      }
  return model;
}

function time(label, model, options, runs) {
  if (caseFilter && !label.includes(caseFilter)) return;
  measuredCases++;
  const first = analyze(model, options);
  const dofs = first.components.reduce((sum, c) => sum + c.counts.freeDofs, 0);
  const times = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    analyze(model, options);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const at = (q) => times[Math.min(times.length - 1, Math.floor(q * times.length))].toFixed(1);
  const statuses = first.components.map((c) => c.status).join(',');
  console.log(
    `${label.padEnd(44)} members ${String(model.members.length).padStart(4)}  DOFs ${String(dofs).padStart(5)}  ` +
      `median ${at(0.5).padStart(7)} ms  p95 ${at(0.95).padStart(7)} ms  [${statuses}; ${first.analysis.iterations} iterations]`,
  );
}

const runs = Number(process.argv[2] ?? 20);
const caseFilter = process.argv[3];
let measuredCases = 0;
console.log(`${os.cpus()[0].model}, ${os.cpus().length} logical cores, Node ${process.version}, ${runs} runs each`);
const game = frame(2, 2, 2);
const stress = frame(5, 4, 6);
const gravity = [0, 0, -9.81];
time('game state, linear preview', game, { fidelity: 'linear', gravity }, runs);
time('game state, nonlinear turn', game, { gravity }, runs);
time('stress, linear preview, 1 element/beam', stress, { fidelity: 'linear', gravity, subdivisions: 1 }, runs);
time('stress, linear preview, 2 elements/beam', stress, { fidelity: 'linear', gravity }, runs);
time('stress, nonlinear turn, 1 element/beam', stress, { gravity, subdivisions: 1 }, runs);
time('stress, nonlinear turn, 2 elements/beam', stress, { gravity }, runs);
// Large frames use the sparse factorisation (solver 0.3); a few samples each.
const large = Math.min(runs, 3);
time('large 8x8x8, nonlinear, 2 elements/beam', frame(8, 8, 8), { gravity }, large);
time('large 10x10x10, linear, 2 elements/beam', frame(10, 10, 10), { fidelity: 'linear', gravity }, large);
time('large 10x10x10, nonlinear, 2 elements/beam', frame(10, 10, 10), { gravity }, large);
if (!measuredCases) throw new Error('No benchmark label matched ' + caseFilter);
