import { describe, expect, it } from 'vitest';
import { LEGACY_CATALOGUE, PLANAR_CATALOGUE, SCORED_CATALOGUE, SPRING_CATALOGUE, TRUSS_CATALOGUE, printedCards } from './cardCatalogue';
import { findMaterialClash } from './materialClashes';
import { analyzeTurn, toTurnEvaluatorInput } from './turnAnalysis';
import { activeTurnHand, createTurnGame, endTurn, parseTurnState, stageConnection, stageElement, stageLoad, type TurnState } from './turns';
import { analyzeVoxel } from '../solver/voxel/analyze';
import { assessCardCapacity } from '../evaluator/capacity';
import { displacementAt } from '../evaluator/results';
import { springParts } from './springParts';
import { springGeometry } from '../viewer/springGeometry';

const applied = {type:'sandbox',q0:0,inv:null,budget:Infinity,loadCase:'applied',appliedSelfWeight:false} as const;
const spring = {id:3,type:'spring',owner:'player-1',a:'1,3,0',b:'1,3,4'} as const;
function sample(quarter: number, magnitude: number, both = true, guide = true) {
  const state = createTurnGame(1,SPRING_CATALOGUE);
  const port = quarter === 4 ? spring.b : 'port:3:'+quarter;
  const owner = 'player-1', profile = 'fixed';
  state.board = {
    members:[spring], joints:[{id:spring.a,foundationOwner:owner},{id:spring.b,...(both && {foundationOwner:'player-2'})}],
    connections:([{memberId:3,end:'a',jointId:spring.a,profile,owner},{memberId:3,end:'b',jointId:spring.b,profile,owner}]),
    loads:[{cardId:'applied',magnitude:Math.abs(magnitude),jointId:port,owner}],
  };
  if (quarter !== 4) state.board.joints.push({id:port,point:[1,3,quarter].join(',')});
  const model = toTurnEvaluatorInput(state);
  // Explicit laboratory lateral guide. The actual game fixture below instead
  // supplies this restraint with a second anchored frame and real cards.
  if (guide) model.attrs[port].restraint = [true,true,false,false,false,false];
  model.attrs[port].loadDirection = magnitude < 0 ? '-Z' : '+Z';
  const result = analyzeVoxel(model,applied), combo = result.combos[0], ctx = result.ctx!;
  const reaction = (key:string) => combo.reac?.[ctx.aid[ctx.idx.get(key)!]]?.[2];
  const u = displacementAt(combo,ctx.aid[ctx.idx.get(port)!])?.[2];
  const capacity = assessCardCapacity(model,result,state.board.connections);
  return {result,combo,ctx,model,reaction,u,capacity};
}
function accept(result: ReturnType<typeof endTurn>) {
  if (!result.ok) throw Error(result.reason);
  return result.state;
}
function place(state: TurnState, type: string, a: string, b: string) {
  const card = activeTurnHand(state).find(c => c.kind === 'element' && c.type === type);
  if (!card) throw Error('Missing '+type);
  state = accept(stageElement(state,card.id,a,b));
  const member = state.draft.members[0];
  for (const end of ['a','b'] as const) {
    const spent = new Set(state.draft.connections.map(c => c.cardId));
    const card = activeTurnHand(state).find(c => c.kind === 'connection' && c.profile === 'fixed' && !spent.has(c.id));
    if (!card) throw Error('Missing connector');
    state = accept(stageConnection(state,card.id,member.id,end));
  }
  return state;
}

describe('two-way axial spring and its original three collars', () => {
  for (const q of [1,2,3]) it('partitions collar '+q+' load between two end anchors', () => {
    for (const load of [-5,5]) {
      const r = sample(q,load), fraction = q/4;
      expect(r.combo.components?.[0].verification?.status).toBe('verified-linear');
      expect(r.u).toBeCloseTo(load*fraction*(1-fraction)/50,10);
      expect(r.reaction(spring.a)).toBeCloseTo(-load*(1-fraction),10);
      expect(r.reaction(spring.b)).toBeCloseTo(-load*fraction,10);
      const check = r.capacity.members[3];
      expect(check.status).toBe('verified');
      if (check.status === 'verified') expect(check.utilization).toBeCloseTo(Math.max(fraction,1-fraction),10);
      expect(r.model.members).toHaveLength(2);
    }
  });
  it('retains the entire signed end law and printed force limit; excessive stroke is unknown', () => {
    for (const load of [-5.5,5.5]) {
      const r = sample(4,load,false);
      expect(r.u).toBeCloseTo(load/50,10);
      expect(r.reaction(spring.a)).toBeCloseTo(-load,10);
      expect(r.capacity.members[3]).toMatchObject({status:'verified',utilization:1.1});
    }
    expect(sample(4,7,false).capacity.members[3].status).toBe('unavailable');
  });
  it('cannot support a free transverse coordinate or twist at a collar', () => {
    const r = sample(2,1,true,false);
    expect(r.result.mechanism).toBe(true);
    expect(r.capacity.members[3].status).toBe('unavailable');
    expect(r.ctx.els.every(e => e.k[1*12+1]===0 && e.k[3*12+3]===0 && e.k[5*12+5]===0)).toBe(true);
  });
  it('retains the other catalogue deals and one spring printing for each reach', () => {
    const reaches = new Set<number>();
    for (let i=0; i<32; i++) {
      const card = printedCards(i,SPRING_CATALOGUE).element;
      if (card.kind === 'element' && card.type === 'spring') reaches.add(card.maxSteps);
      for (const prior of [LEGACY_CATALOGUE,SCORED_CATALOGUE,PLANAR_CATALOGUE,TRUSS_CATALOGUE])
        expect(printedCards(i,prior).element).not.toHaveProperty('type','spring');
    }
    expect([...reaches].sort()).toEqual([1,2,3,4]);
  });
  it('checks the individual coil and collars while leaving the interior open between them', () => {
    const wire = springParts(spring);
    expect(wire.filter(p => p.collar)).toHaveLength(5);
    expect(wire.filter(p => !p.collar)).toHaveLength(128);
    const inside = {id:4,type:'cable',a:'1,3,0.2',b:'1,3,0.4'} as const;
    expect(findMaterialClash(inside,[spring])).toBeNull();
    const branch = {id:4,type:'shs',a:'1,3,2',b:'1,4,2'} as const;
    expect(findMaterialClash(branch,[spring])).toContain('member 3');
    expect(findMaterialClash({...branch,endTargets:{a:'port:3:2'}},[spring])).toBeNull();
    const geometry = springGeometry(spring);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox?.min.z).toBeCloseTo(0,6);
    expect(geometry.boundingBox?.max.z).toBeCloseTo(8,6);
    geometry.dispose();
  });
  it('transfers persistent card gravity through a collared spring in a seeded match and replays it', () => {
    let s = createTurnGame(1,SPRING_CATALOGUE);
    s=accept(endTurn(s)); s=accept(endTurn(s));
    s=accept(endTurn(place(s,'heb','1,3,1','3,1,1')));
    s=accept(endTurn(place(s,'spring','3,1,1','5,3,1')));
    s=place(s,'heb','5,3,0','port:4:2');
    const load = activeTurnHand(s).find(c=>c.kind==='load' && c.magnitude===5)!;
    s=accept(stageLoad(s,load.id,'port:4:2'));
    s=accept(endTurn(s));
    const r=analyzeTurn(s,'card-gravity');
    const check = r.capacity!.members[4];
    expect(check.status,JSON.stringify(check)).toBe('verified');
    if (check.status === 'verified') expect(check.actions.N).toBeCloseTo(0.043750059,8);
    expect(s.board.members).toHaveLength(5);
    expect(s.board.connections.filter(c=>c.memberId===4)).toHaveLength(2);
    expect(parseTurnState(s)).toEqual(s);
  });
});
