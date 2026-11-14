import * as THREE from 'three';
import { CELL_SIZE, type NodeAttributes } from '../game/model';
import type { SceneStyle } from './sceneStyle';

export function paintedSupport(group: THREE.Group, position: THREE.Vector3, attrs: NodeAttributes, style: SceneStyle) {
  const scale = CELL_SIZE;
  const height = (style === 'blocks' ? 0.38 : style === 'levels' ? 0.21 : 0.28) * scale;
  const locks = attrs.restraint;
  const hasRotation = !locks || locks.slice(3).some(Boolean);
  const color = style === 'kit' ? '#4b5360' : '#505967';
  const material = new THREE.MeshLambertMaterial({ color });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(scale * 0.19, scale * 0.2, scale * 0.055, 20), material);
  base.position.copy(position).z -= height - scale * 0.025;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(scale * (hasRotation ? 0.12 : 0.045), scale * 0.16, height, hasRotation ? 8 : 16),
    material.clone(),
  );
  body.position.copy(position).z -= height / 2;
  body.rotation.x = Math.PI / 2;
  base.rotation.x = Math.PI / 2;
  body.castShadow = base.castShadow = true;
  group.add(base, body);
  if (locks && !locks[0] && !locks[1]) {
    for (const sign of [-1, 1]) {
      const roller = new THREE.Mesh(new THREE.SphereGeometry(0.055 * scale, 12, 8), material.clone());
      roller.position.copy(base.position).add(new THREE.Vector3(sign * 0.105 * scale, 0, 0.06 * scale));
      group.add(roller);
    }
  }
}

export function visualLoadDirection(direction: NodeAttributes['loadDirection']) {
  switch (direction) {
    case '+Z': return new THREE.Vector3(0, 0, 1);
    case '+X': return new THREE.Vector3(1, 0, 0);
    case '-X': return new THREE.Vector3(-1, 0, 0);
    case '+Y': return new THREE.Vector3(0, 1, 0);
    case '-Y': return new THREE.Vector3(0, -1, 0);
    default: return new THREE.Vector3(0, 0, -1);
  }
}

export function paintedLoad(group: THREE.Group, position: THREE.Vector3, attrs: NodeAttributes, style: SceneStyle) {
  if (!attrs.load) return;
  const direction = visualLoadDirection(attrs.loadDirection);
  const scale = CELL_SIZE;
  const color = '#d94f3d';
  if (style === 'kit' && direction.z < 0) {
    const token = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17 * scale, 0.22 * scale, 0.22 * scale, 20),
      new THREE.MeshLambertMaterial({ color: '#e4a44a' }),
    );
    token.rotation.x = Math.PI / 2;
    token.position.copy(position).z += 0.21 * scale;
    token.castShadow = true;
    group.add(token);
  } else {
    group.add(new THREE.ArrowHelper(direction, position.clone().addScaledVector(direction, -0.76 * scale),
      0.65 * scale, color, 0.19 * scale, 0.15 * scale));
  }
}

export function paintedJoint(group: THREE.Group, position: THREE.Vector3, selected: boolean, fixed: boolean) {
  const radius = CELL_SIZE * (fixed ? 0.15 : 0.115);
  const body = new THREE.Mesh(
    fixed ? new THREE.BoxGeometry(radius * 1.7, radius * 1.7, radius * 1.7) : new THREE.SphereGeometry(radius, 18, 12),
    new THREE.MeshLambertMaterial({ color: selected ? '#efae42' : fixed ? '#647389' : '#fbf7ed' }),
  );
  body.position.copy(position);
  body.castShadow = true;
  group.add(body);
  if (selected) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 1.75, radius * 0.11, 8, 30),
      new THREE.MeshBasicMaterial({ color: '#ee9a43', depthTest: false, depthWrite: false }),
    );
    ring.position.copy(position);
    ring.renderOrder = 20;
    ring.onBeforeRender = (_renderer, _scene, camera) => ring.quaternion.copy(camera.quaternion);
    group.add(ring);
  }
}
