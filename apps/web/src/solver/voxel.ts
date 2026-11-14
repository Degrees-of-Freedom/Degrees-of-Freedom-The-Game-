import type { VoxelLevel, VoxelModel } from './voxelInput';
import type { VoxelAnalysis } from './voxelResults';
import { S } from './voxelSections';
import { parse } from './voxelCoordinates';
import { vecToGlobal } from './frameMath';
import { makeElement } from './frameElement';
import { solveCombo } from './frameSolve';
import { alphaCr } from './frameStability';
import { buildLoads, COMBOS } from './voxelLoads';
import { checkDesign } from './voxelDesignChecks';
import { evaluateObjectives } from './voxelObjectives';
export type { VoxelAnalysis } from './voxelResults';
function allNodeKeys(model: VoxelModel) {
  const keys = new Set<string>();
  for (const m of model.members) {
    keys.add(m.a);
    keys.add(m.b);
  }
  for (const k in model.attrs) {
    const a = model.attrs[k];
    if (a.found || a.joint || a.load) keys.add(k);
  }
  return [...keys];
}
/** Coordinate the game-specific prototype analysis. */
export function analyzeVoxel(
  model: VoxelModel,
  level: VoxelLevel,
): VoxelAnalysis {
  const t0 = performance.now();
  const keys = allNodeKeys(model);
  const out: VoxelAnalysis = {
    members: {},
    nodes: {},
    found: {},
    objectives: [],
    combos: [],
    floating: [],
    unstable: new Set<string>(),
    mechanism: false,
  };
  if (!keys.length) {
    out.error = 'Nothing built yet.';
    return out;
  }
  const idx = new Map(keys.map((k, n) => [k, n]));
  const pos = keys.map((k) => (model.positions?.[k] ?? parse(k)).map((v) => v * S));
  const isF = keys.map((k) => !!model.attrs[k]?.found);
  const adj: number[][] = keys.map(() => []);
  for (const m of model.members) {
    const a = idx.get(m.a)!,
      b = idx.get(m.b)!;
    adj[a].push(b);
    adj[b].push(a);
  }
  const sup = new Uint8Array(keys.length),
    st: number[] = [];
  isF.forEach((f, n) => {
    if (f) {
      sup[n] = 1;
      st.push(n);
    }
  });
  while (st.length) {
    const n = st.pop()!;
    for (const o of adj[n])
      if (!sup[o]) {
        sup[o] = 1;
        st.push(o);
      }
  }
  out.floating = keys.filter((k, n) => !sup[n]);
  if (!isF.some(Boolean)) {
    out.error = 'No foundation — place at least one foundation on the ground.';
    return out;
  }
  const act: number[] = [],
    aid = new Int32Array(keys.length).fill(-1);
  keys.forEach((k, n) => {
    if (sup[n]) act.push(n);
  });
  // order nodes spatially (z, x, y) to keep the stiffness matrix bandwidth small
  act.sort(
    (p, q) =>
      pos[p][2] - pos[q][2] || pos[p][0] - pos[q][0] || pos[p][1] - pos[q][1],
  );
  act.forEach((n, a) => (aid[n] = a));
  const NA = act.length,
    eq = new Int32Array(NA * 6);
  let nf = 0;
  for (let a = 0; a < NA; a++) {
    const attrs = model.attrs[keys[act[a]]];
    const restraint = attrs?.restraint ?? (attrs?.found ? [true, true, true, true, true, true] : [false, false, false, false, false, false]);
    for (let q = 0; q < 6; q++)
      eq[a * 6 + q] = restraint[q] || (q >= 3 && model.inactiveRotations?.has(keys[act[a]])) ? -1 : nf++;
  }
  const els = [];
  for (const m of model.members) {
    const na = idx.get(m.a)!,
      nb = idx.get(m.b)!;
    if (!sup[na]) continue;
    els.push(makeElement(model, m, pos[na], pos[nb], aid[na], aid[nb], eq));
  }
  let bw = 0;
  for (const e of els) {
    let lo = Infinity,
      hi = -1;
    for (const d of e.dofs)
      if (d >= 0) {
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
      }
    if (hi >= 0) bw = Math.max(bw, hi - lo);
  }
  const ctx = { keys, idx, pos, act, aid, NA, eq, nf, els, isF, bw };
  out.ctx = ctx;
  if (nf > 2400) {
    out.error = 'Model too large to analyse in the browser (>400 free nodes).';
    return out;
  }

  // ---- load combinations
  const combos = level.loadCase === 'applied'
    ? [{ name: 'Applied loads + self-weight', short: 'Applied loads + self-weight', type: 'SLS' as const, dir: [0, 0, 0] }]
    : COMBOS;
  for (const combo of combos) {
    const { F, vis } = buildLoads(model, level, ctx, combo);
    const sol = solveCombo(ctx, F);
    if ('fail' in sol) {
      out.mechanism = true;
      out.combos.push({ combo, F, vis, fail: true });
      continue;
    }
    let maxD = 0;
    for (let a = 0; a < NA; a++) {
      const d = Math.hypot(sol.u[a * 6], sol.u[a * 6 + 1], sol.u[a * 6 + 2]);
      maxD = Math.max(maxD, d);
      if (d > 0.5) out.unstable.add(keys[act[a]]);
    }
    if (maxD > 2) out.mechanism = true;
    // reactions
    const reac: Record<number, Float64Array> = {};
    for (let a = 0; a < NA; a++)
      if (isF[act[a]]) {
        const r = new Float64Array(6);
        for (let q = 0; q < 6; q++) r[q] = -F[a * 6 + q];
        reac[a] = r;
      }
    for (const e of els) {
      const fg = vecToGlobal(sol.ef.get(e)!.f, e.R);
      if (reac[e.a]) for (let q = 0; q < 6; q++) reac[e.a][q] += fg[q];
      if (reac[e.b]) for (let q = 0; q < 6; q++) reac[e.b][q] += fg[6 + q];
    }
    // Free axes are not support reactions even at a partially restrained node.
    for (const [a, reaction] of Object.entries(reac))
      for (let q = 0; q < 6; q++) if (eq[Number(a) * 6 + q] >= 0) reaction[q] = 0;
    out.combos.push({
      combo,
      F,
      vis,
      u: sol.u,
      ef: sol.ef,
      active: sol.active,
      reac,
      maxD,
      sol,
    });
  }
  if (!out.mechanism) out.unstable.clear();

  // ---- global buckling (ULS combos)
  out.alpha = [];
  if (!out.mechanism) {
    out.combos.forEach((c, i) => {
      if (c.combo.type === 'ULS') out.alpha!.push(alphaCr(ctx, c.sol!));
    });
  }
  const aMin = out.alpha.length
    ? Math.min(...out.alpha.map((a) => (a === null ? Infinity : a)))
    : Infinity;
  out.alphaMin = aMin;
  const amp = aMin > 1 && aMin < 10 ? 1 / (1 - 1 / aMin) : 1;
  out.amp = amp;
  for (const c of out.combos) delete c.sol; // free memory
  const design = checkDesign(model, ctx, out, amp);
  evaluateObjectives(model, level, ctx, out, aMin, amp, design);
  out.time = performance.now() - t0;
  return out;
}
