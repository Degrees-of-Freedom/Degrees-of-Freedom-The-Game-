import * as THREE from 'three';
import { ITEMS } from '../game/inventory';
import { allNodeKeys, type GameModel } from '../game/model';
import type { Selection } from '../game/store';
import {
  computeLoadPath,
  traceToGround,
  type LoadPathMember,
} from '../solver/loadPath';
import type { SceneView } from './sceneView';
export function buildStructure(
  structure: THREE.Group,
  s: { model: GameModel; selected: Selection },
  v: SceneView,
  point: (key: string) => THREE.Vector3,
  addFlow: (flow: LoadPathMember | undefined, relative: number) => void,
) {
  const result = v.result;
  const path = v.loadPath && result ? computeLoadPath(result, v.combo) : null;
  const trace =
    path && s.selected?.type === 'node'
      ? traceToGround(path, s.selected.key)
      : null;
  for (const member of s.model.members) {
    const a = point(member.a),
      b = point(member.b),
      direction = b.clone().sub(a),
      length = direction.length();
    const flow = path?.members.get(member.id),
      relative = flow && path ? flow.force / path.maxForce : 0;
    const width = path
      ? relative < 0.01
        ? 0.05
        : 0.05 + 0.42 * Math.sqrt(relative)
      : member.type === 'cable'
        ? 0.06
        : member.type === 'shs'
          ? 0.12
          : member.type === 'glulam'
            ? 0.25
            : 0.3;
    addFlow(flow, relative);
    const u = result?.members[member.id]?.util;
    let color =
      v.utilization && result && !result.error
        ? result.mechanism
          ? '#9b6bff'
          : u === undefined
            ? '#777777'
            : u > 1
              ? '#ed4545'
              : u > 0.6
                ? '#e5a33f'
                : '#4cae77'
        : ITEMS[member.type].color;
    if (path)
      color =
        relative < 0.01
          ? '#5a6370'
          : flow?.mode === 'tension'
            ? '#4da3ff'
            : flow?.mode === 'compression'
              ? '#ff6b4a'
              : flow?.mode === 'bending'
                ? '#c58cff'
                : '#5a6370';
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, length, width),
      new THREE.MeshStandardMaterial({
        color,
        emissive: trace?.members.has(member.id)
          ? 0x555555
          : s.selected?.type === 'member' && s.selected.id === member.id
            ? 0x536b54
            : 0x000000,
      }),
    );
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.normalize(),
    );
    structure.add(mesh);
  }
  for (const key of allNodeKeys(s.model)) {
    const p = point(key),
      attrs = s.model.attrs[key] || {};
    const node = new THREE.Mesh(
      new THREE.SphereGeometry(trace?.nodes.has(key) ? 0.26 : 0.16, 12, 8),
      new THREE.MeshStandardMaterial({
        color:
          s.selected?.type === 'node' && s.selected.key === key
            ? '#f0b84b'
            : '#edf1ed',
      }),
    );
    node.position.copy(p);
    structure.add(node);
    if (attrs.joint) {
      const joint = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.42, 0.42),
        new THREE.MeshStandardMaterial({ color: '#f39c34' }),
      );
      joint.position.copy(p);
      structure.add(joint);
    }
    if (attrs.found) {
      const foundation = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 1.2, 0.6),
        new THREE.MeshStandardMaterial({
          color: attrs.locked ? '#777771' : '#bdb8ae',
        }),
      );
      foundation.position.copy(p).add(new THREE.Vector3(0, 0, -0.3));
      structure.add(foundation);
    }
    if (attrs.target) {
      const rope = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.04, 0.5),
        new THREE.MeshBasicMaterial({ color: 0x2b2f36 }),
      );
      rope.position.copy(p).add(new THREE.Vector3(0, 0, -0.25));
      structure.add(rope);
      const color =
        !result || result.error
          ? '#e0a030'
          : result.floating.includes(key)
            ? '#ff5a5f'
            : '#3ecf8e';
      const crate = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 1.1, 0.9),
        new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
      );
      crate.position.copy(p).add(new THREE.Vector3(0, 0, -0.95));
      structure.add(crate);
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 80;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#17251e';
        ctx.fillRect(0, 0, 256, 80);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 40px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${attrs.load} kN`, 128, 54);
        const texture = new THREE.CanvasTexture(canvas);
        const label = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: texture, depthTest: false }),
        );
        label.position.copy(p).add(new THREE.Vector3(0, 0, -1.6));
        label.scale.set(1.6, 0.5, 1);
        structure.add(label);
      }
    } else if (attrs.load)
      structure.add(
        new THREE.ArrowHelper(
          new THREE.Vector3(0, 0, -1),
          p.clone().add(new THREE.Vector3(0, 0, 2)),
          1.8,
          0xe74e50,
          0.5,
          0.3,
        ),
      );
  }
}
