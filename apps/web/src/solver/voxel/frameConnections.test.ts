import { describe, expect, it } from 'vitest';
import { analyzeVoxel } from './analyze';
import { componentSystems, solveComponents } from './components';
import { findComponents } from '../../evaluator/geometry';
import { connectionDefinition } from '../../game/jointFreedom';
import type { VoxelModel, VoxelLevel } from '../../evaluator/model';
import { vecToGlobal } from './frameMath';
import { verifyLinearResponse } from './linearVerification';
import { ITEMS, S } from '../../evaluator/sections';
import type { FrameConnection } from './frameConnections';
import { solveCombo } from './frameSolve';
import { alphaCr } from './frameStability';

const level: VoxelLevel = {type:'sandbox', loadCase:'applied', appliedSelfWeight:false, q0:0, budget:Infinity, inv:null};
const root = '0,0,0', tip = '0,0,1';
function cantilever(connection: FrameConnection, reversed=false): VoxelModel {
  return {members:[{id:1, type:'shs', a:reversed ? tip : root, b:reversed ? root : tip,
    endA:'fixed', endB:'fixed', ...(reversed ? {connectionA:connection} : {connectionB:connection})}],
    attrs:{[root]:{found:true}}, nextId:2};
}
function loaded(model:VoxelModel, load:number[]) {
  const analysis = analyzeVoxel(model,level);
  const ctx = analysis.ctx!, F = new Float64Array(6*ctx.NA);
  const at = (id:string) => ctx.aid[ctx.idx.get(id)!];
  F.set(load,6*at(tip));
  const {components, labels} = findComponents(ctx.keys,ctx.idx,model.members,ctx.isF);
  const {result} = solveComponents(ctx,componentSystems(ctx,components,labels),components,analysis.combos[0].combo,F,[]);
  return {result,ctx,at};
}
describe('six-axis physical frame ends', () => {
  it.each([0,1,2,3,4,5])('adds the measured relative compliance on component %i', q => {
    const joint = connectionDefinition('fixed');
    joint.laws[q] = {kind:'elastic',stiffness:4e6};
    const load = Array(6).fill(0);
    load[q] = -0.2;
    const {result,ctx,at} = loaded(cantilever(joint),load);
    expect(result.components![0].verification?.status).toBe('verified-linear');
    const e = ctx.els[0], forces = result.ef!.get(e)!;
    const endMotion = vecToGlobal(forces.ul,e.R), endForces = vecToGlobal(forces.f,e.R);
    expect(endForces[6+q]).toBeCloseTo(-0.2,9);
    expect(result.u![6*at(tip)+q]-endMotion[6+q]).toBeCloseTo(-0.2/4000,12);
    const other = (q+1)%6;
    expect(result.u![6*at(tip)+other]).toBeCloseTo(endMotion[6+other],12);
    // A newly corrupted stiffness cannot pass the independent constitutive residual.
    joint.laws[q] = {kind:'elastic',stiffness:6e6};
    expect(verifyLinearResponse(ctx,result,[0,1],ctx.els,Infinity).status).toBe('unverified');
  });
  it('approaches the locked limit in series with the physical section', () => {
    for (const stiffness of [1e5,1e7,1e10]) {
      const joint = connectionDefinition('fixed');
      joint.laws[2] = {kind:'elastic',stiffness};
      const {result,at} = loaded(cantilever(joint),[0,0,0.05,0,0,0]);
      const reference = 0.05*(S/(ITEMS.shs.E*ITEMS.shs.A)+1000/stiffness);
      expect(result.components![0].verification?.status).toBe('verified-linear');
      expect(result.u![6*at(tip)+2]).toBeCloseTo(reference,12);
    }
  });
  it.each([false,true])('keeps the 45° hinge axis when the member is reversed (%s)', reversed => {
    const c = Math.SQRT1_2;
    const model = cantilever(connectionDefinition('hinge-diagonal'),reversed);
    const {result,ctx} = loaded(model,[0,0,0,-c*0.25,c*0.25,0]);
    expect(result.components![0].verification?.status).toBe('verified-linear');
    const e = ctx.els[0], f = vecToGlobal(result.ef!.get(e)!.f,e.R);
    const offset = reversed ? 3 : 9;
    expect((f[offset]+f[offset+1])*c).toBeCloseTo(0,9);
    expect((-f[offset]+f[offset+1])*c).toBeCloseTo(0.25,9);
    // Loading a released spin differs physically from omitting an unloaded coordinate.
    expect(loaded(model,[0,0,0,c,c,0]).result.components![0].status).toBe('mechanism');
  });
  it('keeps even an unloaded free translation physically unstable', () => {
    const model = cantilever(connectionDefinition('guided-x'));
    expect(loaded(model,[0,0,-0.1,0,0,0]).result.components![0].status).toBe('mechanism');
  });
  it('keeps an oblique connector frame orthogonal for a nearly vertical diagonal', () => {
    const model = cantilever(connectionDefinition('hinge-diagonal'));
    model.positions = {[tip]:[0.01,0.02,1]};
    const {result} = loaded(model,[0,0,-0.1,0,0,0]);
    expect(result.components![0].verification?.status).toBe('verified-linear');
  });
  it('resolves two distinct elastic fittings at a common joint with signed actions', () => {
    const model = cantilever(connectionDefinition('seat-20'));
    model.members.push({id:2,type:'shs',a:tip,b:'0,0,2',endA:'fixed',endB:'fixed',connectionA:connectionDefinition('seat-80')});
    model.attrs['0,0,2'] = {found:true};
    const {result,at,ctx} = loaded(model,[0,0,-10,0,0,0]);
    expect(result.components![0].verification?.status).toBe('verified-linear');
    const memberK = ITEMS.shs.E*ITEMS.shs.A/S;
    const k1 = 1/(1/20000+1/memberK), k2 = 1/(1/80000+1/memberK);
    expect(result.u![6*at(tip)+2]).toBeCloseTo(-10/(k1+k2),13);
    for (const [i, k] of [k1,k2].entries()) {
      const e = ctx.els[i], actions = result.ef!.get(e)!.f;
      expect(actions[6]).toBeCloseTo((i===0 ? -1 : 1)*10*k/(k1+k2),9);
      expect(result.reac![at(i===0 ? root : '0,0,2')][2]).toBeCloseTo(10*k/(k1+k2),9);
    }
  });
  it('withholds results for invalid stiffness or a malformed physical basis', () => {
    const invalid = connectionDefinition('seat-20');
    invalid.laws[2] = {kind:'elastic',stiffness:-1};
    expect(analyzeVoxel(cantilever(invalid),level).combos[0].components![0].status).toBe('unresolved');
    const left = {...connectionDefinition('fixed'),axes:[[1,0,0],[0,1,0],[0,0,-1]]} as FrameConnection;
    expect(analyzeVoxel(cantilever(left),level).combos[0].components![0].status).toBe('unresolved');
  });
  it('checks the buckling tangent inside elastic connectors even with every joint restrained', () => {
    const end = connectionDefinition('fixed');
    const springK = 200; // kN·m/rad, each end
    end.laws[4] = {kind:'elastic',stiffness:1000*springK};
    const model: VoxelModel = {members:[{id:1,type:'shs',a:root,b:'1,0,0',connectionA:end,connectionB:end}],
      attrs:{[root]:{found:true},'1,0,0':{found:true}},nextId:2};
    const ctx = analyzeVoxel(model,level).ctx!, e = ctx.els[0];
    const solved = solveCombo(ctx,new Float64Array(12));
    if ('fail' in solved) throw Error('Expected stable elastic state');
    // Two internal end rotations with zero end translation. The first
    // eigenvector [1,-1] has Ke = 2EI/L + k and -Kg/P = L/6.
    const critical = (2*ITEMS.shs.E*ITEMS.shs.Iy/e.L + springK)*6/e.L;
    for (const factor of [9,11]) {
      solved.ef.get(e)!.f[6] = -critical/factor;
      expect(alphaCr(ctx,solved)!).toBeCloseTo(factor,0);
      expect(alphaCr(ctx,solved,10) !== null).toBe(factor===11);
    }
  });
  it('withholds a reaction if the elastic connector is outside small-motion verification', () => {
    const end = connectionDefinition('seat-20');
    end.laws[2] = {kind:'elastic',stiffness:2000};
    const {result} = loaded(cantilever(end),[0,0,0.2,0,0,0]);
    expect(result.components![0].verification).toMatchObject({status:'unverified',reason:expect.stringContaining('Connector motion')});
  });
});
