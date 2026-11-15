import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SECTION_GEOMETRY } from '../evaluator/sections';

/** Straight runs between the supplied physical clamp stations. The strand lay
 * describes the surface only. It never adds sag, bending strength or rest length.
 * A constant display enlargement acts across the section only.
 */
export function cableGeometry(points: readonly THREE.Vector3[], sectionScale=1.8) {
  const radius = sectionScale * SECTION_GEOMETRY.cable.diameter / 2;
  const pieces:THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0,1,0);
  for(let i=1;i<points.length;i++) {
    const delta=points[i].clone().sub(points[i-1]), l=delta.length();
    if(l<1e-9) continue;
    const rotation = new THREE.Quaternion().setFromUnitVectors(up,delta.divideScalar(l));
    const midpoint=points[i-1].clone().lerp(points[i],0.5);
    // Eight outer wires with a bounded number of rings. The vertices are
    // twisted around the reference chord in the same direction on each run.
    const rings=Math.max(8,Math.min(96,Math.ceil(l/0.08)));
    const geo=new THREE.CylinderGeometry(radius,radius,l,32,rings);
    const pos=geo.getAttribute('position');
    for(let j=0;j<pos.count;j++) {
      const x=pos.getX(j), y=pos.getY(j), z=pos.getZ(j);
      const angle=Math.atan2(x,z), scallop=0.92+0.08*Math.cos(8*angle);
      const twist=(y/l+0.5)*rings*Math.PI/32;
      pos.setXYZ(j,scallop*(x*Math.cos(twist)+z*Math.sin(twist)),y,scallop*(z*Math.cos(twist)-x*Math.sin(twist)));
    }
    geo.computeVertexNormals();
    geo.applyQuaternion(rotation); geo.translate(midpoint.x,midpoint.y,midpoint.z);
    pieces.push(geo);
  }
  const merged=pieces.length ? mergeGeometries(pieces) : new THREE.BufferGeometry();
  pieces.forEach(piece=>piece.dispose());
  return merged;
}
