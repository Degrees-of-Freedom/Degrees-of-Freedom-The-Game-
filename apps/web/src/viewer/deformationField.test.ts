import { expect, it } from "vitest";
import { analyzeVoxel } from "../solver/voxel/analyze";
import { componentSystems, solveComponents } from "../solver/voxel/components";
import { findComponents } from "../evaluator/geometry";
import type { VoxelModel, VoxelLevel } from "../evaluator/model";
import { ITEMS } from "../evaluator/sections";
import { deflectedFrameGeometry } from "./deflectedGeometry";
import { deformationField, spanDisplacement, spanPoint } from "./deformationField";
import { createTurnGame } from "../game/turns";
import { analyzeTurn } from "../game/turnAnalysis";
import { TRUSS_CATALOGUE } from "../game/cardCatalogue";
import { TRICHORD } from "../game/assembly";

const level: VoxelLevel = { type:"sandbox", loadCase:"applied", appliedSelfWeight:false, q0:0, budget:Infinity, inv:null };
const EI = ITEMS.heb.E * ITEMS.heb.Iy;
it("identifies an unsupported factory assembly by card even when no submembers entered the solver", () => {
  const turn = createTurnGame(1,TRUSS_CATALOGUE);
  turn.board.members.push({id:3,type:"shs",assembly:TRICHORD.id,a:"1,5,2",b:"3,5,2",owner:"player-1"});
  const field = deformationField(analyzeTurn(turn,"card-gravity"),0);
  expect([...field.unavailable]).toEqual([3]);
  expect(field.spans.has(3)).toBe(false);
});
function cantilever(): VoxelModel {
  return {members:[{id:1,type:"heb",a:"0,0,0",b:"2,0,0",endA:"fixed",endB:"ball"}],
    attrs:{"0,0,0":{found:true},"2,0,0":{load:1}}, nextId:2};
}

it("recovers cantilever curvature from the released physical end, at true and amplified scale", () => {
  const result = analyzeVoxel(cantilever(),level);
  const field = deformationField(result,0), span = field.spans.get(1)![0];
  for (const t of [0,.25,.5,.75,1]) {
    const x = 4*t, analytic = -x*x*(12-x)/(6*EI);
    expect(spanDisplacement(span,t).z).toBeCloseTo(analytic,12);
    expect(spanPoint(span,t,250).z).toBeCloseTo(250*analytic,10);
  }
  expect(spanDisplacement(span,.5).z/spanDisplacement(span,1).z).toBeCloseTo(5/16,12);
  // The two centroid coordinates computed from opposing flange extrema at
  // each interior profile station follow the same analytical centreline.
  const geometry = deflectedFrameGeometry([span],250,.14);
  const positions = geometry.getAttribute("position");
  const middle = spanPoint(span,.5,250);
  const z = Array.from({length:positions.count},(_,i)=>i)
    .filter(i=>Math.abs(positions.getX(i)-middle.x)<.02).map(i=>positions.getZ(i));
  expect((Math.max(...z)+Math.min(...z))/2).toBeCloseTo(middle.z,5);
  geometry.dispose();
});

it("recovers a pure end moment and superposes it with the existing point load", () => {
  const model = cantilever(); model.members[0].endB = "fixed";
  const result = analyzeVoxel(model,level), ctx = result.ctx!, combo = result.combos[0];
  const force = combo.F.slice(), tip = ctx.aid[ctx.idx.get("2,0,0")!];
  const { components,labels } = findComponents(ctx.keys,ctx.idx,model.members,ctx.isF);
  const systems = componentSystems(ctx,components,labels);
  force[6*tip+4] = 1;
  for (const vertical of [-1,0]) {
    force[6*tip+2] = vertical;
    const solved = solveComponents(ctx,systems,components,combo.combo,force,[]).result;
    const span = deformationField({...result,combos:[solved]},0).spans.get(1)![0];
    for (const t of [.25,.5,.75,1]) {
      const x=4*t;
      expect(spanDisplacement(span,t).z).toBeCloseTo(-x*x/(2*EI) + vertical*x*x*(12-x)/(6*EI),11);
    }
  }
});

it("shows a simply supported beam and keeps a separate unsupported member at reference", () => {
  const model: VoxelModel = { members:[
    {id:-4,type:"heb",a:"0,0,0",b:"1,0,0",endA:"fixed",endB:"fixed",parentSpan:{memberId:9,fromQuarter:0,toQuarter:2}},
    {id:-6,type:"heb",a:"1,0,0",b:"2,0,0",endA:"fixed",endB:"fixed",parentSpan:{memberId:9,fromQuarter:2,toQuarter:4}},
    {id:10,type:"ipe",a:"4,0,0",b:"5,0,0"}], nextId:11, attrs:{
      "0,0,0":{found:true,restraint:[true,true,true,true,false,false]},
      "2,0,0":{found:true,restraint:[false,true,true,false,false,false]},"1,0,0":{load:1}} };
  const field = deformationField(analyzeVoxel(model,level),0);
  expect([...field.spans.keys()]).toEqual([9]);
  expect([...field.unavailable]).toEqual([10]);
  expect(field.nodes.has("4,0,0")).toBe(false);
  const spans = field.spans.get(9)!;
  for (const [i,span] of spans.entries()) for (const t of [0,.5,1]) {
    const x=Math.min(2*i+2*t,4-2*i-2*t);
    expect(spanDisplacement(span,t).z).toBeCloseTo(-x*(3*16-4*x*x)/(48*EI),12);
  }
});
