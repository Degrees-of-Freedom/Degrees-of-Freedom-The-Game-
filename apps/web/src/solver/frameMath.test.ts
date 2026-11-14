import { describe, expect, it } from 'vitest';
import { cholesky, cholSolve, frameK, trussK } from './frameMath';

describe('frame matrix operations', () => {
  it('solves a symmetric positive definite system', () => {
    const matrix = Float64Array.from([4, 1, 1, 3]);
    expect(cholesky(matrix, 2)).toBe(true);
    const x = cholSolve(matrix, 2, Float64Array.from([1, 2]));
    expect(x[0]).toBeCloseTo(1 / 11);
    expect(x[1]).toBeCloseTo(7 / 11);
  });
  it('sets axial stiffness to EA/L for a frame and truss', () => {
    const frame = frameK(200, 80, 3, 2, 2, 1, 4);
    const truss = trussK(200, 3, 4);
    for (const matrix of [frame, truss]) {
      expect(matrix[0]).toBe(150);
      expect(matrix[6]).toBe(-150);
      expect(matrix[78]).toBe(150);
    }
  });
});
