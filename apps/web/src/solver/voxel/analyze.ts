import type { VoxelLevel, VoxelModel } from '../../evaluator/model';
import { allNodeKeys, prepareGeometry } from '../../evaluator/geometry';
import type { Context, VoxelAnalysis } from './types';
import { makeElement } from './frameElement';
import { componentSystems, solveComponents } from './components';
import { buildLoads, COMBOS } from '../../evaluator/loads';
import { checkDesign } from '../../evaluator/designChecks';
import { evaluateObjectives } from '../../evaluator/objectives';
export type { VoxelAnalysis } from './types';
/** Legacy kernel numbering on top of the shared geometry: one equation per
 * unrestrained DOF of each supported node, and element stiffness. */
export function prepareTurnGeometry(model: VoxelModel, keys = allNodeKeys(model)) {
  const { ctx: geometry, components, labels, floating } = prepareGeometry(model, keys);
  const { NA, act } = geometry;
  const eq = new Int32Array(NA * 6);
  let nf = 0;
  for (let a = 0; a < NA; a++) {
    const attrs = model.attrs[keys[act[a]]];
    const restraint = attrs?.restraint ?? (attrs?.found ? [true, true, true, true, true, true] : [false, false, false, false, false, false]);
    for (let q = 0; q < 6; q++)
      eq[a * 6 + q] = restraint[q] || (q >= 3 && model.inactiveRotations?.has(keys[act[a]])) ? -1 : nf++;
  }
  const els = geometry.els.map((e) => makeElement(model, e.m, geometry.pos[act[e.a]], geometry.pos[act[e.b]], e.a, e.b, eq));
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
  const ctx: Context = { ...geometry, eq, nf, els, bw };
  return { ctx, components, labels, floating };
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
  const {ctx, components, labels, floating} = prepareTurnGeometry(model, keys);
  out.floating = floating;
  if (!ctx.isF.some(Boolean)) {
    out.error = 'No foundation — place at least one foundation on the ground.';
    return out;
  }
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
