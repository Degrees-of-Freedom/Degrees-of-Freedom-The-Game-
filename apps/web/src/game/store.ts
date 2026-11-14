import { create } from 'zustand';
import { exampleModel } from './examples';
import { LEVELS, initialModel, memberIssue, nodeItemIssue, swapIssue, nodeKey, type GameModel, type GridPoint, type LevelId, type MemberType, type NodeItem, type Tool } from './model';
export * from './model';
export type Selection = {type:'member'; id:number} | {type:'node'; key:string} | null;
interface GameState {
 levelId: LevelId; model: GameModel; history: GameModel[]; tool: Tool; workK: number; chainStart: string | null; selected: Selection;
 setLevel: (id:LevelId)=>void; reset:()=>void; loadExample:()=>boolean; applyAutoDesign:(model:GameModel, sourceModel:GameModel)=>boolean; swapTarget:MemberType; setSwapTarget:(type:MemberType)=>void; undo:()=>void; setTool:(tool:Tool)=>void; setWorkK:(k:number)=>void; setChainStart:(key:string|null)=>void; setSelected:(selection:Selection)=>void;
 addMember:(a:GridPoint,b:GridPoint,type:MemberType)=>string|null; removeMember:(id:number)=>void; swapMember:(id:number,type:MemberType)=>string|null; swapAllOfType:(from:MemberType,to:MemberType)=>number;
 toggleAttr:(p:GridPoint,type:NodeItem)=>string|null; removeNodeAttrs:(key:string)=>void;
}
const clone=(model:GameModel):GameModel=>({members:model.members.map(m=>({...m})),attrs:Object.fromEntries(Object.entries(model.attrs).map(([k,v])=>[k,{...v}])),nextId:model.nextId});
function cleanup(model:GameModel) {
 for(const [key,a] of Object.entries(model.attrs)) { if(!model.members.some(m=>m.a===key||m.b===key)) { delete a.joint; delete a.load; } if(!a.found&&!a.joint&&!a.load&&!a.locked) delete model.attrs[key]; }
}
function save(id: LevelId, model: GameModel) { try { localStorage.setItem(`voxstruct:${id}`,JSON.stringify(model)); } catch { /* optional persistence */ } }
function savedLevel(): LevelId { try { const id=localStorage.getItem('voxstruct:level'); if(id && Object.hasOwn(LEVELS,id)) return id as LevelId; } catch { /* use default */ } return 'tower1'; }
function load(id: LevelId): GameModel { try { const raw=localStorage.getItem(`voxstruct:${id}`); if(raw) { const model=JSON.parse(raw) as GameModel; if(Array.isArray(model.members) && model.attrs && Number.isInteger(model.nextId)) return model; } } catch { /* use initial model */ } return initialModel(LEVELS[id]); }
/** Pure game state and validated, undoable edits; renderer and solver are independent. */
export const useGameStore=create<GameState>((set,get)=>{
 const commit=(model:GameModel)=>set(s=>{save(s.levelId,model); return {model,history:[...s.history.slice(-199),clone(s.model)]};});
 const startLevel=savedLevel();
 return {
 levelId:startLevel,model:load(startLevel),swapTarget:'ipe',setSwapTarget:(swapTarget)=>set({swapTarget}),history:[],tool:'shs',workK:LEVELS[startLevel].cliffH ?? 0,chainStart:null,selected:null,
 setLevel:(levelId)=>{try { localStorage.setItem('voxstruct:level',levelId); } catch { /* optional persistence */ } set({levelId,model:load(levelId),history:[],workK:LEVELS[levelId].cliffH ?? 0,chainStart:null,selected:null});},
 reset:()=>{const s=get(); if(!s.model.members.length && !Object.keys(s.model.attrs).length) return; commit(initialModel(LEVELS[s.levelId])); set({chainStart:null,selected:null});},
 loadExample:()=>{const model=exampleModel(get().levelId); if(!model) return false; commit(model); set({chainStart:null,selected:null}); return true;},
 // A design is valid only for the exact model from which it was computed.
 applyAutoDesign:(model,sourceModel)=>{if(get().model!==sourceModel) return false; commit(clone(model)); return true;},
 undo:()=>set(s=>{if(!s.history.length) return {}; const model=s.history[s.history.length-1]; save(s.levelId,model); return {model,history:s.history.slice(0,-1),chainStart:null,selected:null};}),
 setTool:(tool)=>set({tool,chainStart:null}), setWorkK:(k)=>set(s=>({workK:Math.max(0,Math.min(LEVELS[s.levelId].nz,Math.round(k)))})), setChainStart:(chainStart)=>set({chainStart}), setSelected:(selected)=>set({selected}),
 addMember:(a,b,type)=>{const s=get(), issue=memberIssue(LEVELS[s.levelId],s.model,a,b,type); if(issue) return issue; const model=clone(s.model); model.members.push({id:model.nextId++,a:nodeKey(...a),b:nodeKey(...b),type}); commit(model); return null;},
 removeMember:(id)=>{const s=get(); if(!s.model.members.some(m=>m.id===id)) return; const model=clone(s.model); model.members=model.members.filter(m=>m.id!==id); cleanup(model); commit(model); if(s.selected?.type==='member'&&s.selected.id===id) set({selected:null});},
 swapMember:(id,type)=>{const s=get(), m=s.model.members.find(m=>m.id===id); if(!m) return 'Member not found'; const issue=swapIssue(LEVELS[s.levelId],s.model,m,type); if(issue) return issue; const model=clone(s.model); model.members.find(m=>m.id===id)!.type=type; commit(model); return null;},
 swapAllOfType:(from,to)=>{const s=get(), model=clone(s.model); let count=0; for(const m of model.members) if(m.type===from&&!swapIssue(LEVELS[s.levelId],model,m,to)) {m.type=to; count++;} if(count) commit(model); return count;},
 toggleAttr:(p,type)=>{const s=get(), issue=nodeItemIssue(LEVELS[s.levelId],s.model,p,type); if(issue) return issue; const model=clone(s.model), key=nodeKey(...p), a=model.attrs[key]??(model.attrs[key]={}); if(type==='load') a.load=a.load ? undefined : 50; else a[type]=!a[type]; cleanup(model); commit(model); return null;},
 removeNodeAttrs:(key)=>{const s=get(), a=s.model.attrs[key]; if(!a||a.locked||(!a.load&&!a.joint&&!a.found)) return; const model=clone(s.model), next=model.attrs[key]; if(next.load) delete next.load; else if(next.joint) delete next.joint; else delete next.found; cleanup(model); commit(model);},
 };
});



