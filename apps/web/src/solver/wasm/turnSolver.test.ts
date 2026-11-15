import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import type { VoxelModel } from '../voxelInput';
import { createTurnSolver } from './turnSolver';

const solver = createTurnSolver(async () => {
  const bytes = await readFile(new URL('./dof_solver.wasm', import.meta.url));
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
  it('isolates an unloaded free member and retains its physical identity', () => {
    const model: VoxelModel = {nextId:3, attrs:{base:{found:true},tip:{load:10}},
      positions:{base:[0,0,0],tip:[0,0,1],other:[0,0,1],loose:[1,0,1]},
      members:[{id:1,a:'base',b:'tip',type:'heb',endA:'fixed',endB:'fixed'}, {id:2,a:'other',b:'loose',type:'heb'}]};
    const result = solver.analyze(model, 'independent');
    expect(result.combos[0].components).toEqual(expect.arrayContaining([
      expect.objectContaining({memberIds:[1],status:'computed'}),expect.objectContaining({memberIds:[2],status:'unsupported'})]));
  });
});
