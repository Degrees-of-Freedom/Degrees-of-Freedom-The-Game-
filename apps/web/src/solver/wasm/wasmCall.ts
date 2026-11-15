/**
 * The raw interface of `dof_solver.wasm`, shared by the main thread and the
 * solver worker. See `crates/dof-solver/src/lib.rs` for the exports.
 */

/** Functions exported by the module. */
export interface SolverExports {
  memory: WebAssembly.Memory;
  dof_alloc(length: number): number;
  dof_free(pointer: number, length: number): void;
  dof_analyze(pointer: number, length: number): number;
}

/** Instantiate a compiled module. It has no imports. */
export async function instantiate(module: WebAssembly.Module): Promise<SolverExports> {
  const instance = await WebAssembly.instantiate(module, {});
  return instance.exports as unknown as SolverExports;
}

/**
 * Pass one JSON request through the module and return its JSON answer.
 *
 * Synchronous: it occupies the calling thread until the solver returns.
 * Throws a `WebAssembly.RuntimeError` if the module traps (a Rust panic);
 * the instance's memory is then in an unknown state and must be discarded.
 */
export function call(solver: SolverExports, request: string): string {
  const input = new TextEncoder().encode(request);
  const inputPointer = solver.dof_alloc(input.length);
  // Take the memory view after allocating: growing the memory detaches views.
  new Uint8Array(solver.memory.buffer, inputPointer, input.length).set(input);
  let outputPointer: number;
  try {
    outputPointer = solver.dof_analyze(inputPointer, input.length);
  } finally {
    solver.dof_free(inputPointer, input.length);
  }
  // The answer is a little-endian length followed by that many UTF-8 bytes.
  const length = new DataView(solver.memory.buffer).getUint32(outputPointer, true);
  const text = new TextDecoder().decode(new Uint8Array(solver.memory.buffer, outputPointer + 4, length));
  solver.dof_free(outputPointer, length + 4);
  return text;
}
