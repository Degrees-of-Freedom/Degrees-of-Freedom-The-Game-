import type { VoxelLevel, VoxelModel } from './voxelInput';
import type { VoxelAnalysis } from './voxelResults';
import { S } from './voxelSections';
import { parse } from './voxelCoordinates';
import { makeElement } from './frameElement';
import { componentSystems, findComponents, solveComponents } from './voxelComponents';
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
    designChecksAvailable: level.loadCase !== 'applied',
  };
  if (!keys.length) {
    out.error = 'Nothing built yet.';
    return out;
  }
  const idx = new Map(keys.map((k, n) => [k, n]));
  const pos = keys.map((k) => (model.positions?.[k] ?? parse(k)).map((v) => v * S));
  const isF = keys.map((k) => !!model.attrs[k]?.found);
  const { components, labels } = findComponents(keys, idx, model.members, isF);
  const sup = keys.map((_, n) => components[labels[n]].supported);
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
  // ---- load combinations
  const appliedLabel = level.appliedSelfWeight === false ? 'Applied loads only' : 'Applied loads + self-weight';
  const combos = level.loadCase === 'applied'
    ? [{ name: appliedLabel, short: appliedLabel, type: 'SLS' as const, dir: [0, 0, 0] }]
    : COMBOS;
  const systems = componentSystems(ctx, components, labels);
  const alphas = new Map<number, number>();
  out.alpha = [];
  for (const combo of combos) {
    const { F, vis } = buildLoads(model, level, ctx, combo);
    const { result, alpha, componentAlpha } = solveComponents(ctx, systems, components, combo, F, vis);
    if (combo.type === 'ULS') out.alpha.push(alpha);
    for (const [id, factor] of componentAlpha) alphas.set(id, Math.min(alphas.get(id) ?? Infinity, factor));
    for (const scope of result.components!) {
      if (scope.status === 'mechanism' || scope.status === 'excessive-displacement') {
        out.mechanism = true;
        for (const key of scope.nodes) out.unstable.add(key);
      }
      if (scope.status === 'unresolved') out.unresolved = true;
    }
    out.combos.push(result);
  }
  const aMin = out.alpha.length
    ? Math.min(...out.alpha.map((a) => (a === null ? Infinity : a)))
    : Infinity;
  if (out.designChecksAvailable && !out.mechanism && !out.unresolved) out.alphaMin = aMin;
  const amp = aMin > 1 && aMin < 10 ? 1 / (1 - 1 / aMin) : 1;
  if (out.designChecksAvailable && !out.mechanism && !out.unresolved) out.amp = amp;
  const design = checkDesign(model, ctx, out, alphas);
  evaluateObjectives(model, level, ctx, out, aMin, amp, design);
  out.time = performance.now() - t0;
  return out;
}
