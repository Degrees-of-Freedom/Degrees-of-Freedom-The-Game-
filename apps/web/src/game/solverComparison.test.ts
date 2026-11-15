import { describe, expect, it } from 'vitest';
import { compareVerdicts, findDisagreements, median, summarizeBySolver, summarizeTimings } from './solverComparison';

describe('timing summaries', () => {
  it('takes the median and the worst of the timings that exist', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(summarizeTimings([4, null, 2, 9])).toEqual({ samples: 3, medianMs: 4, worstMs: 9 });
    expect(summarizeTimings([null])).toBeNull();
  });

  it('summarises each solver across every fixture and repetition', () => {
    const summary = summarizeBySolver([
      { fixtureId: 'a', verdicts: {}, computeMs: { voxel: [1, 3], opensees: [10, 12] } },
      { fixtureId: 'b', verdicts: {}, computeMs: { voxel: [2], opensees: [50] } },
    ]);
    expect(summary.voxel).toEqual({ samples: 3, medianMs: 2, worstMs: 3 });
    expect(summary.opensees).toEqual({ samples: 3, medianMs: 12, worstMs: 50 });
  });
});

describe('verdict agreement', () => {
  it('agrees when every claim is the same', () => {
    expect(compareVerdicts({ voxel: 'stable', 'opensees-linear': 'stable' }).disagree).toBe(false);
    expect(compareVerdicts({ voxel: 'unstable', 'opensees-nonlinear': 'unstable' }).disagree).toBe(false);
  });

  it('disagrees when stable meets unstable', () => {
    const result = compareVerdicts({ voxel: 'stable', 'opensees-linear': 'unstable', 'opensees-nonlinear': 'unstable' });
    expect(result.disagree).toBe(true);
    expect(result.claims).toEqual({ voxel: 'stable', 'opensees-linear': 'unstable', 'opensees-nonlinear': 'unstable' });
  });

  it('treats unresolved and unavailable as making no claim', () => {
    expect(compareVerdicts({ voxel: 'stable', a: 'unresolved', b: 'unavailable' })).toEqual({
      claims: { voxel: 'stable' },
      disagree: false,
    });
  });

  it('lists the fixtures where solvers disagree', () => {
    const disagreements = findDisagreements([
      { fixtureId: '01', verdicts: { voxel: 'stable', os: 'stable' }, computeMs: {} },
      { fixtureId: '04', verdicts: { voxel: 'unstable', os: 'stable' }, computeMs: {} },
      { fixtureId: '19', verdicts: { voxel: 'unstable', os: 'unresolved' }, computeMs: {} },
    ]);
    expect(disagreements).toEqual([{ fixtureId: '04', claims: { voxel: 'unstable', os: 'stable' } }]);
  });
});
