import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { beforeAll, expect, it } from "vitest";
import { createTurnSolver } from "../evaluator/engine/releaseTurn";
import type { EvaluatorModel } from "../evaluator/model";
import { computeLoadPath } from "../evaluator/loadPath";
import { buildReleaseFlow } from "./releaseFlow";

const solver = createTurnSolver(async () => Uint8Array.from(await readFile(new URL("../solver/wasm/dof_solver.wasm", import.meta.url))).buffer);
beforeAll(solver.prepare);

function branchedFrame(): EvaluatorModel {
  return {nextId:5, positions:{left:[0,0,0],lh:[0,0,2],mid:[2,0,2],rh:[4,0,2],right:[4,0,0]},
    attrs:{left:{found:true},right:{found:true},mid:{load:5}}, members:[
      {id:1,type:"heb",a:"left",b:"lh",endA:"fixed",endB:"fixed"},
      {id:2,type:"shs",a:"right",b:"rh",endA:"fixed",endB:"fixed"},
      {id:3,type:"heb",a:"lh",b:"mid",endA:"fixed",endB:"fixed"},
      {id:4,type:"heb",a:"mid",b:"rh",endA:"fixed",endB:"fixed"},
    ]};
}

it("shows both actual asymmetric gravity branches, including horizontal shear/bending transfer", () => {
  const model = branchedFrame();
  const result = solver.analyze(model,"branch-flow");
  const path = computeLoadPath(result,0)!;
  expect(path.members.get(3)!.direction).toBe(-1);
  expect(path.members.get(4)!.direction).toBe(1);
  expect(path.members.get(3)!.force + path.members.get(4)!.force).toBeCloseTo(5,4);
  expect(path.members.get(3)!.force).not.toBeCloseTo(path.members.get(4)!.force,2);
  expect(path.members.get(3)!.mode).toBe("bending");
  const group = new THREE.Group(), moving:number[] = [];
  buildReleaseFlow(group,result,key => {
    const p = result.ctx!.pos[result.ctx!.idx.get(key)!];
    return new THREE.Vector3(...p as [number,number,number]);
  }, member => moving.push(member.memberId));
  expect(moving.sort()).toEqual([1,2,3,4]);
  expect(group.children).toHaveLength(4);
  const reversed = branchedFrame();
  for (const member of reversed.members) [member.a,member.b] = [member.b,member.a];
  const reversePath = computeLoadPath(solver.analyze(reversed,"reverse-flow"),0)!;
  for (const member of path.members.values()) {
    expect(reversePath.members.get(member.memberId)!.force).toBeCloseTo(member.force,4);
    expect(reversePath.members.get(member.memberId)!.direction).toBe(-member.direction);
  }
});

it("has no moving flow in a zero-gravity state and keeps unavailable members out of verified flow", () => {
  const model = branchedFrame();
  delete model.attrs.mid.load;
  const unloaded = computeLoadPath(solver.analyze(model,"no-gravity"),0)!;
  expect([...unloaded.members.values()].every(member => member.direction === 0)).toBe(true);
  model.attrs.mid.load = 5;
  model.positions!.looseA = [8,0,1]; model.positions!.looseB = [9,0,1];
  model.members.push({id:5,type:"heb",a:"looseA",b:"looseB"});
  model.nextId = 6;
  const partial = computeLoadPath(solver.analyze(model,"partial-flow"),0)!;
  expect(partial.members.has(5)).toBe(false);
  expect(partial.members.get(3)!.direction).toBe(-1);
  expect(partial.members.get(4)!.direction).toBe(1);
});
