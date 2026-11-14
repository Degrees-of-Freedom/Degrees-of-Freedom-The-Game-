/** Matrix operations for the experimental 3D frame solver. */
const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const dot = (a: number[], b: number[]) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: number[]) => {
  const l = Math.hypot(...a);
  return a.map((v) => v / l);
};

export function localAxes(ex: number[]) {
  let ey = Math.abs(ex[2]) > 0.999 ? [0, 1, 0] : norm(cross([0, 0, 1], ex));
  const ez = cross(ex, ey);
  return [ex, ey, ez];
}
export function frameK(
  E: number,
  G: number,
  A: number,
  Iy: number,
  Iz: number,
  J: number,
  L: number,
) {
  const k = new Float64Array(144);
  const s = (i: number, j: number, v: number) => {
    k[i * 12 + j] = v;
    k[j * 12 + i] = v;
  };
  const a = (E * A) / L;
  s(0, 0, a);
  s(6, 6, a);
  s(0, 6, -a);
  const t = (G * J) / L;
  s(3, 3, t);
  s(9, 9, t);
  s(3, 9, -t);
  let c1 = (12 * E * Iz) / L ** 3,
    c2 = (6 * E * Iz) / L ** 2,
    c3 = (4 * E * Iz) / L,
    c4 = (2 * E * Iz) / L;
  s(1, 1, c1);
  s(7, 7, c1);
  s(1, 7, -c1);
  s(1, 5, c2);
  s(1, 11, c2);
  s(5, 7, -c2);
  s(7, 11, -c2);
  s(5, 5, c3);
  s(11, 11, c3);
  s(5, 11, c4);
  c1 = (12 * E * Iy) / L ** 3;
  c2 = (6 * E * Iy) / L ** 2;
  c3 = (4 * E * Iy) / L;
  c4 = (2 * E * Iy) / L;
  s(2, 2, c1);
  s(8, 8, c1);
  s(2, 8, -c1);
  s(2, 4, -c2);
  s(2, 10, -c2);
  s(4, 8, c2);
  s(8, 10, c2);
  s(4, 4, c3);
  s(10, 10, c3);
  s(4, 10, c4);
  return k;
}
export function trussK(E: number, A: number, L: number) {
  const k = new Float64Array(144);
  const a = (E * A) / L;
  k[0] = a;
  k[6 * 12 + 6] = a;
  k[6] = -a;
  k[6 * 12] = -a;
  return k;
}
export function condense(k0: Float64Array, rel: number[]) {
  const k = Float64Array.from(k0);
  for (const r of rel) {
    const krr = k[r * 12 + r];
    if (Math.abs(krr) < 1e-12) continue;
    for (let i = 0; i < 12; i++) {
      if (i === r) continue;
      const kir = k[i * 12 + r];
      if (!kir) continue;
      for (let j = 0; j < 12; j++) {
        if (j === r) continue;
        k[i * 12 + j] -= (kir * k[r * 12 + j]) / krr;
      }
    }
    for (let i = 0; i < 12; i++) {
      k[i * 12 + r] = 0;
      k[r * 12 + i] = 0;
    }
  }
  return k;
}
export function toGlobal(k: Float64Array, R: number[][]) {
  const out = new Float64Array(144);
  for (let p = 0; p < 4; p++)
    for (let q = 0; q < 4; q++)
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) {
          let s = 0;
          for (let a = 0; a < 3; a++) {
            const Rai = R[a][i];
            if (!Rai) continue;
            for (let b = 0; b < 3; b++)
              s += Rai * k[(p * 3 + a) * 12 + q * 3 + b] * R[b][j];
          }
          out[(p * 3 + i) * 12 + q * 3 + j] = s;
        }
  return out;
}
export function vecToLocal(ug: Float64Array, R: number[][]) {
  const ul = new Float64Array(12);
  for (let p = 0; p < 4; p++)
    for (let a = 0; a < 3; a++)
      ul[p * 3 + a] =
        R[a][0] * ug[p * 3] + R[a][1] * ug[p * 3 + 1] + R[a][2] * ug[p * 3 + 2];
  return ul;
}
export function vecToGlobal(fl: Float64Array, R: number[][]) {
  const fg = new Float64Array(12);
  for (let p = 0; p < 4; p++)
    for (let i = 0; i < 3; i++)
      fg[p * 3 + i] =
        R[0][i] * fl[p * 3] + R[1][i] * fl[p * 3 + 1] + R[2][i] * fl[p * 3 + 2];
  return fg;
}
export function gaussSolve(M: number[][], b: number[]) {
  const n = b.length;
  M = M.map((r) => r.slice());
  b = b.slice();
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let j = c; j < n; j++) M[r][j] -= f * M[c][j];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let j = r + 1; j < n; j++) s -= M[r][j] * x[j];
    x[r] = s / M[r][r];
  }
  return x;
}
// banded Cholesky (dense storage, loops limited to half-bandwidth bw)
export function cholesky(A: Float64Array, n: number, bw = n) {
  for (let j = 0; j < n; j++) {
    const rj = j * n,
      k0 = Math.max(0, j - bw);
    let s = A[rj + j];
    for (let k = k0; k < j; k++) s -= A[rj + k] * A[rj + k];
    if (!(s > 1e-10)) return false;
    const d = Math.sqrt(s);
    A[rj + j] = d;
    const iMax = Math.min(n - 1, j + bw);
    for (let i = j + 1; i <= iMax; i++) {
      const ri = i * n;
      let t = A[ri + j];
      for (let k = Math.max(k0, i - bw); k < j; k++) t -= A[ri + k] * A[rj + k];
      A[ri + j] = t / d;
    }
  }
  return true;
}
export function cholSolve(L: Float64Array, n: number, b: Float64Array, bw = n) {
  const y = Float64Array.from(b);
  for (let i = 0; i < n; i++) {
    let s = y[i];
    const ri = i * n;
    for (let k = Math.max(0, i - bw); k < i; k++) s -= L[ri + k] * y[k];
    y[i] = s / L[ri + i];
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    const kM = Math.min(n - 1, i + bw);
    for (let k = i + 1; k <= kM; k++) s -= L[k * n + i] * y[k];
    y[i] = s / L[i * n + i];
  }
  return y;
}
