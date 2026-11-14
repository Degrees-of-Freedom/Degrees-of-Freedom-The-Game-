import type { SolverVerdict } from './solvers';

/** Median of a non-empty list. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export interface TimingSummary {
  samples: number;
  medianMs: number;
  worstMs: number;
}

/** Median and worst of the timings that exist; null when no run reported one. */
export function summarizeTimings(values: readonly (number | null)[]): TimingSummary | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length
    ? { samples: present.length, medianMs: median(present), worstMs: Math.max(...present) }
    : null;
}

export interface VerdictAgreement {
  /** Verdicts of the solvers that made a stability claim, by solver id. */
  claims: Record<string, 'stable' | 'unstable'>;
  /** True when at least two solvers made a claim and they differ. */
  disagree: boolean;
}

/**
 * Compare verdicts across solvers for one model. Two solvers agree on
 * stability when both say `stable` or both say `unstable`. `unresolved` and
 * `unavailable` make no claim, so they neither agree nor disagree.
 */
export function compareVerdicts(verdicts: Readonly<Record<string, SolverVerdict>>): VerdictAgreement {
  const claims: Record<string, 'stable' | 'unstable'> = {};
  for (const [id, verdict] of Object.entries(verdicts))
    if (verdict === 'stable' || verdict === 'unstable') claims[id] = verdict;
  return { claims, disagree: new Set(Object.values(claims)).size > 1 };
}

export interface FixtureComparison {
  fixtureId: string;
  /** Verdict of each solver, from its last repetition. */
  verdicts: Record<string, SolverVerdict>;
  /** Compute times of every measured repetition, by solver id. */
  computeMs: Record<string, number[]>;
}

/** Fixtures where solvers that made a claim disagree about stability. */
export function findDisagreements(
  fixtures: readonly FixtureComparison[],
): { fixtureId: string; claims: Record<string, 'stable' | 'unstable'> }[] {
  return fixtures.flatMap(({ fixtureId, verdicts }) => {
    const { claims, disagree } = compareVerdicts(verdicts);
    return disagree ? [{ fixtureId, claims }] : [];
  });
}

/** Per-solver median and worst compute time across every fixture and repetition. */
export function summarizeBySolver(
  fixtures: readonly FixtureComparison[],
): Record<string, TimingSummary | null> {
  const bySolver: Record<string, number[]> = {};
  for (const fixture of fixtures)
    for (const [id, times] of Object.entries(fixture.computeMs)) (bySolver[id] ??= []).push(...times);
  return Object.fromEntries(Object.entries(bySolver).map(([id, times]) => [id, summarizeTimings(times)]));
}
