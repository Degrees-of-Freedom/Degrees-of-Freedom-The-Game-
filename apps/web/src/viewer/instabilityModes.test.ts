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
