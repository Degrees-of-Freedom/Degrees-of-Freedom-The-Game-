import { cholesky, cholSolve, vecToLocal } from './frameMath';
import { recover } from './frameElement';
import type { Element, ElementForce, FrameSystem, Solved } from './types';

/** Engineering strain is measured from the immutable unstressed material length.
 * The tangent includes the direction change of a taut segment. A slack segment
 * has zero tension and zero tangent in every direction. Forces are in kN.
 */
export function cableState(chord: number[], restLength: number, ea: number) {
  const length = Math.hypot(...chord);
  const force = Math.max(0, ea * (length - restLength) / restLength);
  const direction = chord.map(value => length > 0 ? value / length : 0);
  const tangent = new Float64Array(9);
  if (force > 0) {
    const transverse = force / length;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      tangent[3*i+j] = (ea/restLength - transverse)*direction[i]*direction[j] + (i === j ? transverse : 0);
    }
  }
  return { force, direction, tangent };
}

function endMotion(e: Element, u: Float64Array) {
  const ug = new Float64Array(12);
  ug.set(u.subarray(6*e.a,6*e.a+6));
  ug.set(u.subarray(6*e.b,6*e.b+6),6);
  return ug;
}

function equations(ctx: FrameSystem, F: Float64Array, u: Float64Array, withTangent: boolean) {
  const { nf, els, eq } = ctx;
  const residual = new Float64Array(nf);
  const stiffness = new Float64Array(withTangent ? nf * nf : 0);
  const ef = new Map<Element, ElementForce>();
  const active = new Map<Element, boolean>();
  eq.forEach((d, i) => { if (d >= 0) residual[d] += F[i]; });
  for (const e of els) {
    const ug = endMotion(e, u);
    const fg = new Float64Array(12);
    let tangent: Float64Array = e.kgl;
    if (e.it.kind === 'cable') {
      const chord = e.ex.map((v, i) => e.L*v + ug[6+i] - ug[i]);
      const state = cableState(chord, e.m.restLengthM!, e.it.E*e.it.A);
      tangent = new Float64Array(withTangent ? 144 : 0);
      for (let i = 0; i < 3; i++) {
        fg[6+i] = state.force * state.direction[i];
        fg[i] = -fg[6+i];
        if (withTangent) for (let j = 0; j < 3; j++) {
          const value = state.tangent[3*i+j];
          tangent[12*i+j] = tangent[12*(6+i)+6+j] = value;
          tangent[12*i+6+j] = tangent[12*(6+i)+j] = -value;
        }
      }
      if (withTangent) {
        active.set(e, state.force > 0);
        ef.set(e, {
          f: vecToLocal(fg, e.R), ul: vecToLocal(ug, e.R),
          slack: state.force === 0, cableTension: state.force,
        });
      }
    } else {
      for (let i = 0; i < 12; i++) {
        for (let j = 0; j < 12; j++) fg[i] += e.kgl[12*i+j]*ug[j];
      }
      if (withTangent) ef.set(e, recover(e,u));
    }
    e.dofs.forEach((di, i) => {
      if (di < 0) return;
      residual[di] -= fg[i];
      if (withTangent) e.dofs.forEach((dj, j) => {
        if (dj >= 0) stiffness[nf*di+dj] += tangent[12*i+j];
      });
    });
  }
  return { residual, stiffness, ef, active };
}

/** Newton equilibrium of corotational strings and the game's existing
 * small-motion frame elements. Reactions are recovered through the normal
 * component assembler. A singular tangent never produces a scored result.
 */
export function solveCableEquilibrium(
  ctx: FrameSystem, F: Float64Array, inactiveSpins: Set<number>,
): Solved | { fail: true; reason: string } {
  const { nf, eq, NA, bw } = ctx;
  const fail = (reason: string) => ({ fail: true as const, reason });
  if (nf > 600) return fail('Cable component exceeds the playtest limit of 600 free equations.');
  if (ctx.els.some(e => e.cable && (!(e.m.restLengthM! > 0) || !Number.isFinite(e.m.restLengthM) || e.connector))) {
    return fail('Cable rest state or end constraints are unavailable.');
  }
  let u = new Float64Array(6*NA);
  const largestLoad = F.reduce((scale,v) => Math.max(scale,Math.abs(v)),1);
  const norm = (a:Float64Array) => a.reduce((largest,v)=>Math.max(largest,Math.abs(v)),0);
  for (let iteration = 0; iteration < 48; iteration++) {
    const { residual, stiffness, ef, active } = equations(ctx, F, u, true);
    const used: number[] = [];
    for (let q = 0; q < eq.length; q++) {
      const d = eq[q];
      if (d < 0 || inactiveSpins.has(d)) continue;
      if (q%6 >= 3 && stiffness[d*nf+d] === 0 && Math.abs(residual[d]) < 1e-11) continue;
      used.push(d);
    }
    used.sort((a,b) => a-b);
    const n = used.length, width = Math.min(bw, Math.max(0,n-1));
    const reduced = new Float64Array(n*n);
    for (let i = 0; i < n; i++) {
      for (let j = Math.max(0,i-width); j <= i; j++) reduced[i*n+j] = stiffness[used[i]*nf+used[j]];
    }
    if (n && !cholesky(reduced,n,width)) return fail('Cable tangent cannot validate a stable equilibrium at this configuration.');
    const error = norm(residual);
    if (error <= 1e-9*largestLoad) return { u, K0: stiffness, activeDofs: used, active, ef };
    const correction = cholSolve(reduced,n,Float64Array.from(used,d=>residual[d]),width);
    const delta = new Float64Array(nf);
    used.forEach((d,i) => delta[d] = correction[i]);
    let accepted = false;
    for (let fraction = 1; fraction >= 1/1024; fraction /= 2) {
      const trial = u.map((v,q) => eq[q] < 0 ? v : v + fraction*delta[eq[q]]);
      if (!trial.every(Number.isFinite) || !(norm(equations(ctx,F,trial,false).residual) < error)) continue;
      u = trial;
      accepted = true;
      break;
    }
    if (!accepted) return fail('Cable equilibrium could not reduce the free-coordinate residual.');
  }
  return fail('Cable equilibrium reached its bounded iteration limit.');
}
