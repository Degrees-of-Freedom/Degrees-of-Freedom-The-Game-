import { describe, expect, it } from 'vitest';
import { buildPrimaryFlow, type FlowSegmentEvidence, type PrimaryFlowInput } from './flow';

const segment = (id: string, a: string, b: string, extra: Partial<FlowSegmentEvidence> = {}): FlowSegmentEvidence =>
  ({ id, memberId: id, a, b, magnitude: 10, axial: 3, ...extra });
const evidence = (segments: readonly FlowSegmentEvidence[], extra: Partial<PrimaryFlowInput> = {}): PrimaryFlowInput => ({
  modelRevision: 4, checkpoint: { modelRevision: 4, turn: 3, valid: true },
  segments, sources: ['load'], supports: ['base'], ...extra,
});

describe('primary load-transfer interpretation', () => {
  it('directs an entire chain from loaded nodes to receiving supports, independently of endpoint order', () => {
    const result = buildPrimaryFlow(evidence([segment('a', 'load', 'joint'), segment('b', 'base', 'joint')]));
    expect(result.status).toBe('current');
    expect(result.method).toBe('force-weighted-harmonic');
    expect(result.checkpointTurn).toBe(3);
    expect(result.segments.map(flow => [flow.direction, flow.from, flow.to])).toEqual([
      [1, 'load', 'joint'], [-1, 'joint', 'base'],
    ]);
    expect(result.potentials.get('joint')).toBeCloseTo(0.5);
  });

  it('preserves both branches and weights their potentials with their calculated resultant', () => {
    const result = buildPrimaryFlow(evidence([
      segment('a', 'load', 'joint', { magnitude: 10 }),
      segment('b', 'joint', 'left', { magnitude: 3 }),
      segment('c', 'joint', 'right', { magnitude: 7 }),
    ], { supports: ['left', 'right'] }));
    expect(result.segments.map(flow => flow.direction)).toEqual([1, 1, 1]);
    expect(result.segments.map(flow => flow.normalizedMagnitude)).toEqual([1, 0.3, 0.7]);
    expect(result.potentials.get('joint')).toBeCloseTo(0.5);

    const unequal = buildPrimaryFlow(evidence([
      segment('a', 'load', 'joint', { magnitude: 1 }), segment('b', 'joint', 'base', { magnitude: 3 }),
    ]));
    expect(unequal.potentials.get('joint')).toBeCloseTo(0.25);
  });

  it('never reverses transfer direction when only axial sign is reversed', () => {
    const tensile = buildPrimaryFlow(evidence([segment('a', 'load', 'base', { axial: 9 })])).segments[0];
    const compressive = buildPrimaryFlow(evidence([segment('a', 'load', 'base', { axial: -9 })])).segments[0];
    expect(tensile.direction).toBe(1);
    expect(compressive.direction).toBe(tensile.direction);
    expect(tensile.style).toBe('tension');
    expect(compressive.style).toBe('compression');
  });

  it('marks equal-potential combined-load edges ambiguous rather than inventing a unique route', () => {
    const result = buildPrimaryFlow(evidence([
      segment('left', 'load', 'base'), segment('right', 'other-load', 'base'),
      segment('between', 'load', 'other-load'),
    ], { sources: ['load', 'other-load'] }));
    expect(result.segments[0].reason).toBe('flow');
    expect(result.segments[1].reason).toBe('flow');
    expect(result.segments[2]).toMatchObject({ reason: 'ambiguous', direction: 0, from: null, to: null });
  });

  it('does not suppress a shear/bending resultant because axial force is zero or absent', () => {
    const result = buildPrimaryFlow(evidence([
      segment('shear', 'load', 'joint', { axial: 0 }),
      segment('bending', 'joint', 'base', { axial: undefined }),
    ]));
    expect(result.segments.map(flow => flow.style)).toEqual(['mixed', 'mixed']);
    expect(result.segments.every(flow => flow.reason === 'flow' && flow.direction === 1)).toBe(true);
  });

  it('keeps per-segment results distinct within one member, including opposite local directions', () => {
    const result = buildPrimaryFlow(evidence([
      segment('left-quarter', 'left-base', 'load', { memberId: 'member' }),
      segment('right-quarter', 'load', 'right-base', { memberId: 'member' }),
    ], { supports: ['left-base', 'right-base'] }));
    expect(result.segments.map(flow => flow.id)).toEqual(['left-quarter', 'right-quarter']);
    expect(result.segments.map(flow => flow.direction)).toEqual([-1, 1]);
  });

  it('suppresses slack cables, zero actions, invalid evidence and disconnected paths', () => {
    const result = buildPrimaryFlow(evidence([
      segment('slack', 'load', 'base', { slack: true, axial: -4 }),
      segment('zero', 'load', 'base', { magnitude: 0 }),
      segment('unknown', 'load', 'base', { valid: false }),
      segment('nonfinite', 'load', 'base', { magnitude: NaN }),
      segment('disconnected', 'x', 'y'),
    ]));
    expect(result.segments.map(flow => flow.reason)).toEqual(['slack', 'zero', 'unknown', 'unknown', 'unanchored']);
    expect(result.segments.every(flow => flow.direction === 0 && flow.from === null && flow.to === null)).toBe(true);
    expect(result.segments[0].style).toBe('none');
    expect(result.segments[0].normalizedMagnitude).toBe(0);
    expect(result.segments[2].normalizedMagnitude).toBe(0);
  });

  it('suppresses historical arrows between checkpoints and unavailable result scopes', () => {
    const segments = [segment('a', 'load', 'base')];
    const stale = buildPrimaryFlow(evidence(segments, { modelRevision: 5 }));
    expect(stale.status).toBe('stale');
    expect(stale.segments[0]).toMatchObject({ direction: 0, reason: 'stale' });
    expect(stale.potentials.size).toBe(0);
    for (const checkpoint of [undefined, { modelRevision: 4, turn: 3, valid: false }]) {
      const unavailable = buildPrimaryFlow(evidence(segments, { checkpoint }));
      expect(unavailable.status).toBe('unavailable');
      expect(unavailable.segments[0]).toMatchObject({ direction: 0, reason: 'unknown' });
    }
  });

  it('marks incomplete connected scopes ambiguous without suppressing independent verified components', () => {
    const result = buildPrimaryFlow(evidence([
      segment('known-a', 'load', 'joint'),
      segment('known-b', 'joint', 'base'),
      segment('missing-branch', 'joint', 'unknown-support', { valid: false }),
      segment('independent', 'other-load', 'other-base'),
    ], { sources: ['load', 'other-load'], supports: ['base', 'other-base', 'unknown-support'] }));
    expect(result.segments.slice(0, 2).map(flow => [flow.reason, flow.direction])).toEqual([
      ['ambiguous', 0], ['ambiguous', 0],
    ]);
    expect(result.segments[2]).toMatchObject({ reason: 'unknown', direction: 0 });
    expect(result.segments[3]).toMatchObject({ reason: 'flow', direction: 1 });
    expect(result.potentials.has('joint')).toBe(false);
  });

  it('reports conflicting boundaries and bounded nonconvergence without directional arrows', () => {
    const conflict = buildPrimaryFlow(evidence([segment('a', 'load', 'base')], { supports: ['load', 'base'] }));
    expect(conflict.segments[0]).toMatchObject({ direction: 0, reason: 'ambiguous' });
    const bounded = buildPrimaryFlow(evidence([
      segment('a', 'load', 'a'), segment('b', 'a', 'b'), segment('c', 'b', 'c'), segment('d', 'c', 'base'),
    ], { maxIterations: 1 }));
    expect(bounded.segments.every(flow => flow.reason === 'nonconverged' && flow.direction === 0)).toBe(true);
  });

  it('does not mutate read-only evidence or retain cross-call state', () => {
    const item = Object.freeze(segment('a', 'load', 'base'));
    const input = Object.freeze(evidence(Object.freeze([item])));
    const first = buildPrimaryFlow(input);
    const second = buildPrimaryFlow(evidence([segment('b', 'unloaded', 'base')]));
    expect(item).toEqual(segment('a', 'load', 'base'));
    expect(first.segments[0].direction).toBe(1);
    expect(second.segments[0].reason).toBe('unanchored');
  });
});
