import { ITEMS } from './voxelSections';
import type { Context, Element, ElementForce, Solved } from './voxelResults';
import { recover } from './frameElement';
import { cholesky, cholSolve } from './frameMath';
function assemble(ctx: Context, active: Map<Element, boolean>) {
  const { nf, els } = ctx,
    K = new Float64Array(nf * nf);
  for (const e of els) {
    if (e.cable && !active.get(e)) continue;
    for (let i = 0; i < 12; i++) {
      const di = e.dofs[i];
      if (di < 0) continue;
      const row = di * nf;
      for (let j = 0; j < 12; j++) {
        const dj = e.dofs[j];
        if (dj < 0) continue;
        K[row + dj] += e.kgl[i * 12 + j];
      }
    }
  }
  for (let i = 0; i < nf; i++) K[i * nf + i] += 1e-3; // tiny regularisation → mechanisms show as huge displacements
  return K;
}
export function solveCombo(
  ctx: Context,
  F: Float64Array,
): { fail: true } | Solved {
  const { nf, eq, els, NA } = ctx;
  const cables = els.filter((e) => e.cable);
  const active = new Map(cables.map((e) => [e, true]));
  let u = new Float64Array(NA * 6),
    K0 = new Float64Array(nf * nf);
  for (let iter = 0; iter < 10; iter++) {
    const K = assemble(ctx, active);
    K0 = K.slice();
    const Ff = new Float64Array(nf);
    for (let d = 0; d < NA * 6; d++) if (eq[d] >= 0) Ff[eq[d]] += F[d];
    // cable pretension as initial strain: active cables pull their end nodes together
    for (const e of cables) {
      if (!active.get(e)) continue;
      const P = ITEMS.cable.P0;
      for (let c = 0; c < 3; c++) {
        const da = eq[e.a * 6 + c],
          db = eq[e.b * 6 + c];
        if (da >= 0) Ff[da] += P * e.ex[c];
        if (db >= 0) Ff[db] -= P * e.ex[c];
      }
    }
    if (!cholesky(K, nf, ctx.bw)) return { fail: true };
    const x = cholSolve(K, nf, Ff, ctx.bw);
    u = new Float64Array(NA * 6);
    for (let d = 0; d < NA * 6; d++) if (eq[d] >= 0) u[d] = x[eq[d]];
    let changed = false;
    for (const e of cables) {
      let el = 0;
      for (let c = 0; c < 3; c++)
        el += e.ex[c] * (u[e.b * 6 + c] - u[e.a * 6 + c]);
      const want = ITEMS.cable.P0 + ((e.it.E * e.it.A) / e.L) * el > 0;
      if (want !== active.get(e)) {
        active.set(e, want);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const ef = new Map<Element, ElementForce>();
  for (const e of els) {
    if (e.cable && !active.get(e)) {
      ef.set(e, {
        f: new Float64Array(12),
        ul: new Float64Array(12),
        slack: true,
      });
      continue;
    }
    const r = recover(e, u);
    if (e.cable) {
      r.f[0] -= ITEMS.cable.P0;
      r.f[6] += ITEMS.cable.P0;
    }
    ef.set(e, r);
  }
  return { u, K0, active, ef };
}
