import * as THREE from "three";
import { addSceneLabel, forceLabel } from './sceneLabels';
import { CELL_SIZE, type NodeAttributes } from "../game/model";
import type { SceneStyle } from "./sceneStyle";

export function paintedSupport(
  group: THREE.Group,
  position: THREE.Vector3,
  attrs: NodeAttributes,
  style: SceneStyle,
) {
  const scale = CELL_SIZE;
  const height =
    (style === "blocks" ? 0.38 : style === "levels" ? 0.21 : 0.28) * scale;
  const locks = attrs.restraint;
  const allLocked = !locks || locks.every(Boolean);
  const hasRotation = !locks || locks.slice(3).some(Boolean);
  const color =
    style === "levels"
      ? "#6f8a73"
      : style === "grow-dusk" || style === "kit"
        ? "#22313f"
        : "#505967";
  const material = new THREE.MeshLambertMaterial({ color });
  if (allLocked && (style === "grow" || style === "grow-dusk")) {
    for (const [width, depth, z, paint] of [
      [0.56, 0.12, -height / scale + 0.06, color],
      [0.40, 0.22, -height / scale + 0.23, "#637486"],
    ] as const) {
      const shoe = new THREE.Mesh(
        new THREE.BoxGeometry(width * scale, width * scale, depth * scale),
        new THREE.MeshLambertMaterial({ color: paint }),
      );
      shoe.position.copy(position).z += z * scale;
      shoe.castShadow = true;
      group.add(shoe);
    }
    material.dispose();
    return;
  }
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(scale * 0.19, scale * 0.2, scale * 0.055, 20),
    material,
  );
  base.position.copy(position).z -= height - scale * 0.025;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(
      scale * (hasRotation ? 0.12 : 0.045),
      scale * 0.16,
      height,
      hasRotation ? 8 : 16,
    ),
    material.clone(),
  );
  body.position.copy(position).z -= height / 2;
  body.rotation.x = Math.PI / 2;
  base.rotation.x = Math.PI / 2;
  body.castShadow = base.castShadow = true;
  group.add(base, body);
  if (locks && !locks[0] && !locks[1]) {
    for (const sign of [-1, 1]) {
      const roller = new THREE.Mesh(
        new THREE.SphereGeometry(0.055 * scale, 12, 8),
        material.clone(),
      );
      roller.position
        .copy(base.position)
        .add(new THREE.Vector3(sign * 0.105 * scale, 0, 0.06 * scale));
      group.add(roller);
    }
  }
}

export function visualLoadDirection(
  direction: NodeAttributes["loadDirection"],
) {
  switch (direction) {
    case "+Z":
      return new THREE.Vector3(0, 0, 1);
    case "+X":
      return new THREE.Vector3(1, 0, 0);
    case "-X":
      return new THREE.Vector3(-1, 0, 0);
    case "+Y":
      return new THREE.Vector3(0, 1, 0);
    case "-Y":
      return new THREE.Vector3(0, -1, 0);
    default:
      return new THREE.Vector3(0, 0, -1);
  }
}

export function paintedLoad(
  group: THREE.Group,
  position: THREE.Vector3,
  attrs: NodeAttributes,
  style: SceneStyle,
  memberDirections: THREE.Vector3[],
  gravityNodeCanHang: boolean,
) {
  if (!attrs.load) return;
  const direction = visualLoadDirection(attrs.loadDirection);
  const scale = CELL_SIZE;
  const amber = style === 'grow-dusk' || style === 'kit';
  const color = amber ? '#f2b134' : style === 'levels' ? '#c8553d' : '#d94f3d';
  const tail = memberDirections.some((member) => member.dot(direction) < -0.999);
  const head = memberDirections.some((member) => member.dot(direction) > 0.999);
  const size = 0.8 + 0.42 * Math.log10(Math.max(1, attrs.load) / 5);
  const labelPoint = position.clone();
  if (direction.z < 0 && (amber || style === 'grow')) {
    const hanging = !head && gravityNodeCanHang;
    const shifted = !hanging && tail;
    const base = position.clone().add(new THREE.Vector3(
      shifted ? 0.31 * scale : 0,
      shifted ? -0.31 * scale : 0,
      (hanging ? -0.3 - 0.43 * size : shifted ? -0.26 - 0.31 * size : 0.16) * scale,
    ));
    const bodyHeight = 0.32 * size * scale;
    const radius = size * scale;
    const token = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13 * radius, 0.2 * radius, bodyHeight, 24),
      new THREE.MeshLambertMaterial({ color }),
    );
    token.rotation.x = Math.PI / 2;
    token.position.copy(base).z += bodyHeight / 2;
    token.castShadow = true;
    const handle = new THREE.Mesh(
      new THREE.TorusGeometry(0.05 * radius, 0.018 * radius, 8, 18),
      new THREE.MeshLambertMaterial({ color }),
    );
    handle.position.copy(base).z += bodyHeight + 0.044 * radius;
    handle.rotation.x = Math.PI / 2;
    group.add(token, handle);
    if (hanging || shifted) group.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([position, handle.position]),
      new THREE.LineBasicMaterial({ color: '#22313f' }),
    ));
    labelPoint.copy(token.position);
  } else {
    const length = (0.5 + 0.42 * size) * scale;
    const origin = position.clone().addScaledVector(direction, tail && !head ? 0.2 * scale : -length - 0.13 * scale);
    if (tail && head) {
      if (direction.z === 0) origin.z += 0.26 * scale;
      else origin.x += 0.24 * scale;
    }
    group.add(new THREE.ArrowHelper(direction, origin, length, color, 0.25 * size * scale, 0.22 * size * scale));
    labelPoint.copy(origin).addScaledVector(direction, 0.35 * length);
  }
  addSceneLabel(group, labelPoint, forceLabel(direction.multiplyScalar(attrs.load)), 'load');
}

export function paintedJoint(
  group: THREE.Group,
  position: THREE.Vector3,
  selected: boolean,
  fixed: boolean,
  style: SceneStyle,
  baseColor: string,
  faded: boolean,
) {
  const isGrowth = style === "grow" || style === "grow-dusk";
  const pinned = isGrowth && !fixed;
  const radius = CELL_SIZE * (isGrowth ? pinned ? 0.105 : 0.13 : fixed ? 0.15 : 0.115);
  const body = new THREE.Mesh(
    style === "levels" && fixed
      ? new THREE.BoxGeometry(radius * 1.7, radius * 1.7, radius * 1.7)
      : new THREE.SphereGeometry(radius, 18, 12),
    new THREE.MeshLambertMaterial({
      color: selected ? "#efae42" : faded ? "#c9c4bb" : baseColor,
      transparent: faded,
      opacity: faded ? 0.42 : 1,
      depthWrite: !faded,
    }),
  );
  body.position.copy(position);
  body.castShadow = true;
  group.add(body);
  if (selected || pinned) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius * (selected ? 1.75 : 1.4), radius * (selected ? 0.11 : 0.22), 8, 30),
      new THREE.MeshBasicMaterial({
        color: selected ? "#ee9a43" : "#465461",
        depthTest: false,
        depthWrite: false,
      }),
    );
    ring.position.copy(position);
    ring.renderOrder = 20;
    ring.onBeforeRender = (_renderer, _scene, camera) =>
      ring.quaternion.copy(camera.quaternion);
    group.add(ring);
  }
}
