import { GAMMA } from './loads';
import { dot } from './vector';
import type { EvaluatorModel } from './model';
import type {
  Context,
  Demand,
  Element,
  ElementForce,
  StructureEvaluation,
} from './results';
import type { Section } from './sections';
import { CARD_STRENGTH } from './capacity';
const FOUND_CAP = { Nc: 1500, Nt: 250, H: 350, M: 300 }; // kN, kNm
/** Ultimate demand on one member under one combination. With an engine
 * envelope the cut forces are used as they are. Otherwise (the legacy linear
 * kernel, which lumps self-weight at the member ends) the end forces are
 * corrected for the member's own weight and amplified by `amp` for P-Δ. */
function memberDemandULS(e: Element, r: ElementForce, amp: number) {
  const endF = [Math.hypot(r.f[0], r.f[1], r.f[2]), Math.hypot(r.f[6], r.f[7], r.f[8])],
    endM = [Math.hypot(r.f[4], r.f[5]), Math.hypot(r.f[10], r.f[11])];
  if (r.envelope) {
    const { Nt, Nc, Vy, Vz, My, Mz } = r.envelope;
    const tension = r.cableTension;
    return e.it.kind === 'beam'
      ? { Nt, Nc, Vy, Vz, My, Mz, endF, endM }
      : { Nt: tension ?? Nt, Nc: tension === undefined ? Nc : 0, Vy: 0, Vz: 0, My: 0, Mz: 0, endF, endM };
  }
  const { f, ul } = r,
    L = e.L,
    N = r.cableTension ?? f[6];
  const out = {
    Nt: Math.max(N, 0),
    Nc: Math.max(-N, 0),
    Vy: 0,
    Vz: 0,
    My: 0,
    Mz: 0,
    endF,
    endM,
  };
  if (e.it.kind !== 'beam') return out;
  const gl = [0, 0, -e.it.w * GAMMA.ULS.G],
    qy = dot(e.R[1], gl),
    qz = dot(e.R[2], gl);
  const both = e.rigidA && e.rigidB,
    cm = both ? 1 / 3 : 1,
    ce = both ? 1 / 12 : 0;
  const beam = e.it,
    EIz = beam.E * beam.Iz,
    EIy = beam.E * beam.Iy;
  out.Vy = Math.max(Math.abs(f[1]), Math.abs(f[7])) + (Math.abs(qy) * L) / 2;
  out.Vz = Math.max(Math.abs(f[2]), Math.abs(f[8])) + (Math.abs(qz) * L) / 2;
  out.Mz =
    amp *
    Math.max(
      Math.abs(f[5]) + Math.abs(qy) * L * L * ce,
      Math.abs(f[11]) + Math.abs(qy) * L * L * ce,
      Math.abs((EIz * (ul[11] - ul[5])) / L - ((qy * L * L) / 8) * cm),
    );
  out.My =
    amp *
    Math.max(
      Math.abs(f[4]) + Math.abs(qz) * L * L * ce,
      Math.abs(f[10]) + Math.abs(qz) * L * L * ce,
      Math.abs((EIy * (ul[4] - ul[10])) / L - ((qz * L * L) / 8) * cm),
    );
  return out;
}
/** Serviceability deflection of a beam as deflection × EI about each axis,
 * so that auto-design can rescale it for another section. An engine's chord
 * sag is used for both axes; the legacy kernel estimates each axis from end
 * rotations and the member's own weight. */
function memberDeflSLS(e: Element, r: ElementForce) {
  if (e.it.kind !== 'beam') return { dEIy: 0, dEIz: 0 };
  if (r.sag !== undefined) {
    const EIz = e.it.E * e.it.Iz, EIy = e.it.E * e.it.Iy;
    return { dEIy: r.sag * EIz, dEIz: r.sag * EIy, dy: r.sag, dz: r.sag };
  }
  const ul = r.ul,
    L = e.L,
    gl = [0, 0, -e.it.w],
    qy = dot(e.R[1], gl),
    qz = dot(e.R[2], gl);
  const beam = e.it,
    cd = e.rigidA && e.rigidB ? 1 : 5,
    EIz = beam.E * beam.Iz,
    EIy = beam.E * beam.Iy;
  const dy = Math.abs(
    (L * (ul[5] - ul[11])) / 8 + (cd * qy * L ** 4) / (384 * EIz),
  );
  const dz = Math.abs(
    (L * (ul[10] - ul[4])) / 8 + (cd * qz * L ** 4) / (384 * EIy),
  );
  return { dEIy: dy * EIz, dEIz: dz * EIy, dy, dz };
}
export function checkMember(
  section: Section,
  d: Demand,
  L: number,
  rA: boolean,
  rB: boolean,
) {
  const c: Record<string, number> = {};
  if (section.kind === 'spring') {
    c.axial = Math.max(d.Nc, d.Nt) / (section.axialForceLimitN / 1000);
    return c;
  }
  if (section.kind === 'cable') {
    c.tension = d.Nt / section.NRd;
    return c;
  }
  const it = section;
  const bend = d.My / (it.Wy * it.fm) + d.Mz / (it.Wz * it.fm);
  c.strength = Math.max(d.Nt / (it.A * it.ft), d.Nc / (it.A * it.fc)) + bend;
  c.shear = Math.max(d.Vy / (it.Avy * it.fv), d.Vz / (it.Avz * it.fv));
  const Kf = rA && rB ? 0.7 : rA || rB ? 0.85 : 1;
  const Imin = Math.min(it.Iy, it.Iz),
    Lc = Kf * L,
    lam = Lc / Math.sqrt(Imin / it.A);
  if (d.Nc > 1e-3) {
    const Ncr = (Math.PI ** 2 * it.E * Imin) / Lc ** 2,
      lb = Math.sqrt((it.A * it.fc) / Ncr);
    const ph = 0.5 * (1 + it.alpha * (lb - it.l0) + lb * lb),
      chi = Math.min(1, 1 / (ph + Math.sqrt(Math.max(0, ph * ph - lb * lb))));
    c.buckling = d.Nc / (chi * it.A * it.fc) + bend;
  }
  c.slenderness = lam / (d.Nc > 1e-3 ? 200 : 300);
  c.deflection =
    Math.max(d.dEIy / (it.E * it.Iz), d.dEIz / (it.E * it.Iy)) / (L / 250);
  const conn = (F: number, M: number, rigid: boolean) =>
    rigid
      ? Math.max(F / CARD_STRENGTH.connections.fixed.force, M / CARD_STRENGTH.connections.fixed.moment)
      : F / CARD_STRENGTH.connections.ball.force;
  c.connection = Math.max(
    conn(d.endF[0], d.endM[0], rA),
    conn(d.endF[1], d.endM[1], rB),
  );
  return c;
}
export function govern(c: Record<string, number>) {
  let u = 0,
    g = '';
  for (const k in c)
    if (c[k] > u) {
      u = c[k];
      g = k;
    }
  return { util: u, gov: g };
}
export function checkDesign(
  model: EvaluatorModel,
  ctx: Context,
  out: StructureEvaluation,
  alphas: ReadonlyMap<number, number>,
) {
  const { els, NA, isF, act, keys } = ctx;
  // ---- member design envelope
  let maxU = 0,
    sumU = 0,
    nB = 0,
    failing = 0,
    connMax = 0;
  for (const e of els) {
    if (!out.combos.some(c => c.ef?.has(e))) continue;
    const complete = out.combos.every(c => c.ef?.has(e));
    const alpha = alphas.get(e.m.id) ?? Infinity;
    const amp = alpha > 1 && alpha < 10 ? 1 / (1 - 1 / alpha) : 1;
    const d = {
      Nt: 0,
      Nc: 0,
      Vy: 0,
      Vz: 0,
      My: 0,
      Mz: 0,
      endF: [0, 0],
      endM: [0, 0],
      dEIy: 0,
      dEIz: 0,
      dmax: 0,
    };
    let slack = false;
    for (const c of out.combos) {
      const r = c.ef?.get(e);
      if (!r) continue;
      if (c.combo.type === 'ULS') {
        if (r.slack) slack = true;
        const x = memberDemandULS(e, r, amp);
        d.Nt = Math.max(d.Nt, x.Nt);
        d.Nc = Math.max(d.Nc, x.Nc);
        for (const k of ['Vy', 'Vz', 'My', 'Mz'] as const)
          d[k] = Math.max(d[k], x[k]);
        for (const s of [0, 1]) {
          d.endF[s] = Math.max(d.endF[s], x.endF[s]);
          d.endM[s] = Math.max(d.endM[s], x.endM[s]);
        }
      } else {
        const x = memberDeflSLS(e, r);
        d.dEIy = Math.max(d.dEIy, x.dEIy);
        d.dEIz = Math.max(d.dEIz, x.dEIz);
        d.dmax = Math.max(d.dmax, x.dy || 0, x.dz || 0);
      }
    }
    const checks = !complete || !out.designChecksAvailable
      ? {}
      : checkMember(e.it, d, e.L, e.rigidA, e.rigidB);
    const g = govern(checks);
    out.members[e.m.id] = {
      e,
      demand: d,
      checks,
      util: g.util,
      gov: complete && out.designChecksAvailable ? g.gov : 'Not assessed',
      slack,
    };
    if (complete && out.designChecksAvailable) {
      maxU = Math.max(maxU, g.util);
      if (g.util > 1) failing++;
      if (checks.connection) connMax = Math.max(connMax, checks.connection);
      if (!e.cable) {
        sumU += g.util;
        nB++;
      }
    }
  }
  if (out.designChecksAvailable && !out.mechanism && !out.unresolved) {
    out.maxU = maxU;
    out.avgU = nB ? sumU / nB : 0;
    out.failing = failing;
    out.connMax = connMax;
  }

  // ---- foundations
  let foundMax = 0;
  for (let a = 0; a < NA; a++) {
    if (!isF[act[a]]) continue;
    const k = keys[act[a]],
      locked = !!model.attrs[k]?.locked,
      f = locked ? 3 : 1;
    let u = 0,
      worst: Float64Array | null = null;
    for (const c of out.combos) {
      if (c.fail || c.combo.type !== 'ULS') continue;
      const r = c.reac?.[a];
      if (!r) continue;
      const uu = Math.max(
        r[2] > 0 ? r[2] / (FOUND_CAP.Nc * f) : -r[2] / (FOUND_CAP.Nt * f),
        Math.hypot(r[0], r[1]) / (FOUND_CAP.H * f),
        Math.hypot(r[3], r[4]) / (FOUND_CAP.M * f),
      );
      if (uu >= u) {
        u = uu;
        worst = r;
      }
    }
    out.found[k] = { util: u, r: worst, locked };
    foundMax = Math.max(foundMax, u);
  }
  if (out.designChecksAvailable && !out.mechanism && !out.unresolved) out.foundMax = foundMax;
  return { maxU, failing, connMax, foundMax };
}
