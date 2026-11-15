import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assemblyParts, type AssemblyNode } from '../game/assembly';
import { CELL_SIZE, type Member } from '../game/model';
import { poseSection, rectangularHollowGeometry } from './sectionGeometry';

const reference = (node: AssemblyNode) => new THREE.Vector3(...node.point).multiplyScalar(CELL_SIZE);

export function assemblySectionGeometry(steps = 1) {
  return rectangularHollowGeometry(undefined, steps);
}

/** One selectable mesh for the card. Each piece occupies its own physical
 * centerline. Section enlargement leaves the depth and port stations intact. */
export function assemblyGeometry(member: Member, coordinate = reference, transverseScale?: number) {
  const profile = assemblySectionGeometry();
  const pose = new THREE.Mesh(profile);
  const pieces = assemblyParts(member).map(part => {
    poseSection(pose, coordinate(part.a), coordinate(part.b), reference(part.b).sub(reference(part.a)), transverseScale);
    pose.updateMatrix();
    return profile.clone().applyMatrix4(pose.matrix);
  });
  const geometry = pieces.length ? mergeGeometries(pieces) : new THREE.BufferGeometry();
  for (const piece of pieces) piece.dispose();
  profile.dispose();
  return geometry;
}
