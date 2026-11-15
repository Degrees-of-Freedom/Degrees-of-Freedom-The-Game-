import type { Element, FrameSystem, Solved } from './voxelResults';
import { toGlobal, cholesky } from './frameMath';
import { connectorSlips, reduceConnections } from './frameConnections';

const logRefinements = 6;

/** Lowest factor the design search can report at or above a screening threshold.
 * Use the same sequence of square roots as that search, including its rounding.
 */
function reportableFactor(threshold: number) {
  let lo = 1;
  while (lo * 2 <= threshold) lo *= 2;
  if (lo === threshold) return lo;
  let hi = lo * 2;
  for (let i = 0; i < logRefinements; i++) {
    const mid = Math.sqrt(lo * hi);
    if (mid === threshold) return mid;
    if (mid < threshold) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Estimate the first global buckling factor from geometric stiffness. An applied
 * preview may request only proof of a minimum factor in [1,128]. In that case
 * return the demonstrated lower bound, or null if the screen cannot certify it.
 * Design combinations always use the full critical-factor search.
 */
export function alphaCr(ctx: FrameSystem, sol: Solved, minimumFactor?: number) {
  const { nf, els } = ctx;
  if (nf === 0 && !els.some(e => e.connector)) return Infinity;
  if (nf > 2400) return null;
  const Kg = new Float64Array(nf * nf);
  const flexible: { element: Element; kg: Float64Array; slips: ReturnType<typeof connectorSlips> }[] = [];
  let comp = false;
  for (const e of els) {
    if (e.cable && !sol.active.get(e)) continue;
    const N = sol.ef.get(e)!.f[6];
    if (N < -1e-6) comp = true;
    if ((e.rigidA && e.rigidB) || e.connector) {
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
      if (e.connector) {
        flexible.push({element:e, kg, slips: connectorSlips(e.connector.ends, e.R)});
        continue;
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
  // Both elastic and geometric stiffness couple only ends of a physical
  // element. Deleting inactive DOFs preserves that bandwidth upper bound.
  const bw = Math.min(ctx.bw, Math.max(0, n - 1));
  const W = new Float64Array(n * n);
  const activeIndex = new Map(flexible.length ? active.map((d, i) => [d, i] as const) : []);
  const pd = (lam: number) => {
    for (let i = 0; i < n; i++) {
      const sourceRow = active[i] * nf;
      const row = i * n;
      for (let j = Math.max(i - bw, 0); j <= i; j++) {
        const source = sourceRow + active[j];
        W[row + j] = sol.K0[source] + lam * Kg[source];
      }
    }
    // Condensing member-end slips and then adding a fixed geometric matrix
    // would use the wrong connector tangent under compression. Re-condense the
    // actual trial member tangent and test its internal pivots at each factor.
    for (const {element, kg, slips} of flexible) {
      const tangent = element.k.map((value, i) => value + lam * kg[i]);
      const reduced = reduceConnections(tangent, slips);
      if (!reduced.stable) return false;
      const global = toGlobal(reduced.stiffness, element.R);
      for (let i=0; i<12; i++) {
        const row = activeIndex.get(element.dofs[i]);
        if (row === undefined) continue;
        for (let j=0; j<12; j++) {
          const col = activeIndex.get(element.dofs[j]);
          if (col !== undefined && col <= row) W[row*n+col] += global[i*12+j] - element.kgl[i*12+j];
        }
      }
    }
    return cholesky(W, n, bw);
  };
  if (minimumFactor !== undefined && minimumFactor >= 1 && minimumFactor <= 128) {
    // K starts positive definite. K + lambda Kg is affine, so the interval of
    // positive definiteness ends at its first critical load even under mixed
    // tension/compression. One factorization therefore certifies exactly the
    // same threshold decision as bracketing and refining the full factor.
    const lowerBound = reportableFactor(minimumFactor);
    return pd(lowerBound) ? lowerBound : null;
  }
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
  for (let i = 0; i < logRefinements; i++) {
    const m = Math.sqrt(lo * hi);
    if (pd(m)) lo = m;
    else hi = m;
  }
  return lo;
}
