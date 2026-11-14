import type { VoxelLevel, VoxelModel } from './voxelInput';
import type { Context, VoxelAnalysis } from './voxelResults';
import { ITEMS, S } from './voxelSections';
import { key, parse } from './voxelCoordinates';
function deckContinuous(model: VoxelModel, LV: VoxelLevel) {
  const dk = LV.cliffH!,
    starts = LV.ys!.map((y) => key(LV.cliffL!, y, dk)),
    ends = new Set(LV.ys!.map((y) => key(LV.cliffR!, y, dk)));
  const adj: Record<string, string[]> = {};
  for (const m of model.members) {
    if (ITEMS[m.type].kind !== 'beam') continue;
    const a = parse(m.a),
      b = parse(m.b);
    if (a[2] !== dk || b[2] !== dk) continue;
    (adj[m.a] ??= []).push(m.b);
    (adj[m.b] ??= []).push(m.a);
  }
  const seen = new Set(starts),
    st = [...starts];
  while (st.length) {
    const n = st.pop()!;
    if (ends.has(n)) return true;
    for (const o of adj[n] || [])
      if (!seen.has(o)) {
        seen.add(o);
        st.push(o);
      }
  }
  return false;
}
function costOf(model: VoxelModel) {
  let c = 0;
  for (const m of model.members) c += ITEMS[m.type].cost;
  for (const k in model.attrs) {
    const a = model.attrs[k];
    if (a.joint) c += ITEMS.joint.cost;
    if (a.found && !a.locked) c += ITEMS.found.cost;
  }
  return c;
}
function massOf(model: VoxelModel) {
  let w = 0;
  for (const m of model.members) {
    const a = model.positions?.[m.a] ?? parse(m.a),
      b = model.positions?.[m.b] ?? parse(m.b);
    w +=
      ITEMS[m.type].w * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * S;
  }
  return w / 9.81;
}
export function evaluateObjectives(
  model: VoxelModel,
  LV: VoxelLevel,
  ctx: Context,
  out: VoxelAnalysis,
  aMin: number,
  amp: number,
  {
    maxU,
    failing,
    connMax,
    foundMax,
  }: { maxU: number; failing: number; connMax: number; foundMax: number },
) {
  const { keys, idx, aid, pos, act, NA } = ctx;
  // ---- objectives
  const O = out.objectives,
    add = (ok: boolean, label: string, detail: string, warn?: boolean) =>
      O.push({ ok, label, detail, warn });
  const targets = keys.filter((k) => model.attrs[k]?.target),
    loose = out.floating.filter((k) => !model.attrs[k]?.target);
  if (targets.length) {
    const got = targets.filter((k) => !out.floating.includes(k)).length;
    add(
      got === targets.length,
      `Pick up all weights (${got}/${targets.length})`,
      got < targets.length
        ? 'red weights are not yet connected to a foundation'
        : '',
    );
  }
  add(
    loose.length === 0,
    'All parts connected to a foundation',
    loose.length ? `${loose.length} floating node(s) ignored` : '',
  );
  add(
    !out.mechanism,
    'Stable — no mechanism',
    out.mechanism
      ? 'Structure moves freely: add bracing (triangles) or moment connections'
      : '',
  );
  if (!out.mechanism && out.designChecksAvailable) {
    const aTxt =
      aMin === Infinity
        ? 'no compression'
        : `α<sub>cr</sub> = ${aMin >= 128 ? '>128' : aMin.toFixed(2)}`;
    add(
      aMin >= 1,
      'Global buckling safe (α<sub>cr</sub> ≥ 1)',
      aTxt + (amp > 1 ? ` · moments amplified ×${amp.toFixed(2)} (P-Δ)` : ''),
      aMin >= 1 && aMin < 10,
    );
    add(
      failing === 0,
      'Members pass design checks',
      `max utilisation ${(maxU * 100).toFixed(0)}%${failing ? ` · ${failing} failing` : ''}`,
    );
    add(
      connMax <= 1,
      'Connections OK',
      `max ${(connMax * 100).toFixed(0)}% of joint capacity`,
    );
    add(
      foundMax <= 1,
      'Foundations OK',
      `max ${(foundMax * 100).toFixed(0)}% of bearing / uplift / shear capacity`,
    );
  }
  let topZ = -1;
  for (let a = 0; a < NA; a++) topZ = Math.max(topZ, pos[act[a]][2]);
  out.topZ = topZ;
  if (LV.type === 'tower') {
    add(
      topZ >= LV.target! * S,
      `Reach ${LV.target! * S} m height`,
      `top at ${topZ} m`,
    );
    if (!out.mechanism) {
      let drift = 0;
      const tops = [];
      for (let a = 0; a < NA; a++) if (pos[act[a]][2] === topZ) tops.push(a);
      for (const c of out.combos) {
        if (c.fail || c.combo.type !== 'SLS') continue;
        for (const a of tops)
          drift = Math.max(drift, Math.hypot(c.u![a * 6], c.u![a * 6 + 1]));
      }
      const lim = Math.max(topZ, 1) / 200;
      add(
        drift <= lim,
        'Top drift ≤ H/200 (SLS)',
        `${(drift * 1000).toFixed(0)} mm (limit ${(lim * 1000).toFixed(0)} mm)`,
      );
    }
  } else if (LV.type === 'bridge') {
    const deckOK = deckContinuous(model, LV);
    add(
      deckOK,
      'Continuous deck between abutments',
      deckOK
        ? ''
        : `chain beams at z = ${LV.cliffH! * S} m from left to right abutment`,
    );
    if (!out.mechanism) {
      let dz = 0;
      for (let a = 0; a < NA; a++) {
        const [i, , k] = parse(keys[act[a]]);
        if (k !== LV.cliffH! || i <= LV.cliffL! || i >= LV.cliffR!) continue;
        for (const c of out.combos) {
          if (c.fail || c.combo.type !== 'SLS') continue;
          dz = Math.max(dz, Math.abs(c.u![a * 6 + 2]));
        }
      }
      const lim = ((LV.cliffR! - LV.cliffL!) * S) / 400;
      add(
        dz <= lim,
        'Deck deflection ≤ span/400 (SLS)',
        `${(dz * 1000).toFixed(0)} mm (limit ${(lim * 1000).toFixed(0)} mm)`,
      );
    }
  }
  if (LV.type === 'pickup' && !out.mechanism) {
    let worst = 0,
      txt = '';
    for (const k of targets) {
      const n = idx.get(k)!;
      if (aid[n] < 0) continue;
      const a = aid[n],
        [, , kk] = parse(k),
        lim = (Math.max(1, kk - (LV.groundHeights?.[k] ?? 0)) * S) / 250;
      for (const c of out.combos) {
        if (c.fail || c.combo.type !== 'SLS') continue;
        const d = Math.hypot(c.u![a * 6], c.u![a * 6 + 1], c.u![a * 6 + 2]);
        if (d / lim > worst) {
          worst = d / lim;
          txt = `${(d * 1000).toFixed(0)} mm at the ${model.attrs[k].load} kN weight (limit ${(lim * 1000).toFixed(0)} mm)`;
        }
      }
    }
    if (targets.some((k) => aid[idx.get(k)!] >= 0))
      add(worst <= 1, 'Weights move ≤ height/250 (SLS)', txt);
  }
  out.success = out.designChecksAvailable && (
    O.every((o) => o.ok) && LV.type !== 'sandbox'
      ? true
      : LV.type === 'sandbox' && O.every((o) => o.ok));
  out.cost = costOf(model);
  out.mass = massOf(model);
  out.stars =
    !out.success || LV.type === 'sandbox'
      ? 0
      : out.cost <= LV.budget * 0.75
        ? 3
        : out.cost <= LV.budget
          ? 2
          : 1;
}
