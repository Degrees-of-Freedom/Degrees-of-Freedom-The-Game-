import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type MemberGeometryFamily = 'member' | 'cable' | 'spring';

/** Display dimensions in the same units as length; none of these set stiffness. */
export interface MemberGeometryOptions {
  memberWidth?: number;
  memberDepth?: number;
  cableRadius?: number;
  coilRadius?: number;
  wireRadius?: number;
  /** Turns in each of the two endpoint-originating coils. */
  coilTurns?: number;
  radialSegments?: number;
  samplesPerTurn?: number;
}

interface Dimensions {
  memberWidth: number;
  memberDepth: number;
  cableRadius: number;
  coilRadius: number;
  wireRadius: number;
  coilTurns: number;
  radialSegments: number;
  samplesPerTurn: number;
}

function positive(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive and finite.`);
  return value;
}

function count(name: string, value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new RangeError(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}

function dimensions(options: MemberGeometryOptions): Dimensions {
  return {
    memberWidth: positive('memberWidth', options.memberWidth ?? 0.16),
    memberDepth: positive('memberDepth', options.memberDepth ?? 0.24),
    cableRadius: positive('cableRadius', options.cableRadius ?? 0.025),
    coilRadius: positive('coilRadius', options.coilRadius ?? 0.16),
    wireRadius: positive('wireRadius', options.wireRadius ?? 0.025),
    coilTurns: count('coilTurns', options.coilTurns ?? 3, 1, 12),
    radialSegments: count('radialSegments', options.radialSegments ?? 6, 4, 32),
    samplesPerTurn: count('samplesPerTurn', options.samplesPerTurn ?? 12, 8, 48),
  };
}

/** Piecewise-linear, arc-length parameterized centreline avoids spline overshoot. */
class PolylineCurve extends THREE.Curve<THREE.Vector3> {
  private readonly distances = [0];
  private readonly length: number;

  constructor(private readonly points: readonly THREE.Vector3[]) {
    super();
    for (let i = 1; i < points.length; i++)
      this.distances.push(this.distances[i - 1] + points[i].distanceTo(points[i - 1]));
    this.length = this.distances[this.distances.length - 1];
  }

  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const distance = THREE.MathUtils.clamp(t, 0, 1) * this.length;
    let end = 1;
    while (end < this.points.length - 1 && this.distances[end] < distance) end++;
    const span = this.distances[end] - this.distances[end - 1];
    const fraction = span > 0 ? (distance - this.distances[end - 1]) / span : 0;
    return target.copy(this.points[end - 1]).lerp(this.points[end], fraction);
  }
}

/**
 * A single continuous visual wire: lead, left coil, central continuation,
 * mirrored right coil, lead. Its two coils do not imply two analytical springs.
 */
function springGeometry(length: number, d: Dimensions): THREE.BufferGeometry {
  // Very short schematic springs keep a finite readable envelope without
  // self-intersecting full-size coils. This is visual only, not a physical law.
  const radius = Math.min(d.coilRadius, length * 0.09);
  const wire = Math.min(d.wireRadius, radius * 0.23, length * 0.015);
  const points = [new THREE.Vector3(0, -length / 2, 0)];
  const samples = d.coilTurns * d.samplesPerTurn;
  const leftCoil: THREE.Vector3[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    // Smooth radius ramp joins the helical wire to axial leads at both ends.
    const ramp = Math.min(1, t * 8, (1 - t) * 8);
    const r = radius * Math.sin(ramp * Math.PI / 2);
    const angle = t * d.coilTurns * Math.PI * 2;
    leftCoil.push(new THREE.Vector3(r * Math.cos(angle), -length * 0.44 + t * length * 0.36, r * Math.sin(angle)));
  }
  points.push(...leftCoil);
  for (let i = leftCoil.length - 1; i >= 0; i--) {
    const source = leftCoil[i];
    points.push(new THREE.Vector3(source.x, -source.y, source.z));
  }
  points.push(new THREE.Vector3(0, length / 2, 0));
  const curve = new PolylineCurve(points);
  const tube = new THREE.TubeGeometry(curve, samples * 2 + 16, wire, d.radialSegments, false);
  const startCap = new THREE.CircleGeometry(wire, d.radialSegments);
  startCap.rotateX(Math.PI / 2).translate(0, -length / 2, 0);
  const endCap = new THREE.CircleGeometry(wire, d.radialSegments);
  endCap.rotateX(-Math.PI / 2).translate(0, length / 2, 0);
  const geometry = mergeGeometries([tube, startCap, endCap], false);
  tube.dispose();
  startCap.dispose();
  endCap.dispose();
  if (!geometry) throw new Error('Could not create continuous spring geometry.');
  geometry.userData.visualCoilCount = 2;
  geometry.userData.analyticalElementCount = 1;
  return geometry;
}

/**
 * Geometry is centred at origin along local +Y. Consumers position its midpoint
 * between endpoints and rotate +Y onto the endpoint delta. Units are caller-owned.
 */
export function createMemberGeometry(
  family: MemberGeometryFamily,
  length: number,
  options: MemberGeometryOptions = {},
): THREE.BufferGeometry {
  positive('length', length);
  const d = dimensions(options);
  let geometry: THREE.BufferGeometry;
  switch (family) {
    case 'member':
      geometry = new THREE.BoxGeometry(d.memberWidth, length, d.memberDepth);
      break;
    case 'cable':
      geometry = new THREE.CylinderGeometry(d.cableRadius, d.cableRadius, length, d.radialSegments, 1, false);
      break;
    case 'spring':
      geometry = springGeometry(length, d);
      break;
  }
  geometry.userData.family = family;
  geometry.userData.referenceLength = length;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export interface MemberGeometryCache {
  /** Shared read-only geometry. Do not dispose it separately while the cache lives. */
  get(family: MemberGeometryFamily, length: number): THREE.BufferGeometry;
  /** Owner must release all meshes before disposing their shared geometry. Idempotent. */
  dispose(): void;
  readonly size: number;
}

/** Scene-local cache: no per-frame geometry churn and no unsafe live eviction. */
export function createMemberGeometryCache(options: MemberGeometryOptions = {}): MemberGeometryCache {
  const normalized = dimensions(options);
  const geometries = new Map<string, THREE.BufferGeometry>();
  let disposed = false;
  return {
    get(family, length) {
      if (disposed) throw new Error('Member geometry cache is disposed.');
      positive('length', length);
      const key = `${family}:${length}`;
      let geometry = geometries.get(key);
      if (!geometry) {
        geometry = createMemberGeometry(family, length, normalized);
        geometries.set(key, geometry);
      }
      return geometry;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const geometry of geometries.values()) geometry.dispose();
      geometries.clear();
    },
    get size() { return geometries.size; },
  };
}
