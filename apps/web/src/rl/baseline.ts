import { dot } from "./policy";

/**
 * Linear value baseline V(s) = v · ψ(s), refit by ridge regression on the
 * (decayed) returns seen so far. A closed-form fit tracks the value far faster
 * than gradient steps over the handful of updates a run makes, which is what
 * cuts the variance of the policy gradient.
 */
export class RidgeBaseline {
  private readonly gram: Float64Array[];
  private readonly moment: Float64Array;
  private coefficients: Float64Array;

  constructor(
    private readonly size: number,
    private readonly ridge = 1e-3,
    /** Weight kept on past batches each time a new one arrives. */
    private readonly decay = 0.9,
  ) {
    this.gram = Array.from({ length: size }, () => new Float64Array(size));
    this.moment = new Float64Array(size);
    this.coefficients = new Float64Array(size);
  }

  predict(state: ArrayLike<number>): number {
    return dot(this.coefficients, state);
  }

  /** Fold in a batch of (state, return) pairs and refit. */
  update(states: readonly ArrayLike<number>[], returns: readonly number[]): void {
    for (let i = 0; i < this.size; i++) {
      this.moment[i] *= this.decay;
      for (let j = 0; j < this.size; j++) this.gram[i][j] *= this.decay;
    }
    states.forEach((psi, n) => {
      for (let i = 0; i < this.size; i++) {
        this.moment[i] += psi[i] * returns[n];
        for (let j = 0; j < this.size; j++) this.gram[i][j] += psi[i] * psi[j];
      }
    });
    const system = this.gram.map((row, i) => {
      const copy = Float64Array.from(row);
      copy[i] += this.ridge;
      return copy;
    });
    this.coefficients = solveLinear(system, this.moment);
  }
}

/** Solve A x = b by Gaussian elimination with partial pivoting (A is small). */
export function solveLinear(a: readonly Float64Array[], b: ArrayLike<number>): Float64Array {
  const n = b.length;
  const m = a.map((row, i) => Float64Array.from([...row, b[i]]));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-12) throw new Error("Singular system");
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = col + 1; r < n; r++) {
      const factor = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= factor * m[col][c];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let sum = m[r][n];
    for (let c = r + 1; c < n; c++) sum -= m[r][c] * x[c];
    x[r] = sum / m[r][r];
  }
  return x;
}
