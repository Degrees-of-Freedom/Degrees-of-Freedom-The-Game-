import type { FrameSystem, Element, ElementForce, Solved } from './voxelResults';
import { recover } from './frameElement';
import { cholesky, cholSolve } from './frameMath';
function assemble(ctx: FrameSystem, active: Map<Element, boolean>) {
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
  return K;
}
export function solveCombo(
  ctx: FrameSystem,
  F: Float64Array,
): { fail: true; reason?: string } | Solved {
  const { nf, eq, els, NA } = ctx;
  const cables = els.filter((e) => e.cable);
  const active = new Map(cables.map((e) => [e, true]));
  let u = new Float64Array(NA * 6),
    K0 = new Float64Array(0), solvedDofs: number[] = [];
  let converged = false;
  for (let iter = 0; iter < 10; iter++) {
    const K = assemble(ctx, active);
    K0 = K;
    const Ff = new Float64Array(nf);
    for (let d = 0; d < NA * 6; d++) if (eq[d] >= 0) Ff[eq[d]] += F[d];
    // cable pretension as initial strain: active cables pull their end nodes together
    for (const e of cables) {
      if (!active.get(e) || e.it.kind !== 'cable') continue;
      const P = e.it.P0;
      for (let c = 0; c < 3; c++) {
        const da = eq[e.a * 6 + c],
          db = eq[e.b * 6 + c];
        if (da >= 0) Ff[da] += P * e.ex[c];
        if (db >= 0) Ff[db] -= P * e.ex[c];
      }
    }
    // An uncoupled, unloaded rotational coordinate does not participate in a
    // pin or axial element. Remove only such coordinate-aligned zero rows;
    // unsupported translations and coupled singularities remain mechanisms.
    const originalDof = new Int32Array(nf);
    for (let d = 0; d < NA * 6; d++) if (eq[d] >= 0) originalDof[eq[d]] = d;
    let maxDiagonal = 0;
    for (let i = 0; i < nf; i++) maxDiagonal = Math.max(maxDiagonal, Math.abs(K[i * nf + i]));
    const tolerance = maxDiagonal * 1e-14;
    const activeDofs: number[] = [];
    for (let i = 0; i < nf; i++) {
      if (Math.abs(K[i * nf + i]) <= tolerance) {
        if (originalDof[i] % 6 < 3 || Math.abs(Ff[i]) > 1e-10) return { fail: true };
      } else activeDofs.push(i);
    }
    const n = activeDofs.length;
    // Removing unused rotations cannot widen a band. Cholesky uses only
    // the lower triangle and creates no fill outside the original band.
    const bw = Math.min(ctx.bw, Math.max(0, n - 1));
    const reduced = n === nf ? K.slice() : new Float64Array(n * n);
    const rhs = new Float64Array(n);
    solvedDofs = activeDofs;
    for (let i = 0; i < n; i++) {
      rhs[i] = Ff[activeDofs[i]];
      if (n !== nf) {
        const row = activeDofs[i] * nf;
        for (let j = Math.max(i - bw, 0); j <= i; j++) reduced[i * n + j] = K[row + activeDofs[j]];
      }
    }
    if (n && !cholesky(reduced, n, bw)) return { fail: true };
    const solved = n ? cholSolve(reduced, n, rhs, bw) : new Float64Array();
    const x = new Float64Array(nf);
    activeDofs.forEach((dof, i) => { x[dof] = solved[i]; });
    u = new Float64Array(NA * 6);
    for (let d = 0; d < NA * 6; d++) if (eq[d] >= 0) u[d] = x[eq[d]];
    let changed = false;
    for (const e of cables) {
      if (e.it.kind !== 'cable') continue;
      let el = 0;
      for (let c = 0; c < 3; c++)
        el += e.ex[c] * (u[e.b * 6 + c] - u[e.a * 6 + c]);
      const want = e.it.P0 + ((e.it.E * e.it.A) / e.L) * el > 0;
      if (want !== active.get(e)) {
        active.set(e, want);
        changed = true;
      }
    }
    if (!changed) { converged = true; break; }
  }
  // The last displacements correspond to the previous active set if it
  // changes on the final iteration; they must not be reported as a solution.
  if (!converged) return { fail: true, reason: 'Cable active-set iteration did not converge.' };
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
    if (e.it.kind === 'cable') {
      r.f[0] -= e.it.P0;
      r.f[6] += e.it.P0;
    }
    ef.set(e, r);
  }
  return { u, K0, activeDofs: solvedDofs, active, ef };
}
