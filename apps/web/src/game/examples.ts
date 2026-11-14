import { initialModel, nodeKey, type GameModel, type LevelId, type MemberType, LEVELS } from './model';
/** Reference structures supplied by the standalone prototype. */
export function exampleModel(id: LevelId): GameModel | null {
 if(id!=='tower1'&&id!=='bridge1') return null;
 const m=initialModel(LEVELS[id]);
 const add=(a:string,b:string,type:MemberType)=>m.members.push({id:m.nextId++,a,b,type});
 if(id==='tower1') {
  const legs=[[4,4],[6,4],[6,6],[4,6]];
  legs.forEach(([i,j])=>{m.attrs[nodeKey(i,j,0)]={found:true};});
  legs.forEach(([i,j],n)=>{add(nodeKey(i,j,0),nodeKey(i,j,3),'ipe'); add(nodeKey(i,j,3),nodeKey(i,j,6),n<2?'ipe':'glulam');});
  for(const k of [3,6]) legs.forEach(([i,j],n)=>{const [p,q]=legs[(n+1)%4];add(nodeKey(i,j,k),nodeKey(p,q,k),'shs');});
  for(const k of [0,3]) legs.forEach(([i,j],n)=>{const [p,q]=legs[(n+1)%4];add(nodeKey(i,j,k),nodeKey(p,q,k+3),'shs');});
  add(nodeKey(4,4,3),nodeKey(6,6,3),'shs'); add(nodeKey(4,4,6),nodeKey(6,6,6),'shs');
 } else {
  const d=3,t=5;
  for(const y of [4,6]) {
   for(const i of [4,6,8,10]) add(nodeKey(i,y,d),nodeKey(i+2,y,d),'ipe');
   for(const i of [6,8]) add(nodeKey(i,y,t),nodeKey(i+2,y,t),'ipe');
   add(nodeKey(4,y,d),nodeKey(6,y,t),'glulam'); add(nodeKey(12,y,d),nodeKey(10,y,t),'glulam');
   for(const i of [6,8,10]) add(nodeKey(i,y,d),nodeKey(i,y,t),'shs');
   add(nodeKey(6,y,t),nodeKey(8,y,d),'shs'); add(nodeKey(10,y,t),nodeKey(8,y,d),'shs');
  }
  for(const i of [6,8,10]) {add(nodeKey(i,4,d),nodeKey(i,6,d),'shs');add(nodeKey(i,4,t),nodeKey(i,6,t),'shs');}
  add(nodeKey(4,4,d),nodeKey(6,6,d),'shs');add(nodeKey(6,6,d),nodeKey(8,4,d),'shs');add(nodeKey(8,4,d),nodeKey(10,6,d),'shs');add(nodeKey(10,6,d),nodeKey(12,4,d),'shs');
  add(nodeKey(6,4,t),nodeKey(8,6,t),'shs');add(nodeKey(8,6,t),nodeKey(10,4,t),'shs');add(nodeKey(4,4,d),nodeKey(6,6,t),'shs');add(nodeKey(12,4,d),nodeKey(10,6,t),'shs');
 }
 return m;
}
