import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assemblyParts, type AssemblyNode } from '../game/assembly';
import { CELL_SIZE, type Member } from '../game/model';
import { SECTION_GEOMETRY } from '../solver/voxelSections';
import { poseSection } from './sectionGeometry';

const reference = (node: AssemblyNode) => new THREE.Vector3(...node.point).multiplyScalar(CELL_SIZE);

/** One selectable mesh for the card. Each piece occupies its own physical
 * centerline. Section enlargement leaves the depth and port stations intact. */
export function assemblyGeometry(member: Member, coordinate = reference) {
  const {width, depth, wall} = SECTION_GEOMETRY.shs;
  const w = width/2, d = depth/2;
  const face = new THREE.Shape();
  face.moveTo(-w, -d); face.lineTo(w, -d); face.lineTo(w, d); face.lineTo(-w, d); face.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-w+wall, -d+wall); hole.lineTo(-w+wall, d-wall);
  hole.lineTo(w-wall, d-wall); hole.lineTo(w-wall, -d+wall); hole.closePath();
  face.holes.push(hole);
  const profile = new THREE.ExtrudeGeometry(face, { depth: 1, bevelEnabled: false }).translate(0,0,-0.5);
  const pose = new THREE.Mesh(profile);
  const pieces = assemblyParts(member).map(part => {
    poseSection(pose, coordinate(part.a), coordinate(part.b), reference(part.b).sub(reference(part.a)));
    pose.updateMatrix();
    return profile.clone().applyMatrix4(pose.matrix);
  });
  const geometry = pieces.length ? mergeGeometries(pieces) : new THREE.BufferGeometry();
  for (const piece of pieces) piece.dispose();
  profile.dispose();
  return geometry;
}
