import * as THREE from "three";
import {readFile} from "node:fs/promises";
import {beforeAll, describe, expect, it} from "vitest";
import {CONNECTION_PROFILES, conflictingJointAxes, connectionDefinition, connectionFrameFor,
  memberConnectionFrame, type ConnectionProfile} from "../game/jointFreedom";
import {createReleaseGame, type TurnState} from "../game/turns";
import {toTurnEvaluatorInput} from "../game/turnAnalysis";
import {createTurnSolver} from "../evaluator/engine/releaseTurn";
import {ITEMS} from "../evaluator/sections";
import type {EvaluatorModel} from "../evaluator/model";
import {assessCardCapacity} from "../evaluator/capacity";
import {sharedJointPermissions} from "./jointPermissions";
import {poseSection, wideFlangeGeometry} from "./sectionGeometry";

const solver = createTurnSolver(async () => Uint8Array.from(await readFile(new URL("../solver/wasm/dof_solver.wasm",import.meta.url))).buffer);
beforeAll(solver.prepare);

describe("member-local release physical and graphical contract", () => {
  it.each(["2,0,0","0,2,0","0,0,2","1,2,3","-1,-2,-3"])("uses the actual section frame along %s", end => {
    const member = {a:"0,0,0",b:end};
    const frame = memberConnectionFrame(member);
    const direction = new THREE.Vector3(...end.split(",").map(Number) as [number,number,number]);
    const mesh = new THREE.Mesh(wideFlangeGeometry("heb"),new THREE.MeshBasicMaterial());
    poseSection(mesh,new THREE.Vector3(),direction,direction,1);
    expect(new THREE.Vector3(0,0,1).applyQuaternion(mesh.quaternion).dot(new THREE.Vector3(...frame[0]))).toBeCloseTo(1,12);
    expect(new THREE.Vector3(1,0,0).applyQuaternion(mesh.quaternion).dot(new THREE.Vector3(...frame[1]))).toBeCloseTo(1,12);
    expect(new THREE.Vector3(0,1,0).applyQuaternion(mesh.quaternion).dot(new THREE.Vector3(...frame[2]))).toBeCloseTo(1,12);
    expect(new THREE.Vector3(...frame[0]).cross(new THREE.Vector3(...frame[1])).dot(new THREE.Vector3(...frame[2]))).toBeCloseTo(1,12);
    const reversed = memberConnectionFrame({a:end,b:"0,0,0"});
    for (const profile of ["fixed","ball","lock-x","lock-xz","lock-yz"] as const) {
      expect(conflictingJointAxes(CONNECTION_PROFILES[profile],CONNECTION_PROFILES[profile],frame,reversed)).toEqual([]);
    }
    expect(conflictingJointAxes(CONNECTION_PROFILES.fixed,CONNECTION_PROFILES.fixed,connectionFrameFor({profile:"fixed"}),frame)).toEqual([]);
    mesh.geometry.dispose(); mesh.material.dispose();
  });

  function transverseBeam(profile: ConnectionProfile, memberLocal = true, reversed = false, rotated = false) {
    const base = "0,0,0", tip = rotated ? "-2,0,0" : "0,2,0";
    const endpoints = reversed ? {a:tip,b:base} : {a:base,b:tip};
    const axes = memberConnectionFrame(endpoints);
    const law = connectionDefinition(profile,memberLocal ? axes : undefined);
    const member = {id:1,type:"heb" as const,...endpoints,endA:"fixed" as const,endB:"fixed" as const,
      ...(reversed ? {connectionB:law} : {connectionA:law})};
    const input: EvaluatorModel = {nextId:2,attrs:{[base]:{found:true},[tip]:{load:5}},members:[member]};
    return {input,axes,result:solver.analyze(input,"local-frame-fixture"),base,tip};
  }

  it("distinguishes a member torsion release from a world-axis flexural hinge using actual Rust response", () => {
    // A global-Y beam has local X along Y, local Y along -X and local Z up.
    // lock-yz frees torsion. The old world convention freed bending about X.
    const local = transverseBeam("lock-yz"), world = transverseBeam("lock-yz",false);
    expect(local.result.combos[0].components![0].verification!.status).toBe("verified-nonlinear");
    expect(world.result.combos[0].components![0].verification!.status).toBe("unverified");
    const combo = local.result.combos[0], ctx = local.result.ctx!;
    const tip = ctx.aid[ctx.idx.get(local.tip)!], base = ctx.aid[ctx.idx.get(local.base)!];
    const deflection = combo.partialDisplacements!.get(tip)![2];
    // The kernel includes shear flexibility. The selected section's local Z
    // displacement is bending about Y plus its actual G·Avz shear term.
    const analytical = -5 * 4 ** 3 / (3 * ITEMS.heb.E * ITEMS.heb.Iy) - 5 * 4 / (ITEMS.heb.G * ITEMS.heb.Avz);
    expect(deflection).toBeCloseTo(analytical,7);
    expect(combo.reac![base][2]).toBeCloseTo(5,7);
    const capacity = assessCardCapacity(local.input,local.result,[{memberId:1,end:"a",profile:"lock-yz",axes:local.axes}]);
    expect(capacity.connections["1:a"].status).toBe("verified");
    // The complementary printing frees local Y bending, while the historical
    // world-Y release was pure torsion for this member orientation.
    expect(transverseBeam("lock-xz").result.combos[0].components![0].verification!.status).toBe("unverified");
    expect(transverseBeam("lock-xz",false).result.combos[0].components![0].verification!.status).toBe("verified-nonlinear");
  });

  it("preserves gravity response and capacity under rigid Z rotation and member reversal", () => {
    const original = transverseBeam("lock-yz");
    const readings = (value:ReturnType<typeof transverseBeam>) => {
      const combo = value.result.combos[0], ctx = value.result.ctx!;
      return {status:combo.components![0].verification!.status,
        displacement:combo.partialDisplacements!.get(ctx.aid[ctx.idx.get(value.tip)!])![2],
        reaction:combo.reac![ctx.aid[ctx.idx.get(value.base)!]][2]};
    };
    for (const alternative of [transverseBeam("lock-yz",true,true),transverseBeam("lock-yz",true,false,true)]) {
      const before = readings(original), after = readings(alternative);
      expect(after.status).toBe(before.status);
      expect(after.displacement).toBeCloseTo(before.displacement,9);
      expect(after.reaction).toBeCloseTo(before.reaction,7);
      const capacity = assessCardCapacity(alternative.input,alternative.result,[{memberId:1,end:alternative.input.members[0].a === alternative.base ? "a" : "b",profile:"lock-yz",axes:alternative.axes}]);
      expect(Object.values(capacity.connections)[0].status).toBe("verified");
    }
  });

  it("projects oblique local freedoms as coupled global components without changing their local laws", () => {
    const axes = memberConnectionFrame({a:"0,0,0",b:"1,1,1"});
    const board: TurnState["board"] = {members:[{id:3,type:"heb",a:"0,0,0",b:"1,1,1",owner:"player-1"}],loads:[],
      joints:[{id:"joint",point:"0,0,0"}],connections:[{memberId:3,end:"a",jointId:"joint",profile:"lock-x",owner:"player-1",axes,frameVersion:"member-local-1"}]};
    const [joint] = sharedJointPermissions(board);
    expect(joint.frame).toEqual(axes);
    expect(joint.components).toEqual(["locked","locked","locked","locked","free","free"]);
    expect(joint.global!.slice(3)).toEqual(["coupled","coupled","coupled"]);
    expect(joint.attachments[0]).toContain("member-local axes");
    expect(connectionFrameFor(board.connections[0])).toEqual(axes);
  });

  it("keeps parent quarter continuity separate from an incoming member's local releases", () => {
    const state = createReleaseGame(0);
    const parent = {id:3,type:"heb" as const,a:"5,7,1",b:"7,7,1",owner:"player-1"};
    const branch = {id:4,type:"heb" as const,a:"6,7,1",b:"6,8,2",owner:"player-2"};
    const axes = memberConnectionFrame(branch);
    state.board.members.push(parent,branch);
    state.board.joints.push({id:"port:3:2",point:"6,7,1"});
    state.board.connections.push({memberId:3,end:"a",jointId:"5,7,1",profile:"fixed",owner:"player-1",axes:memberConnectionFrame(parent),frameVersion:"member-local-1"},
      {memberId:4,end:"a",jointId:"port:3:2",profile:"lock-yz",owner:"player-2",axes,frameVersion:"member-local-1"});
    state.board.loads.push({cardId:"fixture-load",jointId:"endpoint:4:b",magnitude:1,owner:"player-2"});
    state.nextId = 5;
    const model = toTurnEvaluatorInput(state);
    const parentPieces = model.members.filter(member => member.parentSpan?.memberId === 3);
    expect(parentPieces).toHaveLength(2);
    expect(parentPieces[0].b).toBe("port:3:2");
    expect(parentPieces[1].a).toBe("port:3:2");
    expect(parentPieces[0].endB).toBe("fixed");
    expect(parentPieces[1].endA).toBe("fixed");
    expect(parentPieces[0].connectionB).toBeUndefined();
    expect(parentPieces[1].connectionA).toBeUndefined();
    expect(model.members.find(member => member.id === 4)!.connectionA!.axes).toEqual(axes);
    const result = solver.analyze(model,"quarter-local-release");
    expect(result.combos[0].components!.every(scope => scope.verification?.status === "verified-nonlinear")).toBe(true);
    const loadedHalf = result.ctx!.els.find(element => element.m.id === parentPieces[0].id)!;
    // Use the actual displaced lever for nonlinear moment balance. The HEB's
    // modest torsional rigidity lets the oblique branch rotate appreciably.
    const currentY = (key:string) => {
      const node = result.ctx!.idx.get(key)!;
      return result.ctx!.pos[node][1] + result.combos[0].partialDisplacements!.get(result.ctx!.aid[node])![1];
    };
    const gravityTorque = currentY("endpoint:4:b") - currentY("5,7,1");
    expect(gravityTorque).toBeGreaterThan(1);
    expect(Math.abs(result.combos[0].ef!.get(loadedHalf)!.f[3])).toBeCloseTo(gravityTorque,4);
    const vertical = Object.values(result.combos[0].reac!).reduce((sum,reaction) => sum+reaction[2],0);
    expect(vertical).toBeCloseTo(1,7);
  });
});
