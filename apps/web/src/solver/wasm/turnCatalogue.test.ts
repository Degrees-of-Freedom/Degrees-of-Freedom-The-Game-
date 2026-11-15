import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { PLANAR, TRICHORD } from '../../game/assembly';
import { HOLLOW_CATALOGUE, PLANAR_CATALOGUE, RELEASE_CATALOGUE, SCORED_CATALOGUE, TRUSS_CATALOGUE, type CatalogueId } from '../../game/cardCatalogue';
import type { Member } from '../../game/model';
import { toTurnEvaluatorInput } from '../../game/turnAnalysis';
import { findPort } from '../../game/turnPorts';
import { createTurnGame } from '../../game/turns';
import { displacementAt } from '../../evaluator/results';
import { ITEMS } from '../../evaluator/sections';
import { createTurnSolver } from '../../evaluator/engine/releaseTurn';

const solver = createTurnSolver(async () => Uint8Array.from(await readFile(new URL('./dof_solver.wasm', import.meta.url))).buffer);
beforeAll(solver.prepare);

/** The actual preset determines the physical card and port graph. Evaluate
 * that graph with the release reference adapter, independently of which
 * numerical implementation the archived preset used when it was saved. */
function cantilever(catalogue: CatalogueId, type: Member['type'], quarter: number, assembly?: Member['assembly']) {
  const state = createTurnGame(1, catalogue);
  const parent = { id: 3, type, assembly, owner: 'player-1' as const, a: '1,3,0', b: '3,3,0' };
  const port = 'port:3:' + quarter;
  const point = findPort([parent], port)!.point.join(',');
  state.board = {
    members: [parent], joints: [{id: parent.a, foundationOwner:'player-1'}, {id:port, point}],
    connections: [{memberId:3, end:'a', jointId:parent.a, profile:'fixed', owner:'player-1'}],
    loads: [{cardId:'test-load', jointId:port, magnitude:1, owner:'player-1'}],
  };
  const model = toTurnEvaluatorInput(state);
  const result = solver.analyze(model, catalogue), combo = result.combos[0], ctx = result.ctx!;
  expect(combo.components?.[0].verification?.status).toBe('verified-nonlinear');
  expect(model.members.every(m => m.parentSpan?.memberId === parent.id)).toBe(true);
  const at = (id:string) => ctx.aid[ctx.idx.get(id)!];
  const reaction = combo.reac![at(parent.a)];
  const motion = displacementAt(combo, at(port))!;
  expect(reaction[2]).toBeCloseTo(1,7);
  // Moment equilibrium about the base uses the actual deformed load location.
  expect(reaction[4]).toBeCloseTo(-(quarter + motion[0]),6);
  return {model, motion};
}

function matchesResponse(actual:number, expected:number) {
  expect(Math.abs((actual-expected)/expected)).toBeLessThan(.01);
}

describe('expanded match cards with the release WASM reference', () => {
  // docs/evidence/cable/reference.py, cable(q/4, pretension=0), kN and m.
  it.each([
    [1, 51.2459493416, 3.7522252033, -.1461791880],
    [2, 56.4344928560, 2.5, -.1771965954],
    [3, 51.2459493416, 1.2477747967, -.1461791880],
  ])('carries a 5 kN clamp at original cable quarter %i with zero prestrain', (q, h, v, sag) => {
    const state = createTurnGame(1, RELEASE_CATALOGUE);
    const a = '1,3,0', b = '5,3,0', port = 'port:3:' + q;
    state.board = {members:[{id:3,a,b,type:'cable',owner:'player-1',restLengthM:8}],
      joints:[{id:a,foundationOwner:'player-1'},{id:b,foundationOwner:'player-2'},{id:port,point:[1+q,3,0].join(',')}],
      connections:[{memberId:3,end:'a',jointId:a,owner:'player-1',profile:'fixed'},
        {memberId:3,end:'b',jointId:b,owner:'player-1',profile:'fixed'}],
      loads:[{owner:'player-1',cardId:'test-load',magnitude:5,jointId:port}]};
    const model = toTurnEvaluatorInput(state);
    expect(model.members.map(m=>m.restLengthM)).toEqual([2*q,2*(4-q)]);
    const result = solver.analyze(model, RELEASE_CATALOGUE), ctx=result.ctx!, combo=result.combos[0];
    expect(combo.components?.[0].verification?.status).toBe('verified-nonlinear');
    const at = (id:string) => ctx.aid[ctx.idx.get(id)!];
    expect(combo.reac![at(a)][0]).toBeCloseTo(-h,6);
    expect(combo.reac![at(a)][2]).toBeCloseTo(v,6);
    expect(combo.reac![at(b)][2]).toBeCloseTo(5-v,6);
    expect(displacementAt(combo,at(port))![2]).toBeCloseTo(sag,7);
  });
  for (const type of ['heb', 'ipe', 'shs', 'chs', 'glulam'] as const) {
    it.each([1,2,3])(`${type} transfers an original quarter %i load through continuous material`, q => {
      const {model,motion} = cantilever(type === 'chs' ? HOLLOW_CATALOGUE : SCORED_CATALOGUE, type, q);
      expect(model.members).toHaveLength(2);
      const section = ITEMS[type];
      // Unit load in kN. Deflection includes bending and the card shear area.
      matchesResponse(motion[2], -(q**3/(3*section.E*section.Iy) + q/(section.G*section.Avz)));
    });
  }

  // Independently assembled OpenSeesPy frames. Run docs/evidence/{planar,trichord}/reference.py --shear.
  const planarZ = [-.0002869154525145743,-.001279849093180407,-.003011855889116991];
  const spatialZ = [-.0002925582042088346,-.0013091564122103155,-.0030744152291740574];
  const spatialTwist = [1.851990268508033e-5,5.293447152361397e-5,8.4447174176929e-5];
  it.each([1,2,3])('carries a quarter %i load through the planar assembly', q => {
    const {model,motion} = cantilever(PLANAR_CATALOGUE, 'shs', q, PLANAR.id);
    expect(model.members).toHaveLength(19);
    matchesResponse(motion[2], planarZ[q-1]);
  });
  it.each([1,2,3])('carries a quarter %i load and twist through the tri-chord assembly', q => {
    const {model,motion} = cantilever(TRUSS_CATALOGUE, 'shs', q, TRICHORD.id);
    expect(model.members).toHaveLength(41);
    matchesResponse(motion[2], spatialZ[q-1]);
    matchesResponse(motion[3], spatialTwist[q-1]);
  });
});
