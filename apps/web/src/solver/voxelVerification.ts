import { dot, vecToGlobal, vecToLocal } from './frameMath';
import { displacementAt, type Combo, type Context, type Element } from './voxelResults';

/** Evidence for the small-displacement, linear-elastic Euler–Bernoulli frame only.
 * This does not certify capacity, nonlinear stability, or post-buckling response.
 * Force, length, moment and rotation units are kN, m, kN·m and radians.
 */
export interface LinearVerification {
  formulation: 'voxel-linear-frame-v1';
  status: 'verified-linear' | 'unverified';
  reason?: string;
  residuals?: {
    force: number;
    moment: number;
    nodalBalance: number;
    memberLaw: number;
    compatibility: number;
    releasedAction: number;
  };
}

const formulation = 'voxel-linear-frame-v1';
const residualLimit = 1e-5;
const compatibilityLimit = 1e-9;
// Provisional analysis envelope. Beyond it, reaction-based decisions must await
// nonlinear verification. The modal screen uses the same amplification boundary
// as the browser design solver. It is not a critical-load acceptance test.
const smallMotion = 0.01;
export const minimumBucklingFactor = 10;

function unknown(reason: string): LinearVerification {
  return { formulation, status: 'unverified', reason };
}

/** Independently assemble the recovered end actions at the joints and compare
 * the published result with both local laws and external six-axis equilibrium.
 * The origin for moments is inside this component, avoiding a dependence on
 * the board origin. `active` and the elements use the original solver numbering.
 */
export function verifyLinearResponse(
  ctx: Context, combo: Combo, active: number[], elements: Element[], bucklingFactor: number | null,
): LinearVerification {
  if (!active.length || !combo.ef || !combo.reac) return unknown('Response unavailable.');
  if (elements.some(e => e.cable)) return unknown('Cable active-state and nonlinear equilibrium are outside this verification.');
  if (bucklingFactor === null || !(bucklingFactor >= minimumBucklingFactor)) {
    return unknown('Stability screen requires second-order verification.');
  }

  const origin = ctx.pos[ctx.act[active[0]]];
  const applied = new Float64Array(6);
  const imbalance = new Map<number, Float64Array>();
  let length = 0, appliedForce = 0, appliedCouple = 0, compatibility = 0;
  for (const a of active) {
    const u = displacementAt(combo, a);
    if (!u || !u.every(Number.isFinite)) return unknown('Displacement unavailable.');
    const f = combo.F.subarray(6 * a, 6 * a + 6);
    const reaction = combo.reac[a];
    if (ctx.isF[ctx.act[a]] && !reaction) return unknown('Support reaction unavailable.');
    const external = Float64Array.from(f, (value, q) => value + (reaction?.[q] ?? 0));
    if (!external.every(Number.isFinite)) return unknown('Nonfinite external action.');
    const [x, y, z] = ctx.pos[ctx.act[a]].map((v, i) => v - origin[i]);
    length = Math.max(length, Math.hypot(x, y, z));
    appliedForce += Math.hypot(f[0], f[1], f[2]);
    appliedCouple += Math.hypot(f[3], f[4], f[5]);
    for (let q = 0; q < 6; q++) applied[q] += external[q];
    applied[3] += y * external[2] - z * external[1];
    applied[4] += z * external[0] - x * external[2];
    applied[5] += x * external[1] - y * external[0];
    imbalance.set(a, external);
  }
  // Absolute floors allow unloaded components and near-zero components of
  // signed vectors. They imply 1e-8 kN and at least 1e-8 kN·m at the gate.
  const forceScale = Math.max(1e-3, appliedForce);
  const momentScale = Math.max(1e-3, appliedCouple + length * appliedForce);
  const lengthScale = Math.max(1, length);
  const scale = (q: number) => q % 6 < 3 ? forceScale : momentScale;
  let memberLaw = 0, releasedAction = 0;
  for (const e of elements) {
    const end = combo.ef.get(e);
    if (!end || !end.f.every(Number.isFinite) || !end.ul.every(Number.isFinite)) return unknown('Member response unavailable.');
    // A released member can buckle between its nodes even when they have no
    // lateral DOFs. Use the conservative isolated fixed/free Euler load as a
    // member screen in addition to the global elastic geometric-stiffness check.
    if (e.it.kind === 'beam' && end.f[6] < 0) {
      const length = e.m.parentSpan?.unbracedLengthM ?? e.L;
      const euler = Math.PI ** 2 * e.it.E * Math.min(e.it.Iy, e.it.Iz) / (2 * length) ** 2;
      if (euler / -end.f[6] < minimumBucklingFactor) return unknown('Member compression requires buckling verification.');
    }
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b <= a; b++) {
        const expected = a === b ? 1 : 0;
        if (Math.abs(dot(e.R[a], e.R[b]) - expected) > 1e-10) return unknown('Member frame is not orthonormal.');
      }
    }
    const ug = new Float64Array(12);
    ug.set(displacementAt(combo, e.a)!);
    ug.set(displacementAt(combo, e.b)!, 6);
    const jointLocal = vecToLocal(ug, e.R);
    const translation = Math.hypot(end.ul[6] - end.ul[0], end.ul[7] - end.ul[1], end.ul[8] - end.ul[2]);
    const rotation = Math.max(Math.hypot(...end.ul.subarray(3, 6)), Math.hypot(...end.ul.subarray(9, 12)));
    if (e.it.kind === 'spring') {
      // The printed axial law remains exact in straight extension. Transverse
      // motion would rotate that axis and is still limited by the linear gate.
      const span = e.m.parentSpan;
      const fraction = span ? (span.toQuarter-span.fromQuarter)/4 : 1;
      const stroke = Math.abs(end.ul[6]-end.ul[0]);
      const lateral = Math.hypot(end.ul[7]-end.ul[1],end.ul[8]-end.ul[2]);
      if (stroke > Math.min(e.it.strokeLimitM*fraction,e.L/2) || lateral/e.L > smallMotion)
        return unknown('Spring stroke or lateral motion exceeds the printed verification envelope.');
    } else if (Math.max(translation / e.L, rotation) > smallMotion) return unknown('Member motion exceeds the linear verification envelope.');
    const global = vecToGlobal(end.f, e.R);
    for (let i = 0; i < 12; i++) {
      const q = i % 6;
      const node = i < 6 ? e.a : e.b;
      imbalance.get(node)![q] -= global[i];
      // Assert the end's actual section law as well as assembled equilibrium.
      let expected = 0;
      for (let j = 0; j < 12; j++) expected += e.k[12 * i + j] * end.ul[j];
      memberLaw = Math.max(memberLaw, Math.abs(end.f[i] - expected) / scale(q));
      if (e.rel.includes(i)) {
        releasedAction = Math.max(releasedAction, Math.abs(end.f[i]) / scale(q));
      } else {
        const difference = Math.abs(end.ul[i] - jointLocal[i]);
        compatibility = Math.max(compatibility, difference / (q < 3 ? lengthScale : 1));
      }
    }
  }
  let nodalBalance = 0;
  for (const a of active) {
    const u = displacementAt(combo, a)!;
    const r = combo.reac[a];
    const balance = imbalance.get(a)!;
    for (let q = 0; q < 6; q++) {
      nodalBalance = Math.max(nodalBalance, Math.abs(balance[q]) / scale(q));
      if (ctx.eq[6 * a + q] < 0) {
        compatibility = Math.max(compatibility, Math.abs(u[q]) / (q < 3 ? lengthScale : 1));
      } else if (r) {
        nodalBalance = Math.max(nodalBalance, Math.abs(r[q]) / scale(q));
      }
    }
  }
  const force = Math.hypot(...applied.subarray(0, 3)) / forceScale;
  const moment = Math.hypot(...applied.subarray(3, 6)) / momentScale;
  const residuals = { force, moment, nodalBalance, memberLaw, compatibility, releasedAction };
  if (!Object.values(residuals).every(Number.isFinite)) return unknown('Nonfinite residual.');
  if (Math.max(force, moment, nodalBalance, memberLaw, releasedAction) > residualLimit || compatibility > compatibilityLimit) {
    return { ...unknown('Equilibrium, frame law or constraint residual exceeded tolerance.'), residuals };
  }
  return { formulation, status: 'verified-linear', residuals };
}
