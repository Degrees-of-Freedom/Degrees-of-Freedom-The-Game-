import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL_SIZE, type Member } from '../game/model';
import { springParts } from '../game/springParts';
import { localAxes } from '../solver/frameMath';
import type { VoxelAnalysis } from '../solver/voxelResults';
import { verifiedResponse } from '../solver/voxelVerification';

/** Displacement at an unactivated collar interpolates the ends of its exact
 * condensed spring segment. Use coordinates from verified regions only. */
export function springDisplayAxis(
  parentId: number, result: VoxelAnalysis, comboIndex: number, point: (key: string) => THREE.Vector3,
) {
  const ctx = result.ctx;
  const combo = result.combos[comboIndex];
  if (!ctx || !combo) return;
  const segments = ctx.els.filter(e => (e.m.parentSpan?.memberId ?? e.m.id) === parentId);
  if (!segments.length || !combo.components?.some(c =>
    verifiedResponse(c.verification) && c.memberIds.includes(segments[0].m.id))) return;
  const ranges = segments.map(e => ({
    start: (e.m.parentSpan?.fromQuarter ?? 0)/4, end: (e.m.parentSpan?.toQuarter ?? 4)/4,
    a: point(e.m.a), b: point(e.m.b),
  }));
  return (t: number) => {
    const r = ranges.find(r => t >= r.start && t <= r.end)!;
    return r.a.clone().lerp(r.b, (t - r.start)/(r.end - r.start));
  };
}

/** One picked parent, eight turns and three visible attachment collars. Display
 * enlargement affects the section only and never moves a printed port. */
export function springGeometry(member: Pick<Member, 'a' | 'b'>, scale = 1, displayedAxis?: (t: number) => THREE.Vector3) {
  const axisStart = new THREE.Vector3(...member.a.split(',').map(Number)).multiplyScalar(CELL_SIZE);
  const axisEnd = new THREE.Vector3(...member.b.split(',').map(Number)).multiplyScalar(CELL_SIZE);
  const section = localAxes(axisEnd.clone().sub(axisStart).normalize().toArray());
  const pieces = springParts(member).map(p => {
    const enlarged = (coords: number[], at: number) => {
      const axis = axisStart.clone().lerp(axisEnd, at);
      return new THREE.Vector3(...coords).multiplyScalar(CELL_SIZE).sub(axis).multiplyScalar(scale).add(displayedAxis?.(at) ?? axis);
    };
    const a = enlarged(p.a,p.from), b = enlarged(p.b,p.to);
    const delta = b.clone().sub(a), span = delta.length(), width = p.width*scale;
    const geometry = p.collar ? new THREE.BoxGeometry(width, width, span)
      : new THREE.CylinderGeometry(width/2,width/2,span,8,1);
    if (p.collar) geometry.applyMatrix4(new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...section[1]),new THREE.Vector3(...section[2]),new THREE.Vector3(...section[0])));
    else geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));
    return geometry.translate(...a.lerp(b,0.5).toArray());
  });
  const result = pieces.length ? mergeGeometries(pieces) : new THREE.BufferGeometry();
  for (const piece of pieces) piece.dispose();
  return result;
}
