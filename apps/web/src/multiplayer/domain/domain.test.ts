import { describe,it,expect } from "vitest";
import {createMultiplayerDomain,restoreMultiplayerDomain, inspectPort, springStiffnessNPerM, type MultiplayerDomain,type Action,
  type Source, members, metresPerUnit,position} from "./index";
import {loadTargets} from "./loadTargets";

import {multiplayerFixture as fixture} from "./fixtures";
function envelope(d:MultiplayerDomain,action:Action) {
  const {matchId,actor,turn,modelRevision,sequence}=d.getSnapshot();
  return {version:1 as const,matchId,actor,turn,modelRevision,sequence:sequence+1,action};
}
function send(d:MultiplayerDomain,action:Action) {return d.dispatch(envelope(d,action));}
function draw(d:MultiplayerDomain,sources:Source[]) {
  send(d,{type:"ready"}); for(const source of sources) send(d,{type:"draw",source});
}
const at={memberId:"column/A",quarter:4} as const;
const elements:Source[] = Array<Source>(4).fill("elementsLoads");
describe("private multiplayer authority",()=>{
  it("commits four member and four connection cards in one turn",()=>{
    const config=fixture();
    config.cards=Array.from({length:24},(_,i)=>[
      {kind:"member" as const,id:"m"+i,variant:"springHalf" as const,maxLength:10 as const},
      {kind:"connection" as const,id:"c"+i,count:3 as const},
    ]).flat();
    const d=createMultiplayerDomain(config);
    draw(d,elements);send(d,{type:"commit"});
    draw(d,elements);send(d,{type:"commit"});
    draw(d,Array<Source>(4).fill("connections"));
    const directions=[[1,0,1],[0,1,1],[1,1,1],[0,0,11]] as const;
    directions.forEach((end,i)=>{
      send(d,{type:"stage",play:{kind:"member",cardId:"m"+i,a:at,b:[...end]}});
      send(d,{type:"stage",play:{kind:"connection",cardId:"c"+i,
        from:{memberId:"m"+i,quarter:0},to:at,mask:7}});
    });
    send(d,{type:"commit"});
    expect(d.getSnapshot().history[2].plays).toHaveLength(8);
    expect(d.getSnapshot().hands[0].cards).toEqual([]);
  });
  it("queues a single final checkpoint and protects saved events from consumers",()=>{
    const d=createMultiplayerDomain({...fixture(),rounds:1});
    const unsubscribe=d.subscribe(e=>{e.actor="other";});
    const event=send(d,{type:"ready"});
    event.action.type="commit"; unsubscribe();
    for(const source of elements) send(d,{type:"draw",source});
    send(d,{type:"commit"});draw(d,elements);send(d,{type:"commit"});
    expect(restoreMultiplayerDomain(d.serialize()).getSnapshot()).toEqual(d.getSnapshot());
    const s=d.getSnapshot();expect(s.pendingTurns).toEqual([1,2]);
    send(d,{type:"checkpoint",checkpointId:s.checkpointId!,requestId:"r",solver:"test",rules:"mr-v1",corrections:[]});
    expect(d.getSnapshot().phase).toBe("finished");
  });
  for(let bits=0;bits<16;bits++) it("accepts four independent choices "+bits,()=>{
    const d=createMultiplayerDomain(fixture());
    const sources=elements.map((s,i)=>bits & (1<<i) ? "connections" : s);
    draw(d,sources);expect(d.getSnapshot().draws.map(x=>x.source)).toEqual(sources);
    expect(()=>send(d,{type:"draw",source:"elementsLoads"})).toThrow();
    expect(d.getPlayerView("B").hand).toEqual([]);
    send(d,{type:"commit"}); expect(d.getSnapshot().history[0].plays).toEqual([]);
  });
  it("retains hands over passes and closes, replays partial draws, consumes each staged card once",()=>{
    let d=createMultiplayerDomain(fixture());draw(d,elements);
    send(d,{type:"stage",play:{kind:"member",cardId:"m",a:at,b:[1,1,1]}});
    send(d,{type:"commit"});
    draw(d,elements);send(d,{type:"commit"});draw(d,elements.slice(0,2));
    d=restoreMultiplayerDomain(d.serialize());for(const source of elements.slice(2)) send(d,{type:"draw",source});
    const held=d.getPlayerView("A").hand.filter(c=>c.kind==="load");
    expect(held.length).toBe(7);
    for(const c of held) send(d,{type:"stage",play:{kind:"load",cardId:c.id,at}});
    send(d,{type:"clearDraft"});expect(d.getSnapshot().draws).toHaveLength(4);
    for(const c of held) send(d,{type:"stage",play:{kind:"load",cardId:c.id,at}});
    send(d,{type:"cancel",cardId:held[0].id});
    const cmd=envelope(d,{type:"commit"});d.dispatch(cmd);expect(()=>d.dispatch(cmd)).toThrow();
    const s=d.getSnapshot();expect(s.phase).toBe("checkpoint");expect(s.pendingTurns).toEqual([1,2,3]);
    expect(s.original.plays.length).toBe(7);expect(s.hands[0].cards).toHaveLength(1);
    expect(restoreMultiplayerDomain(d.serialize()).getSnapshot()).toEqual(s);
    send(d,{type:"checkpoint",checkpointId:s.checkpointId!,requestId:"r",solver:"test",rules:"mr-v1",
      corrections:[{id:"fix",at:{memberId:"m",quarter:4},turn:1,evidenceId:"e",reason:"fixture",frame:"global",rotationMask:1,
        translationMask:0,reactionN:null,reactionNm:null,validity:"verified"}]});
    expect(d.getSnapshot().original).toEqual(s.original);expect(d.getSnapshot().corrections[0].actor).toBe("A");
    expect(inspectPort(d.getSnapshot(),{memberId:"m",quarter:4})).toMatchObject({originalRotationMask:null,safetyRotationMask:1});
  });
  it("bounds drafts by Euclidean span and preserves original quarters, immutable setup and mask cardinality",()=>{
    const d=createMultiplayerDomain(fixture());draw(d,["elementsLoads","connections","connections","connections"]);
    const member={kind:"member",cardId:"m",a:at,b:[3,4,1]} as const;
    send(d,{type:"stage",play:{...member,b:[3,4,1]}});
    expect(()=>send(d,{type:"stage",play:{...member,b:[4,4,1]}})).toThrow(/span/);
    send(d,{type:"stage",play:{...member,b:[1,2,1]}});
    const view=d.getPlayerView("A");
    expect(loadTargets(view.original,view.drafts).find(t=>t.at.memberId==="m" && t.at.quarter===1)?.point).toEqual([.25,.5,1]);
    const link={kind:"connection" as const,cardId:"c0",from:{memberId:"m",quarter:0 as const},to:at,mask:7};
    expect(()=>send(d,{type:"stage",play:link})).toThrow(/mask/);
    expect(()=>send(d,{type:"stage",play:{...link,mask:1}})).toThrow(/fixed/);
    send(d,{type:"stage",play:{...link,cardId:"c2"}});
    send(d,{type:"commit"});expect(position(d.getSnapshot().original,{memberId:"m",quarter:1})).toEqual([.25,.5,1]);
    expect(d.getSnapshot().original.foundations).toHaveLength(2);
    expect(metresPerUnit).toBe(2);expect(Object.keys(members)).toHaveLength(4);
    expect(springStiffnessNPerM("springHalf",null)).toBeNull();
    expect(springStiffnessNPerM("springHalf",8)).toBe(2*springStiffnessNPerM("springQuarter",8)!);
  });
  it("rejects legacy, invalid definitions and illegal replay; preserves original bytes",()=>{
    const d=createMultiplayerDomain(fixture());draw(d,elements);
    const raw=d.serialize();const save=JSON.parse(raw);
    expect(()=>restoreMultiplayerDomain('{"version":2,"mode":"creative"}')).toThrow();
    save.commands.push(save.commands.at(-1));expect(()=>restoreMultiplayerDomain(JSON.stringify(save))).toThrow();
    save.config.cards[0].count=0;expect(()=>restoreMultiplayerDomain(JSON.stringify(save))).toThrow();
    expect(d.serialize()).toBe(raw);
  });
});
