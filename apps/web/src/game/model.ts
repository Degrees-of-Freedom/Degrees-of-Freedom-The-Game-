export type MemberType = 'shs' | 'glulam' | 'ipe' | 'heb' | 'cable';
export type NodeItem = 'joint' | 'found' | 'load';
export type Tool = MemberType | NodeItem | 'inspect' | 'delete' | 'swap';
export type LevelId = 'tower1' | 'tower2' | 'bridge1' | 'bridge2' | 'sandbox';
export type GridPoint = [number, number, number];
export interface Member { id: number; a: string; b: string; type: MemberType }
export interface NodeAttributes { found?: boolean; joint?: boolean; load?: number; locked?: boolean }
export interface GameModel { members: Member[]; attrs: Record<string, NodeAttributes>; nextId: number }
export interface Level { name: string; type: 'tower' | 'bridge' | 'sandbox'; nx: number; ny: number; nz: number; q0: number; budget: number; inv: Partial<Record<MemberType | 'joint' | 'found', number>> | null; desc: string; target?: number; payload?: number; cliffL?: number; cliffR?: number; cliffH?: number; water?: [number, number]; ys?: number[]; traffic?: number }
export const CELL_SIZE = 2;
export const ITEMS = {
  shs: { kind: 'beam', label: 'SHS 100×6', color: '#a3adb8', cost: 120, maxCells: 3 },
  glulam: { kind: 'beam', label: 'Glulam 200×400', color: '#c8955a', cost: 180, maxCells: 3 },
  ipe: { kind: 'beam', label: 'IPE 300', color: '#6a8db3', cost: 260, maxCells: 3 },
  heb: { kind: 'beam', label: 'HEB 300', color: '#45617f', cost: 620, maxCells: 3 },
  cable: { kind: 'cable', label: 'Cable Ø24', color: '#2b2f36', cost: 90, maxCells: 8 },
  joint: { kind: 'joint', label: 'Moment connection', color: '#f39c34', cost: 80 },
  found: { kind: 'found', label: 'Foundation', color: '#b9b4aa', cost: 400 },
  load: { kind: 'load', label: 'Point load 50 kN', color: '#ff5a5f', cost: 0 },
} as const;
export const MEMBER_TYPES: MemberType[] = ['shs', 'glulam', 'ipe', 'heb', 'cable'];
export const LEVELS: Record<LevelId, Level> = {
 tower1: { name:'Tower I · 12 m lookout', type:'tower', nx:10, ny:10, nz:10, target:6, payload:40, q0:0.6, budget:6500, inv:{shs:24,glulam:6,ipe:6,heb:0,cable:8,joint:6,found:4}, desc:'Reach 12 m with a 40 kN lookout load.' },
 tower2: { name:'Tower II · 24 m antenna', type:'tower', nx:10, ny:10, nz:15, target:12, payload:30, q0:0.9, budget:12000, inv:{shs:44,glulam:0,ipe:16,heb:4,cable:16,joint:10,found:4}, desc:'Reach 24 m with a 30 kN antenna load.' },
 bridge1: { name:'Bridge I · 16 m canyon', type:'bridge', nx:16, ny:10, nz:9, cliffL:4, cliffR:12, cliffH:3, water:[6,9], ys:[4,6], traffic:30, q0:0.5, budget:7000, inv:{shs:40,glulam:8,ipe:16,heb:4,cable:8,joint:12,found:4}, desc:'Span the canyon between the abutments.' },
 bridge2: { name:'Bridge II · 28 m gorge', type:'bridge', nx:22, ny:10, nz:13, cliffL:4, cliffR:18, cliffH:4, water:[6,15], ys:[4,6], traffic:25, q0:0.6, budget:15000, inv:{shs:50,glulam:0,ipe:24,heb:8,cable:24,joint:16,found:6}, desc:'Span the 28 m gorge.' },
 sandbox: { name:'Sandbox · unlimited', type:'sandbox', nx:16, ny:16, nz:14, q0:0.5, budget:Infinity, inv:null, desc:'Experiment with unlimited supply and point loads.' },
};
export const nodeKey = (i: number, j: number, k: number) => `${i},${j},${k}`;
export const parseNodeKey = (key: string): GridPoint => key.split(',').map(Number) as GridPoint;
export function terrainCell(level: Level, i: number, j: number): {h: number; water: boolean} | null {
 if (i < 0 || j < 0 || i >= level.nx || j >= level.ny) return null;
 if (level.type !== 'bridge') return {h:0,water:false};
 return { h: i < level.cliffL! || i >= level.cliffR! ? level.cliffH! : 0, water: i >= level.water![0] && i <= level.water![1] };
}
export function groundK(level: Level, i: number, j: number): number {
 return Math.max(...[-1,0].flatMap(di => [-1,0].map(dj => terrainCell(level,i+di,j+dj)?.h ?? -99)));
}
export function nodeValid(level: Level, [i,j,k]: GridPoint): boolean {
 return [i,j,k].every(Number.isInteger) && i>=0 && j>=0 && k>=0 && i<=level.nx && j<=level.ny && k<=level.nz && k>=groundK(level,i,j);
}
export function canFound(level: Level, [i,j,k]: GridPoint): boolean {
 return nodeValid(level,[i,j,k]) && k===groundK(level,i,j) && [-1,0].some(di => [-1,0].some(dj => { const c=terrainCell(level,i+di,j+dj); return !!c && c.h===k && !c.water; }));
}
export function initialModel(level: Level): GameModel {
 const model: GameModel = {members:[],attrs:{},nextId:1};
 if (level.type==='bridge') for (const y of level.ys!) for (const x of [level.cliffL!,level.cliffR!]) model.attrs[nodeKey(x,y,level.cliffH!)]={found:true,locked:true};
 return model;
}
export function allNodeKeys(model: GameModel): string[] {
 const keys=new Set(model.members.flatMap(m=>[m.a,m.b]));
 for (const [key,a] of Object.entries(model.attrs)) if (a.found || a.joint || a.load) keys.add(key);
 return [...keys];
}
export function used(model: GameModel, type: MemberType | NodeItem): number {
 if (MEMBER_TYPES.includes(type as MemberType)) return model.members.filter(m=>m.type===type).length;
 return Object.values(model.attrs).filter(a=>type==='found' ? a.found && !a.locked : type==='joint' ? a.joint : a.load).length;
}
export function remaining(level: Level, model: GameModel, type: MemberType | NodeItem): number {
 return level.inv === null ? Infinity : (type==='load' ? 0 : level.inv[type] ?? 0) - used(model,type);
}
function groundAtPoint(level: Level, x: number, y: number): number {
 const coords=(v:number)=>Math.abs(v-Math.round(v))<1e-6 ? [Math.round(v)-1,Math.round(v)] : [Math.floor(v)];
 const heights=coords(x).flatMap(i=>coords(y).map(j=>terrainCell(level,i,j)?.h).filter((h): h is number=>h!==undefined));
 return heights.length ? Math.min(...heights) : 0;
}
export function memberIssue(level: Level, model: GameModel, a: GridPoint, b: GridPoint, type: MemberType): string | null {
 if (a.join()===b.join()) return 'Pick a different end point';
 if (!nodeValid(level,a)||!nodeValid(level,b)) return 'Outside the voxel space or inside the ground';
 const d=a.map((v,i)=>b[i]-v);
 if (Math.max(...d.map(Math.abs))>ITEMS[type].maxCells) return `Too long — max ${ITEMS[type].maxCells} cells per axis`;
 const ak=nodeKey(...a), bk=nodeKey(...b);
 if (model.members.some(m=>(m.a===ak&&m.b===bk)||(m.a===bk&&m.b===ak))) return 'These points are already connected';
 if (remaining(level,model,type)<=0) return `No ${ITEMS[type].label} left in supply`;
 for(let t=0.05;t<0.96;t+=0.05) if(a[2]+d[2]*t<groundAtPoint(level,a[0]+d[0]*t,a[1]+d[1]*t)-1e-6) return 'Member would pass through the ground';
 return null;
}
export function nodeItemIssue(level: Level, model: GameModel, p: GridPoint, type: NodeItem): string | null {
 const key=nodeKey(...p), a=model.attrs[key] ?? {};
 if (!nodeValid(level,p)) return 'Invalid position';
 if (type==='found') { if(a.found) return a.locked ? 'Abutment bearings are fixed' : null; if(!canFound(level,p)) return 'Foundations need solid ground'; if(remaining(level,model,type)<=0) return 'No foundations left in supply'; }
 if (type==='joint' && !a.joint) { if(!model.members.some(m=>m.a===key||m.b===key)) return 'Build members first'; if(remaining(level,model,type)<=0) return 'No moment connections left'; }
 if (type==='load' && !a.load) { if(level.type!=='sandbox') return 'Point loads are available in sandbox only'; if(!allNodeKeys(model).includes(key)) return 'Place loads on existing nodes'; }
 return null;
}
export function swapIssue(level: Level, model: GameModel, m: Member, type: MemberType): string | null {
 if(m.type===type) return 'Already this type';
 if(remaining(level,model,type)<=0) return `No ${ITEMS[type].label} left in supply`;
 const a=parseNodeKey(m.a), b=parseNodeKey(m.b);
 return Math.max(...a.map((v,i)=>Math.abs(v-b[i])))>ITEMS[type].maxCells ? `Too long for ${ITEMS[type].label}` : null;
}
export function costOf(model: GameModel): number {
 return model.members.reduce((sum,m)=>sum+ITEMS[m.type].cost,0)+Object.values(model.attrs).reduce((sum,a)=>sum+(a.joint?ITEMS.joint.cost:0)+(a.found&&!a.locked?ITEMS.found.cost:0),0);
}
