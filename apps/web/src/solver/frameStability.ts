import type { Context, Solved } from './voxelResults';
import { toGlobal, cholesky } from './frameMath';

/** Estimate the first global buckling factor from geometric stiffness. */
export function alphaCr(ctx: Context, sol: Solved) {
  const { nf, els } = ctx;
  if (nf === 0) return Infinity;
  if (nf > 2400) return null;
  const Kg = new Float64Array(nf * nf);
  let comp = false;
  for (const e of els) {
    if (e.cable && !sol.active.get(e)) continue;
    const N = sol.ef.get(e)!.f[6];
    if (N < -1e-6) comp = true;
    if (e.rigidA && e.rigidB) {
      // consistent beam geometric stiffness (captures member bending in sway/buckling)
      const L = e.L,
        kg = new Float64Array(144),
        s = (i: number, j: number, v: number) => {
          kg[i * 12 + j] += v;
          if (i !== j) kg[j * 12 + i] += v;
        },
        c = N / L;
      for (const [a, b, c2, d, sg] of [
        [1, 5, 7, 11, 1],
        [2, 4, 8, 10, -1],
      ]) {
        s(a, a, (c * 6) / 5);
        s(c2, c2, (c * 6) / 5);
        s(a, c2, (-c * 6) / 5);
        s(a, b, (sg * c * L) / 10);
        s(a, d, (sg * c * L) / 10);
        s(b, c2, (-sg * c * L) / 10);
        s(c2, d, (-sg * c * L) / 10);
        s(b, b, (c * 2 * L * L) / 15);
        s(d, d, (c * 2 * L * L) / 15);
        s(b, d, (-c * L * L) / 30);
      }
      const g = toGlobal(kg, e.R);
      for (let i = 0; i < 12; i++) {
        const di = e.dofs[i];
        if (di < 0) continue;
        for (let j = 0; j < 12; j++) {
          const dj = e.dofs[j];
          if (dj < 0) continue;
          Kg[di * nf + dj] += g[i * 12 + j];
        }
      }
      continue;
    }
    const c = N / e.L;
    const G = [0, 1, 2].map((i) =>
      [0, 1, 2].map((j) => c * ((i === j ? 1 : 0) - e.ex[i] * e.ex[j])),
    );
    const dA = [0, 1, 2].map((q) => e.dofs[q]),
      dB = [0, 1, 2].map((q) => e.dofs[6 + q]);
    const put = (rows: number[], cols: number[], s: number) => {
      for (let i = 0; i < 3; i++) {
        if (rows[i] < 0) continue;
        for (let j = 0; j < 3; j++) {
          if (cols[j] < 0) continue;
          Kg[rows[i] * nf + cols[j]] += s * G[i][j];
        }
      }
    };
    put(dA, dA, 1);
    put(dB, dB, 1);
    put(dA, dB, -1);
    put(dB, dA, -1);
  }
  if (!comp) return Infinity;
  const active = sol.activeDofs, n = active.length;
  const W = new Float64Array(n * n);
  const pd = (lam: number) => {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const source = active[i] * nf + active[j];
      W[i * n + j] = sol.K0[source] + lam * Kg[source];
    }
    return cholesky(W, n, n - 1);
  };
  if (!pd(1)) {
    let lo = 0,
      hi = 1;
    for (let i = 0; i < 7; i++) {
      const m = (lo + hi) / 2;
      if (pd(m)) lo = m;
      else hi = m;
    }
    return lo;
  }
  let lo = 1,
    hi = 2;
  while (pd(hi)) {
    lo = hi;
    hi *= 2;
    if (hi > 128) return 128;
  }
  for (let i = 0; i < 6; i++) {
    const m = Math.sqrt(lo * hi);
    if (pd(m)) lo = m;
    else hi = m;
  }
  return lo;
}
