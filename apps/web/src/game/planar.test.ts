import { describe, it, expect } from 'vitest';
import { PLANAR, assemblyParts } from './assembly';
import { PLANAR_CATALOGUE, SCORED_CATALOGUE, printedCards } from './cardCatalogue';
import { createTurnGame, endTurn, parseTurnState, stageConnection, stageElement, type TurnState } from './turns';
import { analyzeTurn, toTurnEvaluatorInput } from './turnAnalysis';
import { analyzeVoxel } from '../solver/voxel/analyze';
import { findMaterialClash } from './materialClashes';
import { findPort } from './turnPorts';
import { displacementAt } from '../evaluator/results';
import { ITEMS } from '../evaluator/sections';

const parent = { id: 3, type: 'shs', assembly: PLANAR.id, a: '1,3,0', b: '3,3,0', owner: 'player-1' } as const;
function fixture(quarter: number, load = 1) {
  const state = createTurnGame(1, PLANAR_CATALOGUE);
  const jointId = 'port:3:' + quarter;
  const point = findPort([parent], jointId)!.point.join(',');
  state.board = { members: [parent], joints: [{id: parent.a, foundationOwner:'player-1'}, {id: jointId, point}],
    connections: [{memberId:3, end:'a', jointId:parent.a, profile:'fixed', owner:'player-1'}],
    loads: [{cardId:'load-fixture', jointId, magnitude:load, owner:'player-1'}] };
  return state;
}
function accepted(result: ReturnType<typeof endTurn>): TurnState {
  if (!result.ok) throw Error(result.reason);
  return result.state;
}

describe('four-panel welded planar card', () => {
  // Independent OpenSeesPy 3D beam/truss reference, SI, 4 m cantilever and
  // point force of 1 kN. docs/evidence/planar/reference.py regenerates these.
  const vertical = [-0.0002745970391463344,-0.0012262180369462241,-0.002886578228728297];
  const lateral = [-0.00041952944883955534,-0.002831372753601817,-0.008708472776477285];
  for (const q of [1,2,3]) it('transfers the physical ' + q*25 + '% load, including transverse response', () => {
    const state = fixture(q);
    const model = toTurnEvaluatorInput(state);
    expect(model.members).toHaveLength(19);
    expect(new Set(model.members.map(m => m.id)).size).toBe(19);
    const port = 'port:3:' + q;
    expect(model.members.filter(m => m.a === port || m.b === port).length).toBeGreaterThanOrEqual(3);
    for (const direction of ['-Y','-Z'] as const) {
      model.attrs[port].loadDirection = direction;
      const result = analyzeVoxel(model,{type:'sandbox',q0:0,budget:Infinity,inv:null,loadCase:'applied',appliedSelfWeight:false});
      const combo = result.combos[0], ctx = result.ctx!;
      expect(combo.components?.[0].verification?.status).toBe('verified-linear');
      const axis = direction === '-Z' ? 2 : 1;
      const disp = displacementAt(combo,ctx.aid[ctx.idx.get(port)!])!;
      expect(disp[axis]).toBeCloseTo((axis === 2 ? vertical : lateral)[q-1], 9);
      const r = combo.reac![ctx.aid[ctx.idx.get(parent.a)!]];
      expect(r[axis]).toBeCloseTo(1, 8);
      expect(r[axis === 2 ? 4 : 5]).toBeCloseTo((axis === 2 ? -1 : 1)*q, 8);
    }
    const analysis = analyzeTurn(state,'card-gravity');
    expect(analysis.capacity!.members[3].status).toBe('verified');
    expect(analysis.capacity!.connections['3:a'].status).toBe('verified');
    expect(analysis.capacity!.connections['3:b']).toBeUndefined();
    // Sum the full weight of the nineteen actual pieces exactly once.
    const ordinary = analyzeTurn(state), ctx = ordinary.ctx!;
    const weight = assemblyParts(parent).reduce((total, p) => total +
      2*Math.hypot(...p.a.point.map((v,i) => v-p.b.point[i]))*ITEMS.shs.w, 0);
    expect(ordinary.combos[0].reac![ctx.aid[ctx.idx.get(parent.a)!]][2]).toBeCloseTo(1+weight, 8);
  });
  // The legacy linear kernel withheld this capacity as outside its small-motion
  // envelope. The nonlinear Rust equilibrium is verified even when it deforms
  // excessively (the release's policy), so the overload is reported instead.
  it('reports a grossly overloaded, excessively deformed assembly as overloaded', () => {
    const result = analyzeTurn(fixture(3, 500), 'card-gravity');
    const scope = result.combos[0].components![0];
    expect(scope.excessiveDeformation).toBe(true);
    expect(scope.reason).toContain('strengthExceeded');
    const check = result.capacity!.members[3];
    expect(check.status).toBe('verified');
    if (check.status === 'verified') expect(check.utilization).toBeGreaterThan(10);
  });
  it('checks the upper chord and opening, allows only original physical external joints', () => {
    const incoming = {id:4,type:'shs' as const,a:'2,2,0.25',b:'2,4,0.25'};
    expect(findMaterialClash(incoming,[parent])).toMatch(/member 3/i);
    expect(findMaterialClash({...incoming,a:'1.65,2,0.09',b:'1.65,4,0.09'},[parent])).toBeNull();
    expect(findMaterialClash({...incoming,a:'2,3,0',b:'2,2,0',endTargets:{a:'port:3:2'}},[parent])).toBeNull();
    expect(findMaterialClash({...incoming,a:'2,3,0',b:'2,2,0'},[parent])).toMatch(/member 3/i);
  });
  it('deals and replays one parent with separate external connectors', () => {
    let state;
    for (let seed = 0; seed < 300; seed++) {
      const trial = createTurnGame(seed, PLANAR_CATALOGUE);
      if (trial.players[0].hand.some(c => c.kind === 'element' && c.assembly) &&
          trial.players[0].hand.some(c => c.kind === 'connection' && c.profile === 'fixed')) {state = trial;break;}
    }
    if (!state) throw Error('Expected a playable seed');
    const card = state.players[0].hand.find(c=>c.kind === 'element' && c.assembly)!;
    const connector = state.players[0].hand.find(c=>c.kind === 'connection' && c.profile === 'fixed')!;
    state = accepted(stageElement(state,card.id,'1,3,1','2,3,1'));
    expect(state.draft.members).toHaveLength(1);
    expect(state.draft.connections).toHaveLength(0);
    state = accepted(stageConnection(state,connector.id,3,'a'));
    state = accepted(endTurn(state));
    expect(state.board.members.find(m=>m.id===3)?.assembly).toBe(PLANAR.id);
    expect(state.board.connections.filter(c=>c.memberId===3)).toHaveLength(1);
    expect(parseTurnState(state)).toEqual(state);
    for (let i=0;i<32;i++) expect(printedCards(i,SCORED_CATALOGUE).element).not.toHaveProperty('assembly');
  });
});
