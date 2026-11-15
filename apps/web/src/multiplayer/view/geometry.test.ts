import { describe, expect, it } from 'vitest';
import { createMemberGeometry, createMemberGeometryCache, type MemberGeometryFamily } from './geometry';

const families: MemberGeometryFamily[] = ['member', 'cable', 'spring'];

describe('multiplayer member geometry', () => {
  it.each(families)('keeps %s centred on its reference span with finite indexed surfaces', family => {
    const geometry = createMemberGeometry(family, 7);
    const positions = geometry.getAttribute('position');
    expect(geometry.index?.count).toBeGreaterThan(0);
    for (const value of positions.array) expect(Number.isFinite(value)).toBe(true);
    expect(geometry.boundingBox?.min.y).toBeCloseTo(-3.5, 5);
    expect(geometry.boundingBox?.max.y).toBeCloseTo(3.5, 5);
    expect(geometry.boundingBox!.max.x).toBeGreaterThan(0);
    expect(geometry.boundingBox!.min.x).toBeLessThan(0);
    geometry.dispose();
  });

  it('has two endpoint coils, one continuous parent and a narrow centre continuation', () => {
    const geometry = createMemberGeometry('spring', 10, { coilRadius: 0.3, wireRadius: 0.02 });
    expect(geometry.userData.visualCoilCount).toBe(2);
    expect(geometry.userData.analyticalElementCount).toBe(1);
    const position = geometry.getAttribute('position');
    let leftRadius = 0, rightRadius = 0, middleRadius = 0;
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i), radius = Math.hypot(position.getX(i), position.getZ(i));
      if (y < -1 && y > -4.2) leftRadius = Math.max(leftRadius, radius);
      if (y > 1 && y < 4.2) rightRadius = Math.max(rightRadius, radius);
      if (Math.abs(y) < 0.5) middleRadius = Math.max(middleRadius, radius);
    }
    expect(leftRadius).toBeGreaterThan(0.28);
    expect(rightRadius).toBeGreaterThan(0.28);
    expect(middleRadius).toBeLessThan(0.04);
    geometry.dispose();
  });

  it('supports very short positive spans without overshooting endpoint planes or nonfinite values', () => {
    const geometry = createMemberGeometry('spring', 0.01);
    expect(geometry.boundingBox!.min.y).toBeCloseTo(-0.005, 6);
    expect(geometry.boundingBox!.max.y).toBeCloseTo(0.005, 6);
    for (const value of geometry.getAttribute('normal').array) expect(Number.isFinite(value)).toBe(true);
    geometry.dispose();
  });

  it('rejects invalid dimensions before allocating a usable geometry', () => {
    for (const length of [0, -1, NaN, Infinity]) expect(() => createMemberGeometry('member', length)).toThrow();
    expect(() => createMemberGeometry('spring', 5, { coilTurns: 0 })).toThrow();
    expect(() => createMemberGeometry('member', 5, { memberWidth: NaN })).toThrow();
    expect(() => createMemberGeometry('cable', 5, { radialSegments: 10000 })).toThrow();
  });

  it('shares geometry by family/span and disposes each cached resource only once', () => {
    const cache = createMemberGeometryCache();
    const member = cache.get('member', 5), spring = cache.get('spring', 5);
    expect(cache.get('member', 5)).toBe(member);
    expect(cache.get('spring', 5)).toBe(spring);
    expect(member).not.toBe(spring);
    expect(cache.size).toBe(2);
    let memberDisposals = 0, springDisposals = 0;
    member.addEventListener('dispose', () => memberDisposals++);
    spring.addEventListener('dispose', () => springDisposals++);
    cache.dispose();
    cache.dispose();
    expect(memberDisposals).toBe(1);
    expect(springDisposals).toBe(1);
    expect(cache.size).toBe(0);
    expect(() => cache.get('cable', 5)).toThrow(/disposed/);
  });
});
