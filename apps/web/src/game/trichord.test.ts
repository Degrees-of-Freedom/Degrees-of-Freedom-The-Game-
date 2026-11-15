import { describe, expect, it } from 'vitest';
import { assemblyParts, TRICHORD } from './assembly';
import { PLANAR_CATALOGUE, printedCards, SCORED_CATALOGUE, TRUSS_CATALOGUE } from './cardCatalogue';
import { findMaterialClash } from './materialClashes';
import { CELL_SIZE, type Member } from './model';
import { analyzeTurn, toTurnVoxelInput } from './turnAnalysis';
import { createTurnGame } from './turns';
import { analyzeVoxel } from '../solver/voxel/analyze';
import { displacementAt } from '../evaluator/results';
import { ITEMS } from '../evaluator/sections';

const parent = {id: 3, assembly: TRICHORD.id, type: 'shs', owner: 'player-1', a: '1,3,0', b: '3,3,0'} as const;
function fixture(quarter: number, magnitude = 1, rotated = false) {
  const state = createTurnGame(1, TRUSS_CATALOGUE);
  // Both placements have a 4 m span. The second is translated and rotated 90° about Z.
  const member = rotated ? {...parent, a: '4,2,0', b: '4,4,0'} : parent;
  const jointId = 'port:3:' + quarter;
  const point = rotated ? [4, 2+quarter/2, 0] : [1+quarter/2, 3, 0];
  state.board = {
    members: [member], joints: [{id: member.a, foundationOwner: 'player-1'}, {id: jointId, point: point.join(',')}],
    connections: [{memberId: 3, end: 'a', jointId: member.a, profile: 'fixed', owner: 'player-1'}],
    loads: [{cardId: 'test-load', jointId, magnitude, owner: 'player-1'}],
  };
  return state;
}
const applied = {type: 'sandbox', q0: 0, budget: Infinity, inv: null, loadCase: 'applied', appliedSelfWeight: false} as const;

describe('triangular four-panel assembly', () => {
  it('forms closed triangular rings at every station with one diagonal per face and panel', () => {
    const pieces = assemblyParts(parent);
    expect(pieces).toHaveLength(41);
    expect(new Set(pieces.map(p => p.id)).size).toBe(41);
    const expanded = toTurnVoxelInput(fixture(2)).members;
    expect(expanded.map(m => m.id)).toEqual(pieces.map(p => p.id));
    expect(expanded.every(m => m.parentSpan?.memberId === parent.id)).toBe(true);
    expect(expanded.map(m => m.parentSpan?.assemblyPart)).toEqual(pieces.map(p => p.name));
    expect(pieces.filter(p => p.pinned)).toHaveLength(12);
    expect(pieces.filter(p => p.chord)).toHaveLength(12);
    for (let i = 0; i < 5; i++) {
      const ring = pieces.filter(p => p.name.startsWith('ring-') && p.name.endsWith('-' + i));
      expect(ring).toHaveLength(3);
      expect(new Set(ring.flatMap(p => [p.a.id, p.b.id])).size).toBe(3);
      for (const p of ring) expect(CELL_SIZE*Math.hypot(...p.b.point.map((v,k) => v-p.a.point[k]))).toBeCloseTo(0.5, 12);
    }
    for (let q = 1; q <= 3; q++) {
      const nodes = pieces.flatMap(p => [p.a,p.b]).filter(n => n.id === 'port:3:' + q);
      expect(nodes.length).toBeGreaterThan(2);
      expect(nodes.every(n => n.point.join(',') === [1+q/2,3,0].join(','))).toBe(true);
    }
  });

  // SI OpenSeesPy reference: 4 m fixed cantilever, 1 kN on the first chord.
  // The eccentric physical chord induces measurable twist about the span axis.
  const reference = {
    '-Y': [[-.0002575607740161968,-.00001078632446026636],[-.001148883210634668,-.000029488850039863483],[-.0027059417539844637,-.00005016587474518445]],
    '-Z': [[-.0002813920031354929,.000018798879824129532],[-.0012617929706866021,.00005345031031050157],[-.0029638515166483365,.00008456457546208085]],
  };
  for (const q of [1,2,3]) it('transfers force and twist through the ' + q*25 + '% original joint', () => {
    const state = fixture(q), port = 'port:3:' + q;
    const model = toTurnVoxelInput(state);
    for (const direction of ['-Y','-Z'] as const) {
      model.attrs[port].loadDirection = direction;
      const result = analyzeVoxel(model, applied);
      const combo = result.combos[0], ctx = result.ctx!;
      expect(combo.components?.[0].verification?.status).toBe('verified-linear');
      const axis = direction === '-Y' ? 1 : 2;
      const displacements = displacementAt(combo,ctx.aid[ctx.idx.get(port)!])!;
      const support = combo.reac![ctx.aid[ctx.idx.get(parent.a)!]];
      expect(displacements[axis]).toBeCloseTo(reference[direction][q-1][0],9);
      expect(displacements[3]).toBeCloseTo(reference[direction][q-1][1],9);
      expect(support[axis]).toBeCloseTo(1,8);
      expect(support[direction === '-Y' ? 5 : 4]).toBeCloseTo(direction === '-Y' ? q : -q,8);
    }
    const capacity = analyzeTurn(state,'card-gravity').capacity!;
    expect(capacity.members[3]).toMatchObject({status:'verified'});
    expect(capacity.connections['3:a'].status).toBe('verified');
    expect(capacity.connections['3:b']).toBeUndefined();
  });

  it('resists a pure torque as independently predicted, and transforms signed results under rigid rotation', () => {
    for (const rotated of [false, true]) {
      const state = fixture(2,1,rotated), model = toTurnVoxelInput(state);
      model.attrs['assembly:3:second-2'] = {load: 1, loadDirection: '+Z'};
      model.members.reverse();
      const result = analyzeVoxel(model,applied), ctx = result.ctx!, combo = result.combos[0];
      const response = displacementAt(combo,ctx.aid[ctx.idx.get('port:3:2')!])!;
      const support = combo.reac![ctx.aid[ctx.idx.get(state.board.members[0].a)!]];
      expect(combo.components?.[0].verification?.status).toBe('verified-linear');
      expect(response[2]).toBeCloseTo(-.000027415036449112884,9);
      expect(response[rotated ? 4 : 3]).toBeCloseTo(.00035855938653777314,9);
      expect(support[rotated ? 4 : 3]).toBeCloseTo(-.5,8);
      expect(support[2]).toBeCloseTo(0,8);
    }
  });

  it('counts each physical piece once and withholds unverified capacity beyond the linear envelope', () => {
    const physicalWeight = assemblyParts(parent).reduce((sum, p) =>
      sum + CELL_SIZE * Math.hypot(...p.b.point.map((v,k) => v-p.a.point[k])) * ITEMS.shs.w, 0);
    const preview = analyzeTurn(fixture(2)), ctx = preview.ctx!;
    expect(preview.combos[0].reac![ctx.aid[ctx.idx.get(parent.a)!]][2]).toBeCloseTo(1 + physicalWeight,8);
    expect(analyzeTurn(fixture(3,500),'card-gravity').capacity!.members[3].status).toBe('unavailable');
  });

  it('detects interference with the second chord and permits a deliberate fitting only on the exposed first chord', () => {
    const incoming: Member = {id: 4, a:'2,3.25,-1', b:'2,3.25,1', type:'shs'};
    expect(findMaterialClash(incoming,[parent])).toMatch(/member 3/i);
    // The volume inside the triangular prism is open; this short axial
    // piece fits inside the central opening without touching any steel.
    expect(findMaterialClash({...incoming,a:'1.6,3.125,0.07',b:'1.8,3.125,0.07'},[parent])).toBeNull();
    const branch = {...incoming, a: '2,3,0', b:'2,2,0'};
    expect(findMaterialClash(branch,[parent])).toMatch(/member 3/i);
    expect(findMaterialClash({...branch,endTargets:{a:'port:3:2'}},[parent])).toBeNull();
  });

  it('deals the new printing only from the new catalogue and covers all four reach variants', () => {
    const reaches = new Set<number>();
    for (let i = 0; i < 32; i++) {
      const {element} = printedCards(i,TRUSS_CATALOGUE);
      if (element.kind === 'element' && element.assembly === TRICHORD.id) reaches.add(element.maxSteps);
      for (const existing of [SCORED_CATALOGUE, PLANAR_CATALOGUE])
        expect(printedCards(i, existing).element).not.toHaveProperty('assembly', TRICHORD.id);
    }
    expect([...reaches].sort()).toEqual([1,2,3,4]);
  });
});
