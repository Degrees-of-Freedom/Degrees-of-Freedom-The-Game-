/** Deterministic pseudo-random numbers so training runs are reproducible. */
export type Random = () => number;

/** mulberry32: a small, fast 32-bit generator returning values in [0, 1). */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sample an index with probability proportional to `probabilities` (sum ≈ 1). */
export function sampleIndex(probabilities: ArrayLike<number>, random: Random): number {
  const u = random();
  let cumulative = 0;
  for (let i = 0; i < probabilities.length; i++) {
    cumulative += probabilities[i];
    if (u < cumulative) return i;
  }
  return probabilities.length - 1;
}
