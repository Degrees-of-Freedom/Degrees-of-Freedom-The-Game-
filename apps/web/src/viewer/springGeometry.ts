import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL_SIZE, type Member } from '../game/model';
import { springParts } from '../game/springParts';
import { localAxes } from '../solver/frameMath';

/** One picked parent, eight turns and three visible attachment collars. Display
 * enlargement affects the section only and never moves a printed port. */
export function springGeometry(member: Pick<Member, 'a' | 'b'>, scale = 1) {
  const axisStart = new THREE.Vector3(...member.a.split(',').map(Number)).multiplyScalar(CELL_SIZE);
  const axisEnd = new THREE.Vector3(...member.b.split(',').map(Number)).multiplyScalar(CELL_SIZE);
  const section = localAxes(axisEnd.clone().sub(axisStart).normalize().toArray());
  const pieces = springParts(member).map(p => {
    const enlarged = (coords: number[], at: number) => {
      const axis = axisStart.clone().lerp(axisEnd, at);
      return new THREE.Vector3(...coords).multiplyScalar(CELL_SIZE).sub(axis).multiplyScalar(scale).add(axis);
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
