import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { CABLE_CATALOGUE } from './cardCatalogue';
import { analyzeTurn, toTurnVoxelInput } from './turnAnalysis';
import { createTurnGame, activeTurnHand, endTurn, stageConnection, stageElement, stageLoad, parseTurnState, type TurnState } from './turns';
import { analyzeVoxel } from '../solver/voxel/analyze';
import { cableState } from '../solver/voxel/cableEquilibrium';
import { cableGeometry } from '../viewer/cableGeometry';
import { displacementAt } from '../evaluator/results';
import { awardFinalScore, finalReceipt } from './finalScore';

const loadCase = {type:'sandbox',q0:0,inv:null,budget:Infinity,loadCase:'applied',appliedSelfWeight:false} as const;
function parentFixture(q: number) {
  const turn=createTurnGame(1,CABLE_CATALOGUE), left='1,3,0', right='5,3,0', port='port:3:'+q;
  const cable={id:3,a:left,b:right,type:'cable' as const,owner:'player-1',restLengthM:8/(1+25/57600)};
  turn.board={
    members:[cable],
    joints:[{id:left,foundationOwner:'player-1'}, {id:right,foundationOwner:'player-2'},
      {id:port,point:[1+q,3,0].join(',')}],
    connections:[{memberId:3,end:'a',jointId:left,owner:'player-1',profile:'fixed'},
      {memberId:3,end:'b',jointId:right,owner:'player-2',profile:'fixed'}],
    loads:[{owner:'player-1',cardId:'fixture-gravity',magnitude:5,jointId:port}],
  };
  return {turn,port,left,right};
}
function accept(r:ReturnType<typeof endTurn>) {
  if(!r.ok) throw Error(r.reason);
  return r.state;
}
function place(s:TurnState,type:string,a:string,b:string) {
  const member=activeTurnHand(s).find(c=>c.kind==='element'&&c.type===type)!;
  s=accept(stageElement(s,member.id,a,b));
  for (const end of ['a','b'] as const) {
    const card=activeTurnHand(s).find(c=>c.kind==='connection'&&c.profile==='fixed'&&!s.draft.connections.some(used=>used.cardId===c.id))!;
    s=accept(stageConnection(s,card.id,s.draft.members[0].id,end));
  }
  return s;
}

describe('tension-only cable printing',()=>{
  // Independent force-method reference, docs/evidence/cable/reference.py.
  for(const [q,h,v,x,z,tension] of [
    [1,61.0920115883,3.7515663027,1.9974939156,-.1226630237,61.2070921514],
    [2,66.1237310647,2.5,4,-.1512316356,66.1709740741],
    [3,61.0920115883,1.2484336973,6.0025060844,-.1226630237,61.2070921514],
  ]) it('transfers 5 kN at original quarter '+q+' with two unsymmetrically strained material legs',()=>{
    const {turn,port,left}=parentFixture(q);
    const model=toTurnVoxelInput(turn);
    expect(model.members.map(m=>m.restLengthM)).toEqual([q/4,(4-q)/4].map(f=>turn.board.members[0].restLengthM!*f));
    const result=analyzeTurn(turn,'card-gravity'), ctx=result.ctx!, combo=result.combos[0];
    expect(combo.components![0].verification?.status, JSON.stringify(combo.components)).toBe('verified-cable');
    const u=displacementAt(combo,ctx.aid[ctx.idx.get(port)!])!;
    expect(u[0]+2*q).toBeCloseTo(x,8); expect(u[2]).toBeCloseTo(z,8);
    const reactions=combo.reac![ctx.aid[ctx.idx.get(left)!]];
    expect(reactions[0]).toBeCloseTo(-h,7); expect(reactions[2]).toBeCloseTo(v,8);
    const check=result.capacity!.members[3];
    expect(check.status).toBe('verified');
    if(check.status==='verified') expect(check.utilization).toBeCloseTo(tension/260,8);
    const score=awardFinalScore(turn,finalReceipt(turn,result));
    expect(score.awards[0].awardedShare).toBeCloseTo(100*v/5,7);
    expect(score.unknownGravityKN).toBe(0);
  });

  it.each([[40, 234.9400210068], [50, 271.2746506218]])(
    'compares the recovered midspan cable tension to its printed 260 kN strength under %i kN',
    (gravityKN, tensionKN) => {
      const { turn } = parentFixture(2);
      turn.board.loads[0].magnitude = gravityKN;
      const result = analyzeTurn(turn, 'card-gravity');
      const capacity = result.capacity!.members[3];
      expect(capacity.status).toBe('verified');
      if (capacity.status !== 'verified') throw Error(capacity.reason);
      expect(capacity.actions.N).toBeCloseTo(tensionKN, 7);
      expect(capacity.utilization).toBeCloseTo(tensionKN / 260, 8);
      expect(capacity.utilization > 1.001).toBe(gravityKN === 50);
      expect(result.mechanism).toBe(false);
    },
  );

  it('carries no compression or bending when slack and provides transverse stiffness only in tension',()=>{
    const loose=cableState([1.9,0,0],2,57600);
    expect(loose.force).toBe(0); expect([...loose.tangent]).toEqual(Array(9).fill(0));
    const taut=cableState([2.01,0,0],2,57600);
    expect(taut.tangent[4]).toBeCloseTo(taut.force/2.01,10);
    const {turn}=parentFixture(2);
    turn.board.members[0].restLengthM=8.1;
    const result=analyzeVoxel(toTurnVoxelInput(turn),loadCase);
    expect(result.combos[0].components![0].status).toBe('unresolved');
    expect(result.combos[0].reac).toBeUndefined();
  });

  it('keeps reference chord ends and physical diameter independent of readability',()=>{
    const geo=cableGeometry([new Vector3(0,0,0),new Vector3(0,2,0)],1);
    geo.computeBoundingBox();
    expect(geo.boundingBox!.max.y).toBeCloseTo(2,6);expect(geo.boundingBox!.min.y).toBeCloseTo(0,6);
    expect(geo.boundingBox!.max.x-geo.boundingBox!.min.x).toBeCloseTo(.024,5);
    geo.dispose();
  });

  it('releases and re-engages a straight cable on reversal alongside an independent supporting frame',()=>{
    const eaFrame = 210e6 * .0149;
    for (const load of [-10,10]) {
      // A constitutive specimen with two elements sharing displacement; card placement
      // separately rejects two objects occupying this same material volume.
      const model={members:[
        {id:1,type:'heb' as const,a:'0,0,0',b:'1,0,0',endA:'fixed' as const,endB:'fixed' as const},
        {id:2,type:'cable' as const,a:'0,0,0',b:'1,0,0',restLengthM:2},
      ],attrs:{'0,0,0':{found:true},'1,0,0':{load:Math.abs(load),loadDirection:load>0?'+X' as const:'-X' as const}},nextId:3};
      const result=analyzeVoxel(model,loadCase), combo=result.combos[0];
      expect(combo.components![0].verification?.status).toBe('verified-cable');
      const e=result.ctx!.els.find(e=>e.m.id===2)!;
      const response=combo.ef!.get(e)!;
      const expectedU=2*load/(eaFrame+(load>0?57600:0));
      expect(response.cableTension).toBeCloseTo(Math.max(0,57600*expectedU/2),8);
      expect(response.slack).toBe(load<0);
    }
  });

  it('preserves a played cable, its clamp, persistent gravity and recovered forces after reload',()=>{
    let s=createTurnGame(8,CABLE_CATALOGUE);
    while(s.turn<9) s=accept(endTurn(s));
    // The 4-cell cable reaches between the players' original column heads.
    s=accept(stageElement(s,'element-19','1,3,1','5,3,1'));
    for(const end of ['a','b'] as const) {
      const card=activeTurnHand(s).find(c=>c.kind==='connection'&&c.profile==='fixed'&&!s.draft.connections.some(k=>k.cardId===c.id))!;
      s=accept(stageConnection(s,card.id,3,end));
    }
    s=accept(endTurn(s));
    for(const [foot,port] of [['1,3,0','port:3:1'],['5,3,0','port:3:3']]) {
      s=place(s,'shs',foot,port);
      const card=activeTurnHand(s).find(c=>c.kind==='load' && c.magnitude===5)!;
      s=accept(stageLoad(s,card.id,port));
      s=accept(endTurn(s));
    }
    const r=analyzeTurn(s,'card-gravity');
    const check=r.capacity!.members[3];
    expect(check.status,JSON.stringify(r.combos[0].components)).toBe('verified');
    if(check.status==='verified') expect(check.actions.N).toBeCloseTo(2.9996205256,8);
    expect(s.board.loads.map(l=>l.jointId)).toEqual(['port:3:1','port:3:3']);
    while(!s.finished) s=accept(endTurn(s));
    expect(s.finalScore!.unknownGravityKN).toBe(0);
    expect(s.finalScore!.awards.map(a=>Math.round(a.awardedShare))).toEqual([50,50]);
    expect(parseTurnState(s)).toEqual(s);
  });
});
