import { z } from "zod";
import { configuration, id, play, port, sourceOf, sources, type Configuration, type Play, type Source } from "./catalogue";
import { applyPlay, position, requireRule, setup, type OriginalModel, type Origin } from "./geometry";
export * from "./catalogue";
export { position, type OriginalModel, type Origin } from "./geometry";

const correction = z.strictObject({
  id, at: port, turn: z.int().positive(), evidenceId: id, reason: id,
  frame: z.literal("global"), rotationMask: z.int().min(0).max(7),
  translationMask: z.int().min(0).max(7), validity: z.literal("verified"),
  reactionN: z.tuple([z.number(),z.number(),z.number()]).nullable(),
  reactionNm: z.tuple([z.number(),z.number(),z.number()]).nullable(),
});
const action = z.discriminatedUnion("type", [
  z.strictObject({type:z.literal("ready")}),
  z.strictObject({type:z.literal("draw"), source:sources}),
  z.strictObject({type:z.literal("stage"), play}),
  z.strictObject({type:z.literal("cancel"), cardId:id}),
  z.strictObject({type:z.literal("clearDraft")}),
  z.strictObject({type:z.literal("commit")}),
  z.strictObject({type:z.literal("interval"), interval:z.int().positive()}),
  z.strictObject({type:z.literal("checkpoint"), requestId:id, checkpointId:id, solver:id,
    rules:z.literal("mr-v1"), corrections:z.array(correction)}),
]);
export type Action = z.infer<typeof action>;
const command = z.strictObject({version:z.literal(1), matchId:id, sequence:z.int().positive(),
  turn:z.int().positive(), actor:id, modelRevision:z.int().nonnegative(), action});
export type Command = z.infer<typeof command>;
export interface DomainEvent extends Origin {
  version: 1; id: string; matchId: string; sequence: number; type: Action["type"];
  cardId?: string; action: Action;
}
interface CompletedTurn extends Origin {
  draws: {source:Source; cardId:string}[]; plays:Play[]; beforeRevision:number;
}
export interface MatchState {
  version:1; matchId:string; sequence:number; turn:number; actor:string; modelRevision:number;
  phase:"handoff"|"draw"|"play"|"checkpoint"|"finished";
  interval:number; draws:CompletedTurn["draws"]; drafts:Play[];
  hands: {actor:string; cards:string[]}[]; remaining:Record<Source,string[]>;
  original:OriginalModel; history:CompletedTurn[]; pendingTurns:number[]; checkpointId:string|null;
  corrections:(z.infer<typeof correction> & {checkpointId:string; requestId:string; solver:string; rules:"mr-v1"; actor:string; modelRevision:number})[];
}
function initial(c:Configuration):MatchState {
  const distinct = (values:string[])=>new Set(values).size===values.length;
  requireRule(distinct(c.players.map(p=>p.id)) && distinct(c.players.map(p=>[p.x,p.y].join())), "Duplicate player or starting cell");
  const original = setup(c);
  requireRule(distinct([...c.cards.map(card=>card.id), ...original.spans.map(s=>s.id),
    ...original.foundations.map(f=>f.id)]), "Duplicate object identity");
  const decks:MatchState["remaining"] = {elementsLoads:[],connections:[]};
  for (const card of c.cards) decks[sourceOf(card)].push(card.id);
  return { version:1,matchId:c.matchId,sequence:0,turn:1,actor:c.players[0].id,modelRevision:0,
    phase:"handoff",interval:3,draws:[],drafts:[],hands:c.players.map(p=>({actor:p.id,cards:[]})),
    remaining:decks,original,history:[],pendingTurns:[],checkpointId:null,corrections:[] };
}
function advance(s:MatchState,c:Configuration) {
  if (s.turn === c.rounds*c.players.length) { s.phase="finished"; return; }
  s.turn++;
  s.actor=c.players[(s.turn-1)%c.players.length].id;
  s.phase="handoff";
}
function transition(s:MatchState,c:Configuration,cmd:Command):DomainEvent {
  const a=cmd.action;
  requireRule(cmd.sequence===s.sequence+1 && cmd.turn===s.turn && cmd.matchId===s.matchId &&
    cmd.actor===s.actor && cmd.modelRevision===s.modelRevision, "Stale command identity");
  requireRule(s.phase!=="finished","Match has ended");
  const origin={actor:s.actor,turn:s.turn,modelRevision:s.modelRevision};
  const event:DomainEvent={...origin,version:1,matchId:s.matchId,sequence:cmd.sequence,
    id:s.matchId+"/"+cmd.sequence,type:a.type, action:a};
  const hand=s.hands.find(h=>h.actor===s.actor)!.cards;
  function projected(drafts:Play[]) {
    const model=structuredClone(s.original);
    // Members establish reference ports before loads and connections bind to them.
    for (const p of drafts) {
      const card=c.cards.find(card=>card.id===p.cardId);
      requireRule(card && hand.includes(card.id), "Card is not held by this player");
      applyPlay(model,card,p,{...origin,modelRevision:s.modelRevision+1},c.height);
    }
    return model;
  }
  switch (a.type) {
    case "ready":
      requireRule(s.phase==="handoff","Already ready"); s.phase="draw"; break;
    case "draw": {
      requireRule(s.phase==="draw","Draw phase closed");
      const cardId=s.remaining[a.source].shift();
      requireRule(cardId,"Chosen deck is exhausted");
      s.draws.push({source:a.source,cardId}); hand.push(cardId); event.cardId=cardId;
      if(s.draws.length===4) s.phase="play";
      break;
    }
    case "stage": {
      requireRule(s.phase==="play","Complete all four draws first");
      const index=s.drafts.findIndex(p=>p.cardId===a.play.cardId);
      if(index<0) s.drafts.push(a.play); else s.drafts[index]=a.play;
      projected(s.drafts); break;
    }
    case "cancel":
      requireRule(s.phase==="play" && s.drafts.some(p=>p.cardId===a.cardId),"No such draft");
      s.drafts=s.drafts.filter(p=>p.cardId!==a.cardId); projected(s.drafts); break;
    case "clearDraft":
      requireRule(s.phase==="play","No editable draft");
      s.drafts=[]; break;
    case "interval":
      s.interval=a.interval; break;
    case "commit": {
      requireRule(s.phase==="play","Complete all four draws before passing or committing");
      s.original=projected(s.drafts);
      const used=new Set(s.drafts.map(p=>p.cardId));
      s.hands.find(h=>h.actor===s.actor)!.cards=hand.filter(cardId=>!used.has(cardId));
      s.modelRevision+=Number(s.drafts.length>0);
      s.history.push({...origin,beforeRevision:origin.modelRevision,modelRevision:s.modelRevision,draws:s.draws,plays:s.drafts});
      s.pendingTurns.push(s.turn); s.draws=[]; s.drafts=[];
      if(s.pendingTurns.length>=s.interval || s.turn===c.rounds*c.players.length) {
        s.phase="checkpoint"; s.checkpointId=s.matchId+"/checkpoint/"+s.turn;
      } else advance(s,c);
      break;
    }
    case "checkpoint": {
      requireRule(s.phase==="checkpoint" && s.checkpointId===a.checkpointId,"Unexpected checkpoint");
      for(const record of a.corrections) {
        requireRule(s.pendingTurns.includes(record.turn) && (record.rotationMask|record.translationMask)>0 &&
          !s.corrections.some(r=>r.id===record.id),"Invalid system correction");
        position(s.original,record.at);
        const responsible=s.history[record.turn-1];
        const span=s.original.spans.find(s=>s.id===record.at.memberId)!;
        requireRule(span.setup || s.original.plays.some(p=>p.play.cardId===span.id && p.turn<=record.turn),
          "Correction target did not exist on originating turn");
        s.corrections.push({...record,actor:responsible.actor,modelRevision:responsible.modelRevision,
          checkpointId:a.checkpointId,requestId:a.requestId,rules:a.rules,solver:a.solver});
      }
      s.modelRevision+=Number(a.corrections.length>0);
      s.pendingTurns=[]; s.checkpointId=null; advance(s,c); break;
    }
  }
  s.sequence=cmd.sequence;
  return event;
}

/** The full snapshot, subscription and save are authority-only. Route private UI via getPlayerView. */
export function createMultiplayerDomain(input:Configuration) {
  const config=configuration.parse(input);
  let state=initial(config);
  const log:Command[]=[];
  const listeners=new Set<(event:DomainEvent)=>void>();
  function dispatch(input:Command) {
    const cmd=command.parse(input);
    const next=structuredClone(state);
    const event=transition(next,config,cmd);
    state=next; log.push(cmd);
    for(const listener of listeners) listener(structuredClone(event));
    return structuredClone(event);
  }
  return {
    dispatch, getSnapshot:()=>structuredClone(state), getConfiguration:()=>structuredClone(config),
    getPlayerView:(actor:string, covered=false)=>{
      const visible=!covered && actor===state.actor && (state.phase==="draw" || state.phase==="play");
      return structuredClone({actor:state.actor,turn:state.turn,phase:state.phase,original:state.original,
        corrections:state.corrections,hand:visible ? config.cards.filter(c=>state.hands.find(h=>h.actor===actor)!.cards.includes(c.id)) : [],
        draws:visible ? state.draws : [],drafts:visible ? state.drafts : []});
    },
    subscribe:(listener:(event:DomainEvent)=>void)=>{listeners.add(listener); return ()=>listeners.delete(listener);},
    serialize:()=>JSON.stringify({format:"dof-multiplayer",version:1,config,commands:log}),
  };
}
export type MultiplayerDomain=ReturnType<typeof createMultiplayerDomain>;
/** Capture the envelope when the interaction starts. Retrying it cannot draw twice. */
export function commandFor(state: Pick<MatchState,"matchId"|"sequence"|"actor"|"turn"|"modelRevision">, action: Action): Command {
  const {matchId,sequence,actor,turn,modelRevision}=state;
  return {version:1,matchId,sequence:sequence+1,actor,turn,modelRevision,action};
}
const save=z.strictObject({format:z.literal("dof-multiplayer"),version:z.literal(1),config:configuration,commands:z.array(command)});
/** Pure import. Caller keeps original bytes for every unsupported or invalid envelope. */
export function restoreMultiplayerDomain(raw:string) {
  const value:unknown=JSON.parse(raw);
  const data=save.parse(value);
  const domain=createMultiplayerDomain(data.config);
  for(const cmd of data.commands) domain.dispatch(cmd);
  return domain;
}
