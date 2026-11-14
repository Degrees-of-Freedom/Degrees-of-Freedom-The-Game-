import * as THREE from 'three';
import { useGameStore } from '../game/store';
import {
  allNodeKeys,
  CELL_SIZE,
  parseNodeKey,
  type GridPoint,
  type MemberType,
  type NodeItem,
} from '../game/model';
import { groundK, terrainCell } from '../game/terrain';
import { LEVELS } from '../game/levels';
import { MEMBER_TYPES, remaining } from '../game/inventory';
import { memberIssue, nodeItemIssue } from '../game/placementRules';
import { basePoint } from './sceneResults';
import type { BuildPlane } from './sceneGeometry';

type Hit =
  | { kind: 'point'; p: GridPoint; issue: string | null }
  | { kind: 'member'; id: number }
  | { kind: 'node'; key: string }
  | null;
export function createPicker(
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  terrain: THREE.Group,
  ghost: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>,
  preview: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>,
  point: (key: string) => THREE.Vector3,
  buildPlane: () => BuildPlane,
) {
  const ray = new THREE.Raycaster(),
    ndc = new THREE.Vector2();
  return (e: PointerEvent) => {
    const s = useGameStore.getState(),
      level = LEVELS[s.levelId],
      rect = canvas.getBoundingClientRect(),
      x = e.clientX - rect.left,
      y = e.clientY - rect.top;
    const screen = (v: THREE.Vector3) => {
      const p = v.clone().project(camera);
      return [((p.x + 1) * rect.width) / 2, ((1 - p.y) * rect.height) / 2, p.z];
    };
    let nearNode: string | null = null,
      nodeDistance = 14;
    for (const key of allNodeKeys(s.model)) {
      if (key === s.chainStart && MEMBER_TYPES.includes(s.tool as MemberType))
        continue;
      const p = screen(point(key)),
        d = Math.hypot(p[0] - x, p[1] - y);
      if (p[2] < 1 && d < nodeDistance) {
        nearNode = key;
        nodeDistance = d;
      }
    }
    let nearMember: number | null = null,
      memberDistance = 9;
    for (const m of s.model.members) {
      const a = screen(point(m.a)),
        b = screen(point(m.b)),
        dx = b[0] - a[0],
        dy = b[1] - a[1],
        t = Math.max(
          0,
          Math.min(
            1,
            ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1),
          ),
        ),
        d = Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y);
      if (a[2] < 1 && b[2] < 1 && d < memberDistance) {
        nearMember = m.id;
        memberDistance = d;
      }
    }
    let hit: Hit = null;
    ghost.visible = false;
    preview.visible = false;
    if (s.tool === 'inspect' || s.tool === 'delete' || s.tool === 'swap') {
      if (
        nearNode &&
        s.tool !== 'swap' &&
        (s.tool === 'inspect' ||
          !!(
            s.model.attrs[nearNode]?.found ||
            s.model.attrs[nearNode]?.joint ||
            s.model.attrs[nearNode]?.load
          ))
      )
        hit = { kind: 'node', key: nearNode };
      else if (nearMember !== null) hit = { kind: 'member', id: nearMember };
    } else {
      ndc.set((x / rect.width) * 2 - 1, (-y / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const start = s.chainStart ? parseNodeKey(s.chainStart) : null,
        plane = buildPlane();
      const normal =
        plane.axis === 'x'
          ? new THREE.Vector3(1, 0, 0)
          : plane.axis === 'y'
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(0, 0, 1);
      let intersection = ray.ray.intersectPlane(
        new THREE.Plane(normal, -plane.value * CELL_SIZE),
        new THREE.Vector3(),
      );
      // Before starting a chain, pick the closest terrain top as in the prototype.
      if (!start) {
        const terrainHit = ray
          .intersectObjects(terrain.children)
          .find(
            (h) =>
              h.object instanceof THREE.Mesh &&
              h.face &&
              h.face.normal.z > 0.5 &&
              h.object.geometry instanceof THREE.BoxGeometry,
          );
        if (
          terrainHit &&
          (!intersection ||
            terrainHit.point.distanceTo(ray.ray.origin) <
              intersection.distanceTo(ray.ray.origin))
        )
          intersection = terrainHit.point;
      }
      if (intersection || (nearNode && nearNode !== s.chainStart)) {
        const p: GridPoint =
          nearNode && nearNode !== s.chainStart
            ? parseNodeKey(nearNode)
            : [
                Math.max(
                  0,
                  Math.min(level.nx, Math.round(intersection!.x / CELL_SIZE)),
                ),
                Math.max(
                  0,
                  Math.min(level.ny, Math.round(intersection!.y / CELL_SIZE)),
                ),
                Math.max(
                  0,
                  Math.min(level.nz, Math.round(intersection!.z / CELL_SIZE)),
                ),
              ];
        p[2] = Math.max(p[2], groundK(level, p[0], p[1]));
        const isMember = MEMBER_TYPES.includes(s.tool as MemberType),
          issue = isMember
            ? start
              ? memberIssue(level, s.model, start, p, s.tool as MemberType)
              : remaining(level, s.model, s.tool as MemberType) <= 0
                ? 'No items left in supply'
                : null
            : nodeItemIssue(level, s.model, p, s.tool as NodeItem);
        hit = { kind: 'point', p, issue };
        ghost.position.set(...(p.map((v) => v * CELL_SIZE) as GridPoint));
        ghost.material.color.set(issue ? 0xe75151 : 0x31aa78);
        ghost.visible = true;
        if (start && isMember) {
          preview.geometry.setFromPoints([
            basePoint(s.chainStart!),
            ghost.position,
          ]);
          preview.material.color.copy(ghost.material.color);
          preview.visible = true;
        }
      }
    }
    canvas.title =
      hit?.kind === 'point'
        ? hit.issue || `${hit.p.map((v) => v * CELL_SIZE).join(', ')} m`
        : hit?.kind === 'member'
          ? `Member ${hit.id}`
          : hit?.kind === 'node'
            ? `Node ${hit.key}`
            : '';
    return hit;
  };
}
