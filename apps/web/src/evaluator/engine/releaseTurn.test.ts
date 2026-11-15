import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import type { VoxelModel } from '../model';
import { createTurnSolver } from './releaseTurn';
import { computeLoadPath } from '../loadPath';
import { connectionDefinition } from '../../game/jointFreedom';

const solver = createTurnSolver(async () => {
  const bytes = await readFile(new URL('../../solver/wasm/dof_solver.wasm', import.meta.url));
  return Uint8Array.from(bytes).buffer;
});
beforeAll(solver.prepare);

describe('scored turn Rust/WASM projection', () => {
  for (const k of [12500, 25000]) for (const quarter of [1, 2, 3]) {
    it(`preserves the ${k} N/m cartridge in series at quarter ${quarter}`, () => {
      // Constrain only transverse motion at the loaded collar. All axial
      // reactions follow from the two series fractions on the original span.
      const model: VoxelModel = { nextId: 4, attrs: {base:{found:true}, head:{found:true},
        collar:{found:true, restraint:[true,true,false,false,false,false], load:1}},
        positions: {base:[0,0,0], head:[0,0,4], collar:[0,0,quarter]},
        members: [
          {id:2, a:'base', b:'collar', type:'spring', springStiffnessNPerM:k, parentSpan:{memberId:1,fromQuarter:0,toQuarter:quarter}},
          {id:3, a:'collar', b:'head', type:'spring', springStiffnessNPerM:k, parentSpan:{memberId:1,fromQuarter:quarter,toQuarter:4}},
        ] };
      const result = solver.analyze(model, 'series');
      const combo = result.combos[0], ctx = result.ctx!;
      expect(combo.components![0].verification?.status).toBe('verified-nonlinear');
      const index = (id:string) => ctx.aid[ctx.idx.get(id)!];
      const fraction = quarter/4;
      expect(combo.reac![index('base')][2]).toBeCloseTo(1-fraction, 6);
      expect(combo.reac![index('head')][2]).toBeCloseTo(fraction, 6);
      expect(combo.partialDisplacements!.get(index('collar'))![2]).toBeCloseTo(-1000*fraction*(1-fraction)/k, 9);
    });
  }
  it('withholds overstroke reactions in that component while preserving the independent frame', () => {
    const model: VoxelModel = { nextId: 3, attrs:{a:{found:true}, b:{found:true, restraint:[true,true,false,false,false,false], load:5},
      c:{found:true}, d:{load:5}}, positions:{a:[0,0,0], b:[0,0,1], c:[1,0,0], d:[1,0,1]},
      members:[{id:1, a:'a', b:'b', type:'spring', springStiffnessNPerM:12500}, {id:2,a:'c',b:'d',type:'heb',endA:'fixed',endB:'fixed'}] };
    const result = solver.analyze(model, 'overstroke');
    const ctx = result.ctx!, combo = result.combos[0];
    const a = ctx.aid[ctx.idx.get('a')!], c = ctx.aid[ctx.idx.get('c')!];
    expect(combo.components!.find(s => s.memberIds.includes(1))?.verification?.reason).toContain('stroke');
    expect(combo.reac![a]).toBeUndefined();
    expect(combo.reac![c][2]).toBeCloseTo(5, 6);
  });
  it('keeps seed 14 spring sag separate from its axial stroke and strength', () => {
    // 10 m horizontal half-reference cartridge, pinned axial material at
    // both foundation columns. A central 5 kN load causes large sag with
    // less than 10% extension. Both supports must carry exactly half.
    const span: VoxelModel = { nextId:4,
      positions:{a:[5,7,1], b:[10,7,1], mid:[7.5,7,1], l:[5,7,0], r:[10,7,0]},
      attrs:{l:{found:true},r:{found:true},mid:{load:5}},
      members:[{id:1,type:'heb',a:'l',b:'a',endA:'fixed',endB:'fixed'},
        {id:2,type:'heb',a:'r',b:'b',endA:'fixed',endB:'fixed'},
        {id:-12,type:'spring',a:'a',b:'mid',springStiffnessNPerM:25000,parentSpan:{memberId:3,fromQuarter:0,toQuarter:2}},
        {id:-14,type:'spring',a:'mid',b:'b',springStiffnessNPerM:25000,parentSpan:{memberId:3,fromQuarter:2,toQuarter:4}}]};
    const result = solver.analyze(span, 'seed-14');
    const combo = result.combos[0];
    expect(combo.components![0]).toMatchObject({status:'computed',excessiveDeformation:true});
    const l = result.ctx!.aid[result.ctx!.idx.get('l')!], r = result.ctx!.aid[result.ctx!.idx.get('r')!];
    expect(combo.reac![l][2]).toBeCloseTo(2.5,6);
    expect(combo.reac![r][2]).toBeCloseTo(2.5,6);
    const spring = result.ctx!.els.find(e => e.m.id === -12)!;
    expect(combo.ef!.get(spring)!.f[6]).toBeGreaterThan(5);
  });
  it('isolates an unloaded free member and retains its physical identity', () => {
    const model: VoxelModel = {nextId:3, attrs:{base:{found:true},tip:{load:10}},
      positions:{base:[0,0,0],tip:[0,0,1],other:[0,0,1],loose:[1,0,1]},
      members:[{id:1,a:'base',b:'tip',type:'heb',endA:'fixed',endB:'fixed'}, {id:2,a:'other',b:'loose',type:'heb'}]};
    const result = solver.analyze(model, 'independent');
    expect(result.combos[0].components).toEqual(expect.arrayContaining([
      expect.objectContaining({memberIds:[1],status:'computed'}),expect.objectContaining({memberIds:[2],status:'unsupported'})]));
  });
  it('uses vertical shear for gravity transfer and includes actual fitting slip at a beam end', () => {
    const input: VoxelModel = {nextId:3, attrs:{base:{found:true},tip:{load:5}},
      positions:{base:[0,0,0],tip:[2,0,0]}, members:[{id:1,a:'base',b:'tip',type:'heb',endA:'fixed',
        endB:'fixed',connectionA:connectionDefinition('seat-20')}]};
    const result = solver.analyze(input, 'seat'), e = result.ctx!.els[0];
    const response = result.combos[0].ef!.get(e)!;
    expect(response.motionSamples).toHaveLength(3);
    expect(response.motionSamples![0].motion[2]).toBeCloseTo(-5000/20e6, 9);
    expect(response.verticalTransferKN).toBeCloseTo(-5,6);
    const path = computeLoadPath(result,0);
    expect(path?.members.get(1)).toMatchObject({direction:-1,mode:'bending'});
    expect(path?.shares[0].fraction).toBeCloseTo(1,8);
    const reversed = solver.analyze({...input,members:[{...e.m,a:'tip',b:'base',connectionB:e.m.connectionA,connectionA:undefined}]},'reversed');
    expect(computeLoadPath(reversed,0)?.members.get(1)?.direction).toBe(1);
  });
});
