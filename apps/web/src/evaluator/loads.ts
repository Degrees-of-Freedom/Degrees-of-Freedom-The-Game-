import type { EvaluatorLevel, EvaluatorModel } from './model';
import type { Context, Element, LoadCombo } from './results';
import { dot } from './vector';
import { S } from './sections';
import { parse } from './coordinates';
export const GAMMA = {
  ULS: { G: 1.35, Q: 1.5, W: 0.9, notional: true },
  SLS: { G: 1, Q: 1, W: 0.6, notional: false },
};
export const COMBOS: LoadCombo[] = [
  {
    name: 'ULS · 1.35G+1.5Q+0.9Wx',
    short: 'ULS wind X',
    type: 'ULS',
    dir: [1, 0, 0],
  },
  {
    name: 'ULS · 1.35G+1.5Q+0.9Wy',
    short: 'ULS wind Y',
    type: 'ULS',
    dir: [0, 1, 0],
  },
  { name: 'SLS · G+Q+0.6Wx', short: 'SLS wind X', type: 'SLS', dir: [1, 0, 0] },
  { name: 'SLS · G+Q+0.6Wy', short: 'SLS wind Y', type: 'SLS', dir: [0, 1, 0] },
];
const windQ = (LV: EvaluatorLevel, z: number) =>
  LV.q0 * Math.pow(Math.max(z, 2) / 10, 0.25);

const directions: Record<NonNullable<EvaluatorModel['attrs'][string]['loadDirection']>, [number, number, number]> = {
  '-Z': [0, 0, -1], '+Z': [0, 0, 1], '+X': [1, 0, 0], '-X': [-1, 0, 0], '+Y': [0, 1, 0], '-Y': [0, -1, 0],
};
function variableLoads(model: EvaluatorModel, LV: EvaluatorLevel, ctx: Context) {
  const out: { a: number; f: number; direction: [number, number, number] }[] = [];
  if (LV.type === 'tower') {
    let top = -1;
    for (let a = 0; a < ctx.NA; a++)
      top = Math.max(top, ctx.pos[ctx.act[a]][2]);
    const tops = [];
    for (let a = 0; a < ctx.NA; a++)
      if (ctx.pos[ctx.act[a]][2] === top && top > 0) tops.push(a);
    tops.forEach((a) => out.push({ a, f: LV.payload! / tops.length, direction: [0, 0, -1] }));
  } else if (LV.type === 'bridge') {
    const deck = [];
    for (let a = 0; a < ctx.NA; a++) {
      const [i, j, k] = parse(ctx.keys[ctx.act[a]]);
      if (k === LV.cliffH! && i > LV.cliffL! && i < LV.cliffR!) deck.push(a);
    }
    const tot = LV.traffic! * (LV.cliffR! - LV.cliffL!) * S;
    deck.forEach((a) => out.push({ a, f: tot / deck.length, direction: [0, 0, -1] }));
  } else {
    for (let a = 0; a < ctx.NA; a++) {
      const at = model.attrs[ctx.keys[ctx.act[a]]];
      if (at?.load) out.push({ a, f: at.load, direction: directions[at.loadDirection ?? '-Z'] });
    }
  }
  return out;
}
export function buildLoads(
  model: EvaluatorModel,
  LV: EvaluatorLevel,
  ctx: Context,
  combo: LoadCombo,
) {
  const g = GAMMA[combo.type],
    F = new Float64Array(ctx.NA * 6),
    vis = [],
    d = combo.dir;
  if (LV.loadCase !== 'applied' || LV.appliedSelfWeight !== false) {
    for (const e of ctx.els) {
      const span = e.m.parentSpan?.assemblyPart ? undefined : e.m.parentSpan;
      // Existing voxel self-weight is lumped at the original element ends.
      // Adding an interior connector must not move that existing load.
      const length = span ? e.L * 4 / (span.toQuarter - span.fromQuarter) : e.L;
      const halfWeight = e.it.w * length * g.G / 2;
      if (!span || span.fromQuarter === 0) F[e.a * 6 + 2] -= halfWeight;
      if (!span || span.toQuarter === 4) F[e.b * 6 + 2] -= halfWeight;
    }
  }
  for (const { a, f, direction } of variableLoads(model, LV, ctx)) {
    const vector = direction.map((component) => component * f * g.Q);
    for (let c = 0; c < 3; c++) F[a * 6 + c] += vector[c];
    vis.push({ a, v: vector, kind: 'Q' });
  }
  const Wn = new Float64Array(ctx.NA);
  for (const e of ctx.els) {
    const zm = (ctx.pos[ctx.act[e.a]][2] + ctx.pos[ctx.act[e.b]][2]) / 2;
    const proj = Math.sqrt(Math.max(0, 1 - dot(e.ex, d) ** 2));
    const W = windQ(LV, zm) * 1.6 * Math.max(...e.it.dim) * e.L * proj * g.W;
    Wn[e.a] += W / 2;
    Wn[e.b] += W / 2;
  }
  if (LV.type === 'tower') {
    const top = variableLoads(model, LV, ctx);
    top.forEach(({ a }) => {
      Wn[a] += (windQ(LV, ctx.pos[ctx.act[a]][2]) * 6 * g.W) / top.length;
    });
  }
  for (let a = 0; a < ctx.NA; a++) {
    if (!Wn[a]) continue;
    for (let c = 0; c < 3; c++) F[a * 6 + c] += d[c] * Wn[a];
    vis.push({ a, v: d.map((c) => c * Wn[a]), kind: 'W' });
  }
  if (g.notional)
    for (let a = 0; a < ctx.NA; a++) {
      const fz = Math.abs(F[a * 6 + 2]);
      F[a * 6] += (d[0] * fz) / 200;
      F[a * 6 + 1] += (d[1] * fz) / 200;
    }
  return { F, vis };
}

/**
 * One design combination in the form the Rust solver takes: unlumped. The
 * physical actions are those of `buildLoads`, but self-weight and wind on
 * members stay distributed along the member, so the engine's cut forces
 * include them and no midspan correction is needed afterwards.
 *
 * - Self-weight: the card weight per metre times the permanent factor, as a
 *   gravity multiplier (zero when the level excludes it).
 * - Variable loads (tower payload, bridge traffic, placed loads): nodal,
 *   times the variable factor.
 * - Wind: a uniform load per metre on each member, from the pressure at its
 *   mid-height, its exposed width and its projection normal to the wind;
 *   a tower also takes a nodal wind on its top nodes.
 * - Notional sway (ultimate combinations): 1/200 of the vertical load,
 *   horizontally along the wind. Applied per metre for self-weight and per
 *   node for the vertical part of the variable loads. The voxel kernel took
 *   1/200 of the summed nodal vertical load instead; the two agree when no
 *   variable load points upwards.
 *
 * Forces are kN and kN/m. `F` and `vis` are the nodal-equivalent loads for
 * display and load-path bookkeeping only; member loads are lumped half to
 * each end there.
 */
export interface DesignLoadCase {
  combo: LoadCombo;
  selfWeightFactor: number;
  nodal: Map<number, [number, number, number]>;
  members: Map<Element, [number, number, number]>;
  F: Float64Array;
  vis: { a: number; v: number[]; kind: string }[];
}

export function designLoadCase(
  model: EvaluatorModel,
  LV: EvaluatorLevel,
  ctx: Context,
  combo: LoadCombo,
): DesignLoadCase {
  const g = GAMMA[combo.type],
    d = combo.dir;
  const selfWeightFactor = LV.loadCase !== 'applied' || LV.appliedSelfWeight !== false ? g.G : 0;
  const nodal = new Map<number, [number, number, number]>();
  const members = new Map<Element, [number, number, number]>();
  const F = new Float64Array(ctx.NA * 6);
  const vis: DesignLoadCase['vis'] = [];
  const addNodal = (a: number, v: number[]) => {
    const at = nodal.get(a) ?? [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      at[c] += v[c];
      F[a * 6 + c] += v[c];
    }
    nodal.set(a, at);
  };
  const addMember = (e: Element, perMetre: number[]) => {
    const at = members.get(e) ?? [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      at[c] += perMetre[c];
      F[e.a * 6 + c] += (perMetre[c] * e.L) / 2;
      F[e.b * 6 + c] += (perMetre[c] * e.L) / 2;
    }
    members.set(e, at);
  };
  for (const e of ctx.els) {
    const w = e.it.w * selfWeightFactor;
    if (!w) continue;
    // Self-weight goes to the engine as gravity; F only records it.
    F[e.a * 6 + 2] -= (w * e.L) / 2;
    F[e.b * 6 + 2] -= (w * e.L) / 2;
    if (g.notional) addMember(e, [(d[0] * w) / 200, (d[1] * w) / 200, 0]);
  }
  const variable = variableLoads(model, LV, ctx);
  for (const { a, f, direction } of variable) {
    const vector = direction.map((component) => component * f * g.Q);
    addNodal(a, vector);
    vis.push({ a, v: vector, kind: 'Q' });
    if (g.notional && vector[2]) {
      const sway = Math.abs(vector[2]) / 200;
      addNodal(a, [d[0] * sway, d[1] * sway, 0]);
    }
  }
  const windAt = new Float64Array(ctx.NA);
  // The applied-load case has no wind direction.
  const windy = d.some((c) => c !== 0);
  for (const e of windy ? ctx.els : []) {
    const zm = (ctx.pos[ctx.act[e.a]][2] + ctx.pos[ctx.act[e.b]][2]) / 2;
    const proj = Math.sqrt(Math.max(0, 1 - dot(e.ex, d) ** 2));
    const perMetre = windQ(LV, zm) * 1.6 * Math.max(...e.it.dim) * proj * g.W;
    if (!perMetre) continue;
    addMember(e, d.map((c) => c * perMetre));
    windAt[e.a] += (perMetre * e.L) / 2;
    windAt[e.b] += (perMetre * e.L) / 2;
  }
  if (windy && LV.type === 'tower') {
    variable.forEach(({ a }) => {
      const W = (windQ(LV, ctx.pos[ctx.act[a]][2]) * 6 * g.W) / variable.length;
      if (!W) return;
      addNodal(a, d.map((c) => c * W));
      windAt[a] += W;
    });
  }
  for (let a = 0; a < ctx.NA; a++)
    if (windAt[a]) vis.push({ a, v: d.map((c) => c * windAt[a]), kind: 'W' });
  return { combo, selfWeightFactor, nodal, members, F, vis };
}
