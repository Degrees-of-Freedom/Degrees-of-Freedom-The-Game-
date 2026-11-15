import { readFile } from "node:fs/promises";
import { beforeAll, expect, it } from "vitest";
import { createTurnSolver } from "../solver/wasm/turnSolver";
import type { VoxelModel } from "../solver/voxelInput";
import { sectionCuts } from "./sectionCuts";

const solver = createTurnSolver(async () => Uint8Array.from(await readFile(new URL("../solver/wasm/dof_solver.wasm", import.meta.url))).buffer);
beforeAll(solver.prepare);

it("plots actual cantilever section cuts, in kN and kN·m, for a 5 kN tip load and 4 m span", () => {
  const model: VoxelModel = { nextId: 2, attrs: { base: { found: true }, tip: { load: 5 } },
    positions: { base: [0,0,0], tip: [2,0,0] }, members: [{ id: 1, a: "base", b: "tip", type: "heb", endA: "fixed", endB: "fixed" }] };
  const [span] = sectionCuts(solver.analyze(model, "cantilever"), 1);
  expect(span.cuts.map(c => c.at)).toEqual([0, .5, .5, 1]);
  for (const cut of span.cuts) {
    expect(cut.forces[2]).toBeCloseTo(-5, 3);
    expect(cut.forces[4]).toBeCloseTo(20 * (1-cut.at), 3);
  }
});

it("preserves both sides of a midspan gravity point on a simply supported beam", () => {
  const model: VoxelModel = { nextId: 4, attrs: { left: {found: true, restraint: [true,true,true,true,false,false]},
    right: {found: true, restraint: [false,true,true,false,false,false]}, mid: {load: 4} },
    positions: {left:[0,0,0], mid:[1,0,0], right:[2,0,0]},
    members: [{id:2, type:"heb", a:"left", b:"mid", parentSpan:{memberId:1, fromQuarter:0, toQuarter:2}},
      {id:3, type:"heb", a:"mid", b:"right", parentSpan:{memberId:1, fromQuarter:2, toQuarter:4}}] };
  const [left, right] = sectionCuts(solver.analyze(model, "midpoint"), 1);
  const before = left.cuts.at(-1)!, after = right.cuts[0];
  expect(before.at).toBe(.5);
  expect(after.at).toBe(.5);
  expect(before.forces[2]).toBeCloseTo(-2,3);
  expect(after.forces[2]).toBeCloseTo(2,3);
  expect(Math.abs(before.forces[4])).toBeCloseTo(4,3);
  expect(after.forces[4]).toBeCloseTo(before.forces[4],3);
  expect(left.cuts[0].forces[4]).toBeCloseTo(0,5);
  expect(right.cuts.at(-1)!.forces[4]).toBeCloseTo(0,5);
});
