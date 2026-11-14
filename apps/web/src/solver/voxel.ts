import type { VoxelModel, VoxelLevel, VoxelMember, VoxelMemberType } from './voxelInput';
type BeamType = Exclude<VoxelMemberType, 'cable'>;
type Section = typeof ITEMS[VoxelMemberType];
type BeamSection = typeof ITEMS[BeamType];
type Element = { m: VoxelMember; it: Section; L: number; R: number[][]; ex: number[]; a: number; b: number; k: Float64Array; rel: number[]; kgl: Float64Array; dofs: number[]; cable: boolean; rigidA: boolean; rigidB: boolean };
type Context = { keys: string[]; pos: number[][]; act: number[]; NA: number; eq: Int32Array; nf: number; els: Element[]; bw: number };
type Demand = { Nt: number; Nc: number; Vy: number; Vz: number; My: number; Mz: number; endF: number[]; endM: number[]; dEIy: number; dEIz: number; dmax: number };
type ElementForce = { f: Float64Array; ul: Float64Array; slack?: boolean };
type Solved = { u: Float64Array; K0: Float64Array; active: Map<Element, boolean>; ef: Map<Element, ElementForce> };
type LoadCombo = { name: string; short: string; type: 'ULS'|'SLS'; dir: number[] };
type Combo = { combo: LoadCombo; F: Float64Array; vis: {a: number; v: number[]; kind: string}[]; fail?: boolean; u?: Float64Array; ef?: Map<Element, ElementForce>; active?: Map<Element, boolean>; reac?: Record<number, Float64Array>; maxD?: number; sol?: Solved };
/** Prototype analysis in kN and metres. Results are approximate and not engineering design. */
export interface VoxelAnalysis {
 error?: string; mechanism: boolean; floating: string[]; unstable: Set<string>;
 objectives: {ok: boolean; label: string; detail: string; warn?: boolean}[];
 members: Record<number, {e: Element; util: number; gov: string; slack: boolean; checks: Record<string, number>; demand: Demand}>;
 found: Record<string, {util: number; r: Float64Array | null; locked: boolean}>;
 combos: Combo[]; nodes: Record<string, never>; ctx?: Context; alpha?: (number|null)[]; amp?: number; avgU?: number; failing?: number; connMax?: number; foundMax?: number; topZ?: number;
 success?: boolean; cost?: number; mass?: number; stars?: number; maxU?: number; alphaMin?: number; time?: number;
}
import { dot, localAxes, frameK, trussK, condense, toGlobal, vecToLocal, vecToGlobal, gaussSolve, cholesky, cholSolve } from './frameMath';
// Experimental Voxel Struct analysis, extracted from prototypes/voxel-struct.
// Uses kN and metres, with prototype assumptions and approximate design checks.
// This game-specific interface is not an implementation of SolverAdapter.
const S = 2; // voxel size [m]
const ITEMS = {
  shs:   { kind:'beam', label:'SHS 100×6', sub:'Steel tube S355', color:'#a3adb8', cost:120, E:210e6, G:81e6,
           A:2.24e-3, Iy:3.20e-6, Iz:3.20e-6, J:5.13e-6, Wy:6.40e-5, Wz:6.40e-5, Avy:1.12e-3, Avz:1.12e-3,
           ft:355e3, fc:355e3, fm:355e3, fv:205e3, alpha:0.21, l0:0.2, w:0.176, dim:[0.10,0.10], shape:'box', maxCells:3 },
  glulam:{ kind:'beam', label:'Glulam 200×400', sub:'Timber GL24h', color:'#c8955a', cost:180, E:11.5e6, G:0.65e6,
           A:0.08, Iy:1.0667e-3, Iz:2.667e-4, J:7.33e-4, Wy:5.333e-3, Wz:2.667e-3, Avy:0.0533, Avz:0.0533,
           ft:12.3e3, fc:15.4e3, fm:15.4e3, fv:2.24e3, alpha:0.1, l0:0.3, w:0.34, dim:[0.2,0.4], shape:'box', maxCells:3 },
  ipe:   { kind:'beam', label:'IPE 300', sub:'Steel I-beam S355', color:'#6a8db3', cost:260, E:210e6, G:81e6,
           A:5.38e-3, Iy:8.356e-5, Iz:6.04e-6, J:2.01e-7, Wy:5.57e-4, Wz:8.05e-5, Avy:3.2e-3, Avz:2.57e-3,
           ft:355e3, fc:355e3, fm:355e3, fv:205e3, alpha:0.34, l0:0.2, w:0.422, dim:[0.15,0.30], shape:'I', maxCells:3 },
  heb:   { kind:'beam', label:'HEB 300', sub:'Heavy steel H-section', color:'#45617f', cost:620, E:210e6, G:81e6,
           A:1.49e-2, Iy:2.517e-4, Iz:8.563e-5, J:1.85e-6, Wy:1.678e-3, Wz:5.71e-4, Avy:1.14e-2, Avz:4.74e-3,
           ft:355e3, fc:355e3, fm:355e3, fv:205e3, alpha:0.49, l0:0.2, w:1.17, dim:[0.30,0.30], shape:'I', maxCells:3 },
  cable: { kind:'cable', label:'Cable Ø24', sub:'Tension only · 25 kN pretension', color:'#2b2f36', cost:90, E:160e6, A:3.6e-4, NRd:260, P0:25,
           w:0.03, dim:[0.05,0.05], shape:'box', maxCells:8 },
  joint: { kind:'joint', label:'Moment connection', sub:'Rigid + stronger joint', color:'#f39c34', cost:80 },
  found: { kind:'found', label:'Foundation', sub:'Fixed support on ground', color:'#b9b4aa', cost:400 },
  load:  { kind:'load', label:'Point load 50 kN', sub:'Sandbox live load', color:'#ff5a5f', cost:0 },
} as const;
const JOINT_CAP = { pinF:350, rigidF:700, rigidM:220 };   // kN, kNm
const FOUND_CAP = { Nc:1500, Nt:250, H:350, M:300 };       // kN, kNm
const GAMMA = { ULS:{G:1.35,Q:1.5,W:0.9,notional:true}, SLS:{G:1,Q:1,W:0.6,notional:false} };
const COMBOS: LoadCombo[] = [
  { name:'ULS · 1.35G+1.5Q+0.9Wx', short:'ULS wind X', type:'ULS', dir:[1,0,0] },
  { name:'ULS · 1.35G+1.5Q+0.9Wy', short:'ULS wind Y', type:'ULS', dir:[0,1,0] },
  { name:'SLS · G+Q+0.6Wx', short:'SLS wind X', type:'SLS', dir:[1,0,0] },
  { name:'SLS · G+Q+0.6Wy', short:'SLS wind Y', type:'SLS', dir:[0,1,0] },
];


type AutoDesignResult = {model: VoxelModel; analysis: VoxelAnalysis; changed: boolean};
function runVoxel(model: VoxelModel, LV: VoxelLevel, autoDesign: false): VoxelAnalysis;
function runVoxel(model: VoxelModel, LV: VoxelLevel, autoDesign: true): AutoDesignResult;
function runVoxel(model: VoxelModel, LV: VoxelLevel, autoDesign: boolean): VoxelAnalysis | AutoDesignResult {
const key = (i: number,j: number,k: number) => `${i},${j},${k}`;
const parse = (s: string) => s.split(',').map(Number);
function allNodeKeys(){
 const keys=new Set<string>();
 for(const m of model.members){ keys.add(m.a); keys.add(m.b); }
 for(const k in model.attrs){ const a=model.attrs[k]; if(a.found||a.joint||a.load) keys.add(k); }
 return [...keys];
}
function makeElement(m: VoxelMember, pa: number[], pb: number[], a: number, b: number, eq: Int32Array): Element{
  const it: Section=ITEMS[m.type];
  const d=[pb[0]-pa[0],pb[1]-pa[1],pb[2]-pa[2]], L=Math.hypot(...d);
  const ex=d.map(v=>v/L), R=localAxes(ex);
  const cable = it.kind==='cable';
  const rigidA = !cable && !!model.attrs[m.a]?.joint, rigidB = !cable && !!model.attrs[m.b]?.joint;
  const k = it.kind === 'cable' ? trussK(it.E,it.A,L) : frameK(it.E,it.G,it.A,it.Iy,it.Iz,it.J,L);
  const rel=[]; if(!cable){ if(!rigidA) rel.push(4,5); if(!rigidB) rel.push(10,11); }
  const kgl = toGlobal(condense(k,rel), R);
  const dofs=[]; for(let q=0;q<6;q++) dofs.push(eq[a*6+q]); for(let q=0;q<6;q++) dofs.push(eq[b*6+q]);
  return { m, it, L, R, ex, a, b, k, rel, kgl, dofs, cable, rigidA, rigidB };
}
function recover(e: Element,u: Float64Array): ElementForce{
  const ug=new Float64Array(12);
  for(let q=0;q<6;q++){ ug[q]=u[e.a*6+q]; ug[6+q]=u[e.b*6+q]; }
  const ul=vecToLocal(ug,e.R);
  if(e.rel.length){
    const r=e.rel, M=[], rhs=[];
    for(const ri of r){ M.push(r.map(c=>e.k[ri*12+c])); let s=0; for(let c=0;c<12;c++) if(!r.includes(c)) s-=e.k[ri*12+c]*ul[c]; rhs.push(s); }
    const sol=gaussSolve(M,rhs); r.forEach((ri,i)=>ul[ri]=sol[i]);
  }
  const f=new Float64Array(12);
  for(let i=0;i<12;i++){ let s=0; for(let j=0;j<12;j++) s+=e.k[i*12+j]*ul[j]; f[i]=s; }
  return {ul,f};
}
const windQ = (z: number) => LV.q0*Math.pow(Math.max(z,2)/10,0.25);

function variableLoads(ctx: Context){
  const out=[];
  if(LV.type==='tower'){
    let top=-1; for(let a=0;a<ctx.NA;a++) top=Math.max(top, ctx.pos[ctx.act[a]][2]);
    const tops=[]; for(let a=0;a<ctx.NA;a++) if(ctx.pos[ctx.act[a]][2]===top && top>0) tops.push(a);
    tops.forEach(a=>out.push({a, f:LV.payload!/tops.length}));
  } else if(LV.type==='bridge'){
    const deck=[]; for(let a=0;a<ctx.NA;a++){ const [i,j,k]=parse(ctx.keys[ctx.act[a]]);
      if(k===LV.cliffH! && i>LV.cliffL! && i<LV.cliffR!) deck.push(a); }
    const tot=LV.traffic!*(LV.cliffR!-LV.cliffL!)*S;
    deck.forEach(a=>out.push({a, f:tot/deck.length}));
  } else {
    for(let a=0;a<ctx.NA;a++){ const at=model.attrs[ctx.keys[ctx.act[a]]]; if(at?.load) out.push({a, f:at.load}); }
  }
  return out;
}
function buildLoads(ctx: Context, combo: LoadCombo){
  const g=GAMMA[combo.type], F=new Float64Array(ctx.NA*6), vis=[], d=combo.dir;
  for(const e of ctx.els){ const W=e.it.w*e.L*g.G; F[e.a*6+2]-=W/2; F[e.b*6+2]-=W/2; }
  for(const {a,f} of variableLoads(ctx)){ F[a*6+2]-=f*g.Q; vis.push({a, v:[0,0,-f*g.Q], kind:'Q'}); }
  const Wn=new Float64Array(ctx.NA);
  for(const e of ctx.els){
    const zm=(ctx.pos[ctx.act[e.a]][2]+ctx.pos[ctx.act[e.b]][2])/2;
    const proj=Math.sqrt(Math.max(0,1-dot(e.ex,d)**2));
    const W=windQ(zm)*1.6*Math.max(...e.it.dim)*e.L*proj*g.W;
    Wn[e.a]+=W/2; Wn[e.b]+=W/2;
  }
  if(LV.type==='tower'){ const top=variableLoads(ctx); top.forEach(({a})=>{ Wn[a]+=windQ(ctx.pos[ctx.act[a]][2])*6*g.W/top.length; }); }
  for(let a=0;a<ctx.NA;a++){ if(!Wn[a]) continue; for(let c=0;c<3;c++) F[a*6+c]+=d[c]*Wn[a]; vis.push({a, v:d.map(c=>c*Wn[a]), kind:'W'}); }
  if(g.notional) for(let a=0;a<ctx.NA;a++){ const fz=Math.abs(F[a*6+2]); F[a*6]+=d[0]*fz/200; F[a*6+1]+=d[1]*fz/200; }
  return {F, vis};
}
function assemble(ctx: Context, active: Map<Element, boolean>){
  const {nf,els}=ctx, K=new Float64Array(nf*nf);
  for(const e of els){
    if(e.cable && !active.get(e)) continue;
    for(let i=0;i<12;i++){ const di=e.dofs[i]; if(di<0) continue; const row=di*nf;
      for(let j=0;j<12;j++){ const dj=e.dofs[j]; if(dj<0) continue; K[row+dj]+=e.kgl[i*12+j]; } }
  }
  for(let i=0;i<nf;i++) K[i*nf+i]+=1e-3; // tiny regularisation → mechanisms show as huge displacements
  return K;
}
function solveCombo(ctx: Context, F: Float64Array): {fail: true} | Solved{
  const {nf,eq,els,NA}=ctx;
  const cables=els.filter(e=>e.cable);
  const active=new Map(cables.map(e=>[e,true]));
  let u = new Float64Array(NA*6), K0 = new Float64Array(nf*nf);
  for(let iter=0; iter<10; iter++){
    const K=assemble(ctx,active); K0=K.slice();
    const Ff=new Float64Array(nf); for(let d=0; d<NA*6; d++) if(eq[d]>=0) Ff[eq[d]]+=F[d];
    // cable pretension as initial strain: active cables pull their end nodes together
    for(const e of cables){ if(!active.get(e)) continue; const P=ITEMS.cable.P0;
      for(let c=0;c<3;c++){ const da=eq[e.a*6+c], db=eq[e.b*6+c]; if(da>=0) Ff[da]+=P*e.ex[c]; if(db>=0) Ff[db]-=P*e.ex[c]; } }
    if(!cholesky(K,nf,ctx.bw)) return {fail:true};
    const x=cholSolve(K,nf,Ff,ctx.bw);
    u=new Float64Array(NA*6); for(let d=0; d<NA*6; d++) if(eq[d]>=0) u[d]=x[eq[d]];
    let changed=false;
    for(const e of cables){
      let el=0; for(let c=0;c<3;c++) el+=e.ex[c]*(u[e.b*6+c]-u[e.a*6+c]);
      const want=ITEMS.cable.P0+e.it.E*e.it.A/e.L*el>0; if(want!==active.get(e)){ active.set(e,want); changed=true; }
    }
    if(!changed) break;
  }
  const ef=new Map<Element, ElementForce>();
  for(const e of els){
    if(e.cable && !active.get(e)){ ef.set(e,{f:new Float64Array(12), ul:new Float64Array(12), slack:true}); continue; }
    const r=recover(e,u);
    if(e.cable){ r.f[0]-=ITEMS.cable.P0; r.f[6]+=ITEMS.cable.P0; }
    ef.set(e, r);
  }
  return {u, K0, active, ef};
}
function alphaCr(ctx: Context, sol: Solved){
  const {nf,els}=ctx; if(nf===0) return Infinity; if(nf>2400) return null;
  const Kg=new Float64Array(nf*nf); let comp=false;
  for(const e of els){
    if(e.cable && !sol.active.get(e)) continue;
    const N=sol.ef.get(e)!.f[6]; if(N<-1e-6) comp=true;
    if(e.rigidA&&e.rigidB){ // consistent beam geometric stiffness (captures member bending in sway/buckling)
      const L=e.L, kg=new Float64Array(144), s=(i: number,j: number,v: number)=>{ kg[i*12+j]+=v; if(i!==j) kg[j*12+i]+=v; }, c=N/L;
      for(const [a,b,c2,d,sg] of [[1,5,7,11,1],[2,4,8,10,-1]]){
        s(a,a,c*6/5); s(c2,c2,c*6/5); s(a,c2,-c*6/5);
        s(a,b,sg*c*L/10); s(a,d,sg*c*L/10); s(b,c2,-sg*c*L/10); s(c2,d,-sg*c*L/10);
        s(b,b,c*2*L*L/15); s(d,d,c*2*L*L/15); s(b,d,-c*L*L/30);
      }
      const g=toGlobal(kg,e.R);
      for(let i=0;i<12;i++){ const di=e.dofs[i]; if(di<0) continue; for(let j=0;j<12;j++){ const dj=e.dofs[j]; if(dj<0) continue; Kg[di*nf+dj]+=g[i*12+j]; } }
      continue;
    }
    const c=N/e.L;
    const G=[0,1,2].map(i=>[0,1,2].map(j=>c*((i===j?1:0)-e.ex[i]*e.ex[j])));
    const dA=[0,1,2].map(q=>e.dofs[q]), dB=[0,1,2].map(q=>e.dofs[6+q]);
    const put=(rows: number[],cols: number[],s: number)=>{ for(let i=0;i<3;i++){ if(rows[i]<0) continue; for(let j=0;j<3;j++){ if(cols[j]<0) continue; Kg[rows[i]*nf+cols[j]]+=s*G[i][j]; } } };
    put(dA,dA,1); put(dB,dB,1); put(dA,dB,-1); put(dB,dA,-1);
  }
  if(!comp) return Infinity;
  const W=new Float64Array(nf*nf);
  const pd=(lam: number)=>{ for(let i=0;i<W.length;i++) W[i]=sol.K0[i]+lam*Kg[i]; return cholesky(W,nf,ctx.bw); };
  if(!pd(1)){ let lo=0,hi=1; for(let i=0;i<7;i++){ const m=(lo+hi)/2; if(pd(m)) lo=m; else hi=m; } return lo; }
  let lo=1, hi=2;
  while(pd(hi)){ lo=hi; hi*=2; if(hi>128) return 128; }
  for(let i=0;i<6;i++){ const m=Math.sqrt(lo*hi); if(pd(m)) lo=m; else hi=m; }
  return lo;
}

/* ---------- member design ---------- */
function memberDemandULS(e: Element, r: ElementForce, amp: number){
  const {f,ul}=r, L=e.L, N=f[6];
  const out={N, Vy:0,Vz:0,My:0,Mz:0, endF:[Math.hypot(f[0],f[1],f[2]), Math.hypot(f[6],f[7],f[8])],
             endM:[Math.hypot(f[4],f[5]), Math.hypot(f[10],f[11])]};
  if(e.it.kind==='cable') return out;
  const gl=[0,0,-e.it.w*GAMMA.ULS.G], qy=dot(e.R[1],gl), qz=dot(e.R[2],gl);
  const both=e.rigidA&&e.rigidB, cm=both?1/3:1, ce=both?1/12:0;
  const beam=e.it, EIz=beam.E*beam.Iz, EIy=beam.E*beam.Iy;
  out.Vy=Math.max(Math.abs(f[1]),Math.abs(f[7]))+Math.abs(qy)*L/2;
  out.Vz=Math.max(Math.abs(f[2]),Math.abs(f[8]))+Math.abs(qz)*L/2;
  out.Mz=amp*Math.max(Math.abs(f[5])+Math.abs(qy)*L*L*ce, Math.abs(f[11])+Math.abs(qy)*L*L*ce, Math.abs(EIz*(ul[11]-ul[5])/L - qy*L*L/8*cm));
  out.My=amp*Math.max(Math.abs(f[4])+Math.abs(qz)*L*L*ce, Math.abs(f[10])+Math.abs(qz)*L*L*ce, Math.abs(EIy*(ul[4]-ul[10])/L - qz*L*L/8*cm));
  return out;
}
function memberDeflSLS(e: Element, r: ElementForce){
  if(e.it.kind==='cable') return {dEIy:0,dEIz:0};
  const ul=r.ul, L=e.L, gl=[0,0,-e.it.w], qy=dot(e.R[1],gl), qz=dot(e.R[2],gl);
  const beam=e.it, cd=(e.rigidA&&e.rigidB)?1:5, EIz=beam.E*beam.Iz, EIy=beam.E*beam.Iy;
  const dy=Math.abs(L*(ul[5]-ul[11])/8 + cd*qy*L**4/(384*EIz));
  const dz=Math.abs(L*(ul[10]-ul[4])/8 + cd*qz*L**4/(384*EIy));
  return {dEIy:dy*EIz, dEIz:dz*EIy, dy, dz};
}
const CHECK_NAMES = { strength:'Strength', shear:'Shear', buckling:'Buckling', slenderness:'Slenderness', deflection:'Deflection',
  connection:'Connection', tension:'Cable tension' };
function checkMember(section: Section, d: Demand, L: number, rA: boolean, rB: boolean){
  const c: Record<string, number>={};
  if(section.kind==='cable'){ c.tension=d.Nt/section.NRd; return c; }
  const it=section;
  const bend=d.My/(it.Wy*it.fm)+d.Mz/(it.Wz*it.fm);
  c.strength=Math.max(d.Nt/(it.A*it.ft), d.Nc/(it.A*it.fc))+bend;
  c.shear=Math.max(d.Vy/(it.Avy*it.fv), d.Vz/(it.Avz*it.fv));
  const Kf=rA&&rB?0.7:(rA||rB?0.85:1);
  const Imin=Math.min(it.Iy,it.Iz), Lc=Kf*L, lam=Lc/Math.sqrt(Imin/it.A);
  if(d.Nc>1e-3){
    const Ncr=Math.PI**2*it.E*Imin/Lc**2, lb=Math.sqrt(it.A*it.fc/Ncr);
    const ph=0.5*(1+it.alpha*(lb-it.l0)+lb*lb), chi=Math.min(1,1/(ph+Math.sqrt(Math.max(0,ph*ph-lb*lb))));
    c.buckling=d.Nc/(chi*it.A*it.fc)+bend;
  }
  c.slenderness=lam/(d.Nc>1e-3?200:300);
  c.deflection=Math.max(d.dEIy/(it.E*it.Iz), d.dEIz/(it.E*it.Iy))/(L/250);
  const conn=(F: number,M: number,rigid: boolean)=> rigid?Math.max(F/JOINT_CAP.rigidF, M/JOINT_CAP.rigidM):F/JOINT_CAP.pinF;
  c.connection=Math.max(conn(d.endF[0],d.endM[0],rA), conn(d.endF[1],d.endM[1],rB));
  return c;
}
function govern(c: Record<string, number>){ let u=0,g=''; for(const k in c) if(c[k]>u){u=c[k];g=k;} return {util:u, gov:g}; }

/* ---------- full analysis ---------- */
function analyze(){
  const t0=performance.now();
  const keys=allNodeKeys();
  const out: VoxelAnalysis={ members:{}, nodes:{}, found:{}, objectives:[], combos:[], floating:[], unstable:new Set<string>(), mechanism:false };
  if(!keys.length){ out.error='Nothing built yet.'; return out; }
  const idx=new Map(keys.map((k,n)=>[k,n]));
  const pos=keys.map(k=>parse(k).map(v=>v*S));
  const isF=keys.map(k=>!!model.attrs[k]?.found);
  const adj: number[][]=keys.map(()=>[]);
  for(const m of model.members){ const a=idx.get(m.a)!, b=idx.get(m.b)!; adj[a].push(b); adj[b].push(a); }
  const sup=new Uint8Array(keys.length), st: number[]=[];
  isF.forEach((f,n)=>{ if(f){sup[n]=1;st.push(n);} });
  while(st.length){ const n=st.pop()!; for(const o of adj[n]) if(!sup[o]){sup[o]=1;st.push(o);} }
  out.floating=keys.filter((k,n)=>!sup[n]);
  if(!isF.some(Boolean)){ out.error='No foundation — place at least one foundation on the ground.'; return out; }
  const act: number[]=[], aid=new Int32Array(keys.length).fill(-1);
  keys.forEach((k,n)=>{ if(sup[n]) act.push(n); });
  // order nodes spatially (z, x, y) to keep the stiffness matrix bandwidth small
  act.sort((p,q)=>pos[p][2]-pos[q][2] || pos[p][0]-pos[q][0] || pos[p][1]-pos[q][1]);
  act.forEach((n,a)=>aid[n]=a);
  const NA=act.length, eq=new Int32Array(NA*6); let nf=0;
  for(let a=0;a<NA;a++){ const fx=isF[act[a]]; for(let q=0;q<6;q++) eq[a*6+q]=fx?-1:nf++; }
  const els=[];
  for(const m of model.members){ const na=idx.get(m.a)!, nb=idx.get(m.b)!; if(!sup[na]) continue;
    els.push(makeElement(m,pos[na],pos[nb],aid[na],aid[nb],eq)); }
  let bw=0;
  for(const e of els){ let lo=Infinity,hi=-1; for(const d of e.dofs) if(d>=0){ lo=Math.min(lo,d); hi=Math.max(hi,d); } if(hi>=0) bw=Math.max(bw,hi-lo); }
  const ctx={keys,idx,pos,act,aid,NA,eq,nf,els,isF,bw};
  out.ctx=ctx;
  if(nf>2400){ out.error='Model too large to analyse in the browser (>400 free nodes).'; return out; }

  // ---- load combinations
  for(const combo of COMBOS){
    const {F,vis}=buildLoads(ctx,combo);
    const sol=solveCombo(ctx,F);
    if('fail' in sol){ out.mechanism=true; out.combos.push({combo,F,vis,fail:true}); continue; }
    let maxD=0;
    for(let a=0;a<NA;a++){ const d=Math.hypot(sol.u[a*6],sol.u[a*6+1],sol.u[a*6+2]); maxD=Math.max(maxD,d); if(d>0.5) out.unstable.add(keys[act[a]]); }
    if(maxD>2) out.mechanism=true;
    // reactions
    const reac: Record<number, Float64Array>={};
    for(let a=0;a<NA;a++) if(isF[act[a]]){ const r=new Float64Array(6); for(let q=0;q<6;q++) r[q]=-F[a*6+q]; reac[a]=r; }
    for(const e of els){ const fg=vecToGlobal(sol.ef.get(e)!.f,e.R);
      if(reac[e.a]) for(let q=0;q<6;q++) reac[e.a][q]+=fg[q];
      if(reac[e.b]) for(let q=0;q<6;q++) reac[e.b][q]+=fg[6+q]; }
    out.combos.push({combo,F,vis,u:sol.u,ef:sol.ef,active:sol.active,reac,maxD,sol});
  }
  if(!out.mechanism) out.unstable.clear();

  // ---- global buckling (ULS combos)
  out.alpha=[];
  if(!out.mechanism){
    out.combos.forEach((c,i)=>{ if(c.combo.type==='ULS') out.alpha!.push(alphaCr(ctx,c.sol!)); });
  }
  const aMin=out.alpha.length?Math.min(...out.alpha.map(a=>a===null?Infinity:a)):Infinity;
  out.alphaMin=aMin;
  const amp = (aMin>1 && aMin<10) ? 1/(1-1/aMin) : 1;
  out.amp=amp;
  for(const c of out.combos) delete c.sol; // free memory

  // ---- member design envelope
  let maxU=0, sumU=0, nB=0, failing=0, connMax=0;
  for(const e of els){
    const d={Nt:0,Nc:0,Vy:0,Vz:0,My:0,Mz:0,endF:[0,0],endM:[0,0],dEIy:0,dEIz:0,dmax:0}; let slack=false;
    for(const c of out.combos){
      if(c.fail) continue;
      const r=c.ef!.get(e)!;
      if(c.combo.type==='ULS'){
        if(r.slack) slack=true;
        const x=memberDemandULS(e,r,amp);
        d.Nt=Math.max(d.Nt,x.N); d.Nc=Math.max(d.Nc,-x.N);
        for(const k of (['Vy','Vz','My','Mz'] as const)) d[k]=Math.max(d[k],x[k]);
        for(const s of [0,1]){ d.endF[s]=Math.max(d.endF[s],x.endF[s]); d.endM[s]=Math.max(d.endM[s],x.endM[s]); }
      } else {
        const x=memberDeflSLS(e,r); d.dEIy=Math.max(d.dEIy,x.dEIy); d.dEIz=Math.max(d.dEIz,x.dEIz); d.dmax=Math.max(d.dmax,x.dy||0,x.dz||0);
      }
    }
    const checks=out.mechanism?{}:checkMember(e.it,d,e.L,e.rigidA,e.rigidB);
    const g=govern(checks);
    out.members[e.m.id]={e, demand:d, checks, util:g.util, gov:g.gov, slack};
    if(!out.mechanism){
      maxU=Math.max(maxU,g.util); if(g.util>1) failing++;
      if(checks.connection) connMax=Math.max(connMax,checks.connection);
      if(!e.cable){ sumU+=g.util; nB++; }
    }
  }
  out.maxU=maxU; out.avgU=nB?sumU/nB:0; out.failing=failing; out.connMax=connMax;

  // ---- foundations
  let foundMax=0;
  for(let a=0;a<NA;a++){ if(!isF[act[a]]) continue; const k=keys[act[a]], locked=!!model.attrs[k]?.locked, f=locked?3:1;
    let u=0, worst: Float64Array | null=null;
    for(const c of out.combos){ if(c.fail||c.combo.type!=='ULS') continue; const r=c.reac![a];
      const uu=Math.max(r[2]>0?r[2]/(FOUND_CAP.Nc*f):-r[2]/(FOUND_CAP.Nt*f), Math.hypot(r[0],r[1])/(FOUND_CAP.H*f), Math.hypot(r[3],r[4])/(FOUND_CAP.M*f));
      if(uu>=u){u=uu;worst=r;} }
    out.found[k]={util:u, r:worst, locked}; foundMax=Math.max(foundMax,u);
  }
  out.foundMax=foundMax;

  // ---- objectives
  const O=out.objectives, add=(ok: boolean,label: string,detail: string,warn?: boolean)=>O.push({ok,label,detail,warn});
  add(out.floating.length===0,'All parts connected to a foundation', out.floating.length?`${out.floating.length} floating node(s) ignored`:'');
  add(!out.mechanism,'Stable — no mechanism', out.mechanism?'Structure moves freely: add bracing (triangles) or moment connections':'');
  if(!out.mechanism){
    const aTxt=aMin===Infinity?'no compression':`α<sub>cr</sub> = ${aMin>=128?'>128':aMin.toFixed(2)}`;
    add(aMin>=1,'Global buckling safe (α<sub>cr</sub> ≥ 1)', aTxt+(amp>1?` · moments amplified ×${amp.toFixed(2)} (P-Δ)`:''), aMin>=1&&aMin<10);
    add(failing===0 || (connMax>1 && failing>0 && false),'Members pass design checks', `max utilisation ${(maxU*100).toFixed(0)}%${failing?` · ${failing} failing`:''}`);
    add(connMax<=1,'Connections OK', `max ${(connMax*100).toFixed(0)}% of joint capacity`);
    add(foundMax<=1,'Foundations OK', `max ${(foundMax*100).toFixed(0)}% of bearing / uplift / shear capacity`);
  }
  let topZ=-1; for(let a=0;a<NA;a++) topZ=Math.max(topZ,pos[act[a]][2]);
  out.topZ=topZ;
  if(LV.type==='tower'){
    add(topZ>=LV.target!*S,`Reach ${LV.target!*S} m height`, `top at ${topZ} m`);
    if(!out.mechanism){
      let drift=0; const tops=[]; for(let a=0;a<NA;a++) if(pos[act[a]][2]===topZ) tops.push(a);
      for(const c of out.combos){ if(c.fail||c.combo.type!=='SLS') continue; for(const a of tops) drift=Math.max(drift,Math.hypot(c.u![a*6],c.u![a*6+1])); }
      const lim=Math.max(topZ,1)/200;
      add(drift<=lim,'Top drift ≤ H/200 (SLS)', `${(drift*1000).toFixed(0)} mm (limit ${(lim*1000).toFixed(0)} mm)`);
    }
  } else if(LV.type==='bridge'){
    const deckOK=deckContinuous();
    add(deckOK,'Continuous deck between abutments', deckOK?'':`chain beams at z = ${LV.cliffH!*S} m from left to right abutment`);
    if(!out.mechanism){
      let dz=0; for(let a=0;a<NA;a++){ const [i,,k]=parse(keys[act[a]]); if(k!==LV.cliffH!||i<=LV.cliffL!||i>=LV.cliffR!) continue;
        for(const c of out.combos){ if(c.fail||c.combo.type!=='SLS') continue; dz=Math.max(dz,Math.abs(c.u![a*6+2])); } }
      const lim=(LV.cliffR!-LV.cliffL!)*S/400;
      add(dz<=lim,'Deck deflection ≤ span/400 (SLS)', `${(dz*1000).toFixed(0)} mm (limit ${(lim*1000).toFixed(0)} mm)`);
    }
  }
  out.success = O.every(o=>o.ok) && LV.type!=='sandbox' ? true : (LV.type==='sandbox' && O.every(o=>o.ok));
  out.cost=costOf(); out.mass=massOf();
  out.stars = !out.success||LV.type==='sandbox' ? 0 : out.cost<=LV.budget*0.75?3:out.cost<=LV.budget?2:1;
  out.time=performance.now()-t0;
  return out;
}
function deckContinuous(){
  const dk=LV.cliffH!, starts=LV.ys!.map(y=>key(LV.cliffL!,y,dk)), ends=new Set(LV.ys!.map(y=>key(LV.cliffR!,y,dk)));
  const adj: Record<string, string[]>={};
  for(const m of model.members){ if(ITEMS[m.type].kind!=='beam') continue; const a=parse(m.a), b=parse(m.b);
    if(a[2]!==dk||b[2]!==dk) continue; (adj[m.a]??=[]).push(m.b); (adj[m.b]??=[]).push(m.a); }
  const seen=new Set(starts), st=[...starts];
  while(st.length){ const n=st.pop()!; if(ends.has(n)) return true; for(const o of adj[n]||[]) if(!seen.has(o)){seen.add(o);st.push(o);} }
  return false;
}
function costOf(){
  let c=0; for(const m of model.members) c+=ITEMS[m.type].cost;
  for(const k in model.attrs){ const a=model.attrs[k]; if(a.joint) c+=ITEMS.joint.cost; if(a.found&&!a.locked) c+=ITEMS.found.cost; }
  return c;
}
function massOf(){ let w=0; for(const m of model.members){ const a=parse(m.a), b=parse(m.b); w+=ITEMS[m.type].w*Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])*S; } return w/9.81; }


if (!autoDesign) return analyze();
// Work on a copy so callers can commit the complete operation as one undo step.
model = { ...model, members: model.members.map(m => ({ ...m })), attrs: Object.fromEntries(Object.entries(model.attrs).map(([k, a]) => [k, { ...a }])) };
let analysis = analyze(), changedAny = false;
if (!analysis.error && !analysis.mechanism) {
  const order: BeamType[] = (['shs', 'glulam', 'ipe', 'heb'] as BeamType[]).sort((a, b) => ITEMS[a].cost - ITEMS[b].cost);
  for (let round = 0; round < 4; round++) {
    if (analysis.error || analysis.mechanism) break;
    const pool = Object.fromEntries(order.map(t => [t, LV.inv ? (LV.inv[t] || 0) : Infinity]));
    const beams = model.members.filter(m => ITEMS[m.type].kind === 'beam');
    const analysed = beams.filter(m => analysis.members[m.id]);
    beams.filter(m => !analysis.members[m.id]).forEach(m => pool[m.type]--);
    analysed.sort((a, b) => analysis.members[b.id].util - analysis.members[a.id].util);
    let changed = false;
    for (const m of analysed) {
      const r = analysis.members[m.id];
      let best: BeamType | null = null, bestU = Infinity, fallback: BeamType | null = null;
      for (const t of order) {
        if (pool[t] <= 0) continue;
        const u = govern(checkMember(ITEMS[t], r.demand, r.e.L, r.e.rigidA, r.e.rigidB)).util;
        if (u <= 0.95) { best = t; break; }
        if (u < bestU) { bestU = u; fallback = t; }
      }
      const t = best || fallback || m.type;
      pool[t]--;
      if (t !== m.type) { m.type = t; changed = true; }
    }
    if (!changed) break;
    changedAny = true;
    analysis = analyze();
  }
}
return { model, analysis, changed: changedAny };
}

/** Run the original prototype's game-specific analysis. */
export function analyzeVoxel(model: VoxelModel, level: VoxelLevel): VoxelAnalysis { return runVoxel(model, level, false); }
/** Resize beam sections from available supply and reanalyse, without mutating the input. */
export function autoDesignVoxel(model: VoxelModel, level: VoxelLevel): { model: VoxelModel; analysis: VoxelAnalysis; changed: boolean } { return runVoxel(model, level, true); }
