import { describe, expect, it } from 'vitest';
import { cycleTargetStackIndex, generateTargets, pickTargetStack, targetSalience, type TargetCandidate, type TargetInput, type Vec3 } from './targets';

const input = (extra: Partial<TargetInput> = {}): TargetInput => ({
  origin: [0, 0, 0], bounds: { width: 15, height: 15, depth: 15 }, maxLength: 5, ...extra,
});
const position = (value: Vec3): string => value.join(',');

describe('multiplayer target generation', () => {
  it('offers all shorter Euclidean lattice spans and diagonals rather than selected spokes or a cube', () => {
    const targets = generateTargets(input());
    const positions = new Set(targets.map(target => position(target.position)));
    for (const point of ['1,0,0', '1,1,1', '1,2,3', '3,4,0', '0,0,5']) expect(positions.has(point)).toBe(true);
    expect(positions.has('0,0,0')).toBe(false);
    expect(positions.has('5,5,5')).toBe(false);
    for (const target of targets) expect(Math.hypot(...target.position)).toBeLessThanOrEqual(5 + 1e-9);
  });

  it.each([5, 7, 10] as const)('supports inclusive 15x15 limits and printed maximum %s', maxLength => {
    const origin: Vec3 = [15, 15, 2];
    const targets = generateTargets(input({ origin, maxLength, bounds: { width: 15, depth: 15, height: 3 } }));
    expect(targets.some(target => position(target.position) === `15,${15 - maxLength},2`)).toBe(true);
    expect(targets.some(target => position(target.position) === '15,15,3')).toBe(true);
    for (const { position: [x, y, z] } of targets) {
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(15);
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(15);
      expect(z).toBeGreaterThanOrEqual(0); expect(z).toBeLessThanOrEqual(3);
      expect(Math.hypot(x - origin[0], y - origin[1], z - origin[2])).toBeLessThanOrEqual(maxLength + 1e-9);
    }
  });

  it('treats depth as horizontal Y and height as vertical Z for fractional ports too', () => {
    const targets = generateTargets(input({
      origin: [1, 10, 0], bounds: { width: 15, depth: 15, height: 2 },
      quarterPorts: [
        { id: 'horizontal', position: [1.25, 12.25, 0.25] },
        { id: 'too-high', position: [1.25, 10, 2.25] },
      ],
    }));
    expect(targets.some(target => target.id === 'horizontal')).toBe(true);
    expect(targets.some(target => target.id === 'too-high')).toBe(false);
    expect(targets.some(target => target.id === 'grid:1,15,0')).toBe(true);
    expect(targets.some(target => target.id === 'grid:1,10,3')).toBe(false);
  });

  it('preserves authored fractional ports and distinct identities at coincident coordinates', () => {
    const ports = [
      { id: 'quarter-a', position: [1.25, 0.5, 0.75] as Vec3, parentId: 'member', fraction: 0.25 as const },
      { id: 'quarter-b', position: [1.25, 0.5, 0.75] as Vec3 },
      { id: 'integer-port', position: [1, 0, 0] as Vec3 },
      { id: 'outside', position: [16, 0, 0] as Vec3 },
    ];
    const targets = generateTargets(input({ quarterPorts: [...ports, ports[0]] }));
    expect(targets.filter(target => target.kind === 'quarter').map(target => target.id)).toEqual(['quarter-a', 'quarter-b', 'integer-port']);
    expect(targets.find(target => target.id === 'quarter-a')).toEqual({ ...ports[0], kind: 'quarter' });
    expect(targets.filter(target => position(target.position) === '1,0,0')).toHaveLength(2);
  });

  it('uses physical Euclidean distance from fractional origins and applies supplied legality equally', () => {
    const targets = generateTargets(input({
      origin: [0.25, 0.25, 0.25],
      quarterPorts: [{ id: 'port', position: [2.25, 0.25, 0.25] }, { id: 'rejected', position: [2.25, 1, 0.25] }],
      isLegal: target => target.position[1] <= 0.5,
    }));
    expect(targets.some(target => target.id === 'port')).toBe(true);
    expect(targets.some(target => target.id === 'rejected')).toBe(false);
    expect(targets.some(target => target.id === 'grid:0,0,0')).toBe(true);
    expect(targets.every(target => target.position[1] <= 0.5)).toBe(true);
  });

  it('does not mutate frozen port arrays and rejects invalid boundary dimensions', () => {
    const point: Vec3 = Object.freeze([1.25, 0, 0]);
    const port = Object.freeze({ id: 'port', position: point });
    const ports = Object.freeze([port]);
    generateTargets(input({ quarterPorts: ports }));
    expect(port.position).toBe(point);
    expect(() => generateTargets(input({ bounds: { width: -1, height: 3, depth: 15 } }))).toThrow(RangeError);
    expect(() => generateTargets(input({ origin: [NaN, 0, 0] }))).toThrow(RangeError);
  });
});

describe('target salience and depth selection', () => {
  it('bolds nearby targets and fades smoothly without removing far legal hit targets', () => {
    const near = targetSalience(0), middle = targetSalience(80), far = targetSalience(500);
    expect(near.opacity).toBe(1);
    expect(near.radius).toBeGreaterThan(middle.radius);
    expect(near.opacity).toBeGreaterThan(middle.opacity);
    expect(middle.opacity).toBeGreaterThan(far.opacity);
    expect(far.opacity).toBeGreaterThan(0);
    expect(targetSalience(10000, true)).toEqual({ opacity: 1, radius: 5 });
    expect(targetSalience(NaN)).toEqual(far);
    expect(Math.abs(targetSalience(80).opacity - targetSalience(80.01).opacity)).toBeLessThan(0.001);
  });

  it('reuses a caller-owned mutable result without frame allocation', () => {
    const output = { opacity: 0, radius: 0 };
    expect(targetSalience(80, false, output)).toBe(output);
    expect(output).toEqual(targetSalience(80));
    expect(targetSalience(500, true, output)).toBe(output);
    expect(output).toEqual({ opacity: 1, radius: 5 });
  });

  it('keeps every overlapping depth in a stable stack independent of cursor fading', () => {
    const candidates: readonly TargetCandidate<string>[] = Object.freeze([
      { item: 'back', sx: 100, sy: 100, depth: 0.9, dist: 3 },
      { item: 'front', sx: 101, sy: 101, depth: 0.1, dist: 4 },
      { item: 'separate', sx: 111, sy: 100, depth: 0.2, dist: 12 },
      { item: 'outside-hit', sx: 101, sy: 100, depth: 0, dist: 20 },
    ]);
    expect(pickTargetStack(candidates).map(candidate => candidate.item)).toEqual(['front', 'back']);
    expect(candidates[0].item).toBe('back');
    expect(cycleTargetStackIndex(0, 2, 1)).toBe(1);
    expect(cycleTargetStackIndex(1, 2, 1)).toBe(0);
    expect(cycleTargetStackIndex(0, 2, -1)).toBe(1);
    expect(cycleTargetStackIndex(0, 0, 1)).toBe(-1);
  });

  it('maintains input order on ties and excludes invalid projections', () => {
    const candidates = [
      { item: 'first', sx: 10, sy: 10, depth: 0.2, dist: 0 },
      { item: 'second', sx: 10, sy: 10, depth: 0.2, dist: 0 },
      { item: 'invalid', sx: NaN, sy: 10, depth: 0, dist: 0 },
    ];
    expect(pickTargetStack(candidates).map(candidate => candidate.item)).toEqual(['first', 'second']);
    expect(pickTargetStack(candidates, -1)).toEqual([]);
  });
});
