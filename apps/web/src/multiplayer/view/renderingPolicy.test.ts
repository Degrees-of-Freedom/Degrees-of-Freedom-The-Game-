import { describe, expect, it } from 'vitest';
import { sceneFlow, sceneFlowPositions } from './renderingPolicy';
import type { CheckpointView, MemberView, MultiplayerViewData } from './types';
import type { FlowSegmentEvidence } from './flow';

const member = (extra: Partial<MemberView> = {}): MemberView => ({
  id: 'beam', cardId: 'card', owner: 'A', family: 'member',
  startNode: 'load', endNode: 'base', start: [0, 0, 2], end: [10, 0, 2],
  maxLength: 10, phase: 'committed', rotations: [[true, false, false], [true, false, false]],
  quarterPorts: [
    { id: 'q25', parentId: 'beam', fraction: 0.25, position: [2.5, 0, 2] },
    { id: 'q50', parentId: 'beam', fraction: 0.5, position: [5, 0, 2] },
    { id: 'q75', parentId: 'beam', fraction: 0.75, position: [7.5, 0, 2] },
  ], ...extra,
});
const segment = (extra: Partial<FlowSegmentEvidence> = {}): FlowSegmentEvidence => ({
  id: 'whole', memberId: 'beam', a: 'load', b: 'base', magnitude: 10, axial: 3, ...extra,
});
const data = (
  segments: readonly FlowSegmentEvidence[] = [segment()], extra: Partial<MultiplayerViewData> = {}, checkpoint: Partial<CheckpointView> = {},
): MultiplayerViewData => ({
  revision: 'rev', board: { width: 15, depth: 15, height: 8 }, metresPerUnit: 2,
  members: [member()], joints: [], checkpoint: {
    id: 'checkpoint', modelRevision: 'rev', turn: 3, valid: true, provenance: 'fixture', forceUnit: 'N',
    sources: ['load'], supports: ['base'], segments, ...checkpoint,
  }, ...extra,
});

describe('scene load-result scope policy', () => {
  it('accepts complete calculated member scope and preserves axial-zero shear/bending action', () => {
    const result = sceneFlow(data([segment({ axial: 0 })]));
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({ reason: 'flow', direction: 1, style: 'mixed' });
  });

  it('keeps valid subdivisions separate and resolves explicit quarter-node aliases by joint positions', () => {
    const result = sceneFlow(data([
      segment({ id: 'first-half', b: 'analysis-midpoint' }),
      segment({ id: 'second-half', a: 'analysis-midpoint' }),
    ], { joints: [{ id: 'analysis-midpoint', position: [5, 0, 2], rotations: null }] }));
    expect(result.segments.map(flow => flow.id)).toEqual(['first-half', 'second-half']);
    expect(result.segments.every(flow => flow.direction === 1 && flow.reason === 'flow')).toBe(true);
    expect(result.potentials.get('analysis-midpoint')).toBeCloseTo(0.5);
  });

  it('resolves an authored quarter node alias without a redundant joint record', () => {
    const model = data([
      segment({ id: 'first-half', b: 'attached-midpoint' }),
      segment({ id: 'second-half', a: 'attached-midpoint' }),
    ], { members: [member({ quarterPorts: [
      { id: 'q50', nodeId: 'attached-midpoint', parentId: 'beam', fraction: 0.5, position: [5, 0, 2] },
    ] })] });
    expect(sceneFlowPositions(model).get('attached-midpoint')).toEqual([5, 0, 2]);
    expect(sceneFlow(model).segments.map(flow => flow.reason)).toEqual(['flow', 'flow']);
  });

  it('rejects an authored quarter node alias that conflicts with an existing coordinate', () => {
    const model = data([
      segment({ id: 'first-half', b: 'attached-midpoint' }),
      segment({ id: 'second-half', a: 'attached-midpoint' }),
    ], {
      members: [member({ quarterPorts: [
        { id: 'q50', nodeId: 'attached-midpoint', parentId: 'beam', fraction: 0.5, position: [5, 0, 2] },
      ] })],
      joints: [{ id: 'attached-midpoint', position: [5, 0, 3], rotations: null }],
    });
    expect(sceneFlowPositions(model).has('attached-midpoint')).toBe(false);
    expect(sceneFlow(model).segments.slice(0, 2).every(flow => flow.reason === 'unknown' && flow.direction === 0)).toBe(true);
  });

  it('does not round quarter coordinates or infer connectivity from unreferenced coincidence', () => {
    const model = data([
      segment({ id: 'first', b: 'q25' }), segment({ id: 'second', a: 'q25' }),
    ], { joints: [{ id: 'coincident-but-unreferenced', position: [2.5, 0, 2], rotations: null }] });
    const result = sceneFlow(model);
    expect(sceneFlowPositions(model).get('q25')).toEqual([2.5, 0, 2]);
    expect(result.segments.map(flow => flow.id)).toEqual(['first', 'second']);
    expect(result.potentials.has('coincident-but-unreferenced')).toBe(false);
  });

  it('rejects unknown owners and unknown endpoint identities instead of drawing paths elsewhere', () => {
    for (const invalid of [segment({ memberId: 'not-a-member' }), segment({ a: 'not-a-node' })]) {
      const result = sceneFlow(data([invalid]));
      expect(result.segments[0]).toMatchObject({ reason: 'unknown', direction: 0 });
      expect(result.segments.every(flow => flow.direction === 0)).toBe(true);
    }
  });

  it('rejects result segments outside the owning straight reference span or off its axis', () => {
    for (const position of [[12, 0, 2], [5, 1, 2]] as const) {
      const result = sceneFlow(data([segment({ b: 'foreign' })], {
        joints: [{ id: 'foreign', position, rotations: null }],
      }));
      expect(result.segments[0]).toMatchObject({ reason: 'unknown', direction: 0 });
    }
  });

  it('represents missing connected members as unknown rather than inventing zero action', () => {
    const result = sceneFlow(data([segment()], {
      members: [member(), member({ id: 'missing', startNode: 'base', endNode: 'another-base', start: [10, 0, 2], end: [12, 0, 2], quarterPorts: [] })],
    }));
    expect(result.segments[0]).toMatchObject({ reason: 'ambiguous', direction: 0 });
    expect(result.segments.some(flow => flow.memberId === 'missing' && flow.reason === 'unknown')).toBe(true);
  });

  it('detects gaps even when the isolated provided middle segment has a source and sink', () => {
    const result = sceneFlow(data([segment({ a: 'q25', b: 'q75' })], {}, { sources: ['q25'], supports: ['q75'] }));
    expect(result.segments[0]).toMatchObject({ reason: 'ambiguous', direction: 0 });
    expect(result.segments.some(flow => flow.id.startsWith('missing:'))).toBe(true);
  });

  it('does not treat a whole-member result as complete when another owned segment is invalid', () => {
    const result = sceneFlow(data([
      segment(), segment({ id: 'invalid-detail', a: 'q25', b: 'q75', valid: false }),
    ]));
    expect(result.segments[0]).toMatchObject({ reason: 'ambiguous', direction: 0 });
    expect(result.segments[1]).toMatchObject({ reason: 'unknown', direction: 0 });
  });

  it('rejects overlapping whole-member and split evidence rather than double-counting action', () => {
    const result = sceneFlow(data([
      segment(), segment({ id: 'left', b: 'q50' }), segment({ id: 'right', a: 'q50' }),
    ]));
    expect(result.segments.slice(0, 3).every(flow => flow.reason === 'unknown' && flow.direction === 0)).toBe(true);
    expect(result.potentials.size).toBe(0);
  });

  it('rejects a duplicated span with distinct IDs, including reversed endpoint order', () => {
    const result = sceneFlow(data([
      segment(), segment({ id: 'reverse-duplicate', a: 'base', b: 'load' }),
    ]));
    expect(result.segments.slice(0, 2).every(flow => flow.reason === 'unknown' && flow.direction === 0)).toBe(true);
  });

  it('allows adjacent split intervals even when their endpoint orders are reversed', () => {
    const result = sceneFlow(data([
      segment({ id: 'left', a: 'q50', b: 'load' }), segment({ id: 'right', a: 'base', b: 'q50' }),
    ]));
    expect(result.segments).toHaveLength(2);
    expect(result.segments.map(flow => flow.reason)).toEqual(['flow', 'flow']);
    expect(result.segments.map(flow => flow.direction)).toEqual([-1, -1]);
    expect(result.segments.map(flow => [flow.from, flow.to])).toEqual([['load', 'q50'], ['q50', 'base']]);
  });

  it('suppresses compressive cable diagnostics while preserving verified tensile and slack states', () => {
    const cable = { members: [member({ family: 'cable' })] };
    expect(sceneFlow(data([segment({ axial: -3 })], cable)).segments[0]).toMatchObject({ reason: 'unknown', direction: 0 });
    expect(sceneFlow(data([segment({ axial: 3 })], cable)).segments[0]).toMatchObject({ reason: 'flow', style: 'tension' });
    expect(sceneFlow(data([segment({ axial: 0, slack: true })], cable)).segments[0]).toMatchObject({ reason: 'slack', direction: 0 });
  });

  it('does not fabricate checkpoint evidence for drafts or animate results assigned to a draft', () => {
    const draft = member({ id: 'draft', phase: 'draft', startNode: 'draft-a', endNode: 'draft-b', start: [1, 3, 2], end: [3, 3, 2], quarterPorts: [] });
    const complete = sceneFlow(data([segment()], { members: [member(), draft] }));
    expect(complete.segments).toHaveLength(1);
    expect(complete.segments[0].reason).toBe('flow');
    const invalidDraft = sceneFlow(data([segment({ memberId: 'draft', a: 'draft-a', b: 'draft-b' })], { members: [draft] }));
    expect(invalidDraft.segments[0]).toMatchObject({ reason: 'unknown', direction: 0 });
  });

  it('removes conflicting node identities and invalidates duplicate segment IDs', () => {
    const conflicting = data([segment()], { joints: [{ id: 'load', position: [0, 0, 7], rotations: null }] });
    expect(sceneFlowPositions(conflicting).has('load')).toBe(false);
    expect(sceneFlow(conflicting).segments[0].reason).toBe('unknown');
    expect(sceneFlow(data([segment(), segment()])).segments.slice(0, 2).every(flow => flow.reason === 'unknown')).toBe(true);
  });

  it('suppresses historical and unavailable evidence and leaves input immutable', () => {
    const original = Object.freeze(segment());
    const model = data(Object.freeze([original]));
    const stale = sceneFlow({ ...model, revision: 'next' });
    expect(stale.status).toBe('stale');
    expect(stale.segments[0]).toMatchObject({ reason: 'stale', direction: 0 });
    expect(sceneFlow({ ...model, checkpoint: undefined }).status).toBe('unavailable');
    expect(original.valid).toBeUndefined();
    expect(model.checkpoint?.segments).toHaveLength(1);
  });
});
