import * as THREE from 'three';
import { ITEMS } from '../game/inventory';
import { allNodeKeys, CELL_SIZE, parseNodeKey } from '../game/model';
import type { useGameStore } from '../game/store';
import { SCENE_STYLES } from './sceneStyle';
import {
  computeLoadPath,
  traceToGround,
  type LoadPathMember,
} from '../solver/loadPath';
import type { SceneView } from './sceneView';
export function buildStructure(
  structure: THREE.Group,
  s: ReturnType<typeof useGameStore.getState>,
  v: SceneView,
  point: (key: string) => THREE.Vector3,
  addFlow: (flow: LoadPathMember | undefined, relative: number) => void,
) {
  const result = v.result;
  const palette = SCENE_STYLES[s.style];
  const turn = s.mode === 'multiplayer' ? s.turn : null;
  const playerColors = ['#e37f59', '#5b94d3'];
  const turnOwners = new Map(turn ? [...turn.board.members, ...turn.draft.members].map((member) => [member.id, member.owner]) : []);
  const activeMembers = new Set(turn?.draft.members.map(({ id }) => id));
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
    const [ax, ay, az] = parseNodeKey(member.a);
    const [bx, by, bz] = parseNodeKey(member.b);
    const role = ax === bx && ay === by ? 0 : az === bz ? 1 : 2;
    const owner = turn?.players.findIndex(({ id }) => id === turnOwners.get(member.id)) ?? -1;
    const defaultColor = owner >= 0 ? playerColors[owner] : palette.roles?.[role] ?? ITEMS[member.type].color;
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
        : defaultColor;
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
    const aboveSlice = s.style === 'levels' && Math.min(az, bz) >= s.workK && Math.max(az, bz) > s.workK;
    const isGhost = aboveSlice || activeMembers.has(member.id);
    const mesh = new THREE.Mesh(
      palette.roles && s.style !== 'blocks' ? new THREE.CylinderGeometry(width / 2, width / 2, length, 10) : new THREE.BoxGeometry(width, length, width),
      new THREE.MeshStandardMaterial({
        color,
        transparent: isGhost,
        opacity: isGhost ? 0.43 : 1,
        depthWrite: !isGhost,
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
        transparent: s.style === 'levels' && p.z > s.workK * CELL_SIZE,
        opacity: s.style === 'levels' && p.z > s.workK * CELL_SIZE ? 0.35 : 1,
        color:
          s.selected?.type === 'node' && s.selected.key === key
            ? '#f0b84b'
            : palette.hub,
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
