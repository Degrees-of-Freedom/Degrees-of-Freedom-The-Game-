import * as THREE from "three";
import { readFile } from "node:fs/promises";
import { beforeAll, expect, it } from "vitest";
import { createTurnSolver } from "../solver/wasm/turnSolver";
import type { VoxelModel } from "../solver/voxelInput";
import { drawInstabilityMode, instabilityModes } from "./instabilityModes";
import { deflectionColor } from "./deflectedGeometry";

const solver = createTurnSolver(async () => Uint8Array.from(await readFile(new URL("../solver/wasm/dof_solver.wasm", import.meta.url))).buffer);
beforeAll(solver.prepare);

it("projects real solver mechanism vectors independently of unavailable equilibrium response", () => {
  const model: VoxelModel = {nextId:2, positions:{base:[0,0,0],tip:[0,0,2]},attrs:{base:{found:true}},
    members:[{id:1,type:"heb",a:"base",b:"tip",endA:"ball",endB:"fixed"}]};
  const result = solver.analyze(model,"mode-fixture");
  const modes = instabilityModes(result);
  expect(modes.length).toBeGreaterThan(0);
  expect(modes.some(mode => mode.kind === "mechanism")).toBe(true);
  expect(modes.every(mode => mode.memberIds.includes(1))).toBe(true);
  const index = modes.findIndex(mode => mode.kind === "mechanism");
  const before = JSON.stringify(model);
  const group = new THREE.Group();
  drawInstabilityMode(group,result,index,true);
  const ghost = group.getObjectByName("Solver normalized mode ghost") as THREE.LineSegments;
  expect(ghost).toBeDefined();
  const positions = ghost.geometry.getAttribute("position");
  expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
  const initial = Array.from(positions.array);
  group.userData.animateInstability(Math.PI*900);
  expect(Array.from(positions.array)).not.toEqual(initial);
  expect(JSON.stringify(model)).toBe(before);
  const still = new THREE.Group();
  drawInstabilityMode(still,result,index);
  expect(still.userData.animateInstability).toBeUndefined();
});

it("uses the specified continuous six-colour contour, clamping only display fractions", () => {
  const stops = ["1e40af","24c9ed","43d68b","f5e65b","f19c38","ef5548"];
  stops.forEach((hex,i) => expect(deflectionColor(i/5).getHexString()).toBe(hex));
  expect(deflectionColor(-1).getHexString()).toBe(stops[0]);
  expect(deflectionColor(2).getHexString()).toBe(stops.at(-1));
});

it("does not substitute the reference shape when a returned mode has no nodal vector", () => {
  const result = solver.analyze({nextId:2, positions:{base:[0,0,0],tip:[0,0,2]}, attrs:{base:{found:true}},
    members:[{id:1,type:"heb",a:"base",b:"tip",endA:"ball",endB:"fixed"}]}, "internal-mode-fixture");
  const combo = result.combos[0];
  combo.components = combo.components?.map(scope => ({...scope,
    diagnosticModes: scope.diagnosticModes?.map(mode => ({...mode,displacements:{}}))}));
  expect(instabilityModes(result).length).toBeGreaterThan(0);
  expect(instabilityModes(result).every(mode => !mode.hasNodalMotion)).toBe(true);
  const group = new THREE.Group();
  drawInstabilityMode(group,result,0,true);
  expect(group.children).toHaveLength(0);
  expect(group.userData.animateInstability).toBeUndefined();
});

it("draws an actual floating component mode even when equilibrium assembly omits its elements", () => {
  const model: VoxelModel = {nextId:3,positions:{base:[0,0,0],tip:[0,0,1],looseA:[2,6,4],looseB:[2,7,4]},
    attrs:{base:{found:true}},members:[
      {id:1,type:"heb",a:"base",b:"tip",endA:"fixed",endB:"fixed"},
      {id:2,type:"heb",a:"looseA",b:"looseB",endA:"fixed",endB:"fixed"}]};
  const result = solver.analyze(model,"floating-mode-fixture");
  // Equilibrium assembly excludes the unsupported member. Its diagnostic
  // topology must still follow the model actually analysed by the kernel.
  expect(result.ctx!.els.map(element => element.m.id)).not.toContain(2);
  expect(result.diagnosticGeometry!.positions.looseA).toEqual([4,12,8]);
  expect(result.diagnosticGeometry!.segments.find(segment => segment.memberId === 2)).toEqual({memberId:2,a:"looseA",b:"looseB"});
  const modes = instabilityModes(result);
  const index = modes.findIndex(mode => mode.memberIds.includes(2) && mode.kind === "mechanism" &&
    Object.values(mode.displacements).some(values => Math.hypot(...values.slice(0,3)) > .5));
  expect(index).toBeGreaterThanOrEqual(0);
  const group = new THREE.Group();
  drawInstabilityMode(group,result,index,true);
  const ghost = group.getObjectByName("Solver normalized mode ghost") as THREE.LineSegments;
  const positions = ghost.geometry.getAttribute("position");
  expect(positions.count).toBe(2);
  const positive = Array.from(positions.array);
  expect(positive.every(Number.isFinite)).toBe(true);
  group.userData.animateInstability(Math.PI*900);
  const negative = Array.from(positions.array);
  const delta = negative.map((value,i) => Math.abs(value-positive[i]));
  expect(Math.max(...delta)).toBeCloseTo(1.6,5);
  expect(ghost.material).toMatchObject({depthTest:false,depthWrite:false});
  const withoutAssembly = new THREE.Group();
  drawInstabilityMode(withoutAssembly,{...result,ctx:undefined},index);
  const independent = withoutAssembly.getObjectByName("Solver normalized mode ghost") as THREE.LineSegments;
  expect(Array.from(independent.geometry.getAttribute("position").array)).toEqual(positive);
});
