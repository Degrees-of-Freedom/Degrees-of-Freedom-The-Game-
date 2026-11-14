import * as THREE from 'three';
import { useGameStore } from '../game/store';
import {
  allNodeKeys,
  CELL_SIZE,
  parseNodeKey,
  type GridPoint,
  type MemberType,
  type NodeItem,
  type Tool,
} from '../game/model';
import { groundK } from '../game/terrain';
import { sceneLevel } from './sceneLevel';
import { MEMBER_TYPES, remaining } from '../game/inventory';
import { memberIssue, nodeItemIssue } from '../game/placementRules';
import { basePoint } from './sceneResults';
import type { BuildPlane } from './sceneGeometry';

import { DEFAULT_BAY_SIZE, previewBay, type BayHit } from './bayPreview';
import { GROWTH_ROLE_INDEX, growthTargets } from './growthTargets';
import { isGrowthStyle, SCENE_STYLES } from './sceneStyle';
import { memberEndPosition } from './turnGuides';
import { selectedTurnCard, turnConnectionTargets, turnPointIssue, type ConnectionTarget } from './turnPicking';
import type { SceneView } from './sceneView';

type Hit =
  | BayHit
  | ({ kind: 'connection' } & ConnectionTarget)
  | { kind: 'point'; p: GridPoint; issue: string | null }
  | { kind: 'member'; id: number }
  | { kind: 'node'; key: string }
  | null;
export function createPicker(
  canvas: HTMLCanvasElement,
  getCamera: () => THREE.Camera,
  terrain: THREE.Group,
  ghost: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>,
  preview: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>,
  point: (key: string) => THREE.Vector3,
  buildPlane: () => BuildPlane,
  getView: () => SceneView,
) {
  const ray = new THREE.Raycaster(),
    ndc = new THREE.Vector2();
  return (e: PointerEvent, toolOverride?: Tool) => {
    const s = useGameStore.getState(),
      level = sceneLevel(s),
      camera = getCamera(),
      card = selectedTurnCard(s),
      tool = toolOverride ?? (card?.kind === 'element' ? card.type : card?.kind === 'load' ? 'load' : s.mode === 'multiplayer' ? 'inspect' : s.tool),
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
      if (key === s.chainStart && MEMBER_TYPES.includes(tool as MemberType))
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
    if (card?.kind === 'connection') {
      let closest = 19;
      for (const target of turnConnectionTargets(s)) {
        const member = s.model.members.find(({ id }) => id === target.memberId);
        if (!member) continue;
        // Offset along the member so coincident ends can be picked individually.
        const endpoint = memberEndPosition(point, member, target.end);
        const [sx, sy, depth] = screen(endpoint);
        const distance = Math.hypot(sx - x, sy - y);
        if (depth >= -1 && depth < 1 && distance < closest) {
          hit = { kind: 'connection', ...target };
          closest = distance;
          ghost.position.copy(endpoint);
        }
      }
      if (hit) {
        ghost.material.color.set('#f6ad49');
        ghost.visible = true;
      }
    } else if (tool === 'inspect' || tool === 'delete' || tool === 'swap') {
      if (
        nearNode &&
        tool !== 'swap' &&
        (tool === 'inspect' ||
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
      const isMember = MEMBER_TYPES.includes(tool as MemberType);
      let intersection = ray.ray.intersectPlane(
        new THREE.Plane(normal, -plane.value * CELL_SIZE),
        new THREE.Vector3(),
      );
      // Before starting a chain, pick the closest terrain top as in the prototype.
      if (!start && s.style !== 'levels' && s.style !== 'blocks') {
        const terrainHit = ray
          .intersectObjects(terrain.children)
          .find(
            (h) =>
              h.object instanceof THREE.Mesh &&
              h.face &&
              h.face.normal.z > 0.5 &&
              h.object.userData.pickTerrain === true,
          );
        if (
          terrainHit &&
          (!intersection ||
            terrainHit.point.distanceTo(ray.ray.origin) <
              intersection.distanceTo(ray.ray.origin))
        )
          intersection = terrainHit.point;
      }
      const isGrowing = !!start && isMember && !card && isGrowthStyle(s.style);
      const reachable = isGrowing ? closestGrowthTarget() : null;
      if (!card && s.style === 'blocks' && isMember && intersection) {
        hit = previewBay(s, intersection, getView().baySize ?? DEFAULT_BAY_SIZE, tool as MemberType, preview);
      } else if (reachable || (!isGrowing && (intersection || nearNode))) {
        const useExisting = nearNode && nearNode !== s.chainStart && (
          s.style !== 'levels' || parseNodeKey(nearNode)[2] === plane.value
        ) ? nearNode : null;
        const p: GridPoint | null = card?.kind === 'load'
          ? nearNode ? parseNodeKey(nearNode) : null
          : reachable
          ? reachable.point
          : useExisting
            ? parseNodeKey(useExisting)
            : intersection
              ? [
                  Math.max(0, Math.min(level.nx, Math.round(intersection.x / CELL_SIZE))),
                  Math.max(0, Math.min(level.ny, Math.round(intersection.y / CELL_SIZE))),
                  Math.max(0, Math.min(level.nz, Math.round(intersection.z / CELL_SIZE))),
                ]
              : null;
        if (p) {
          // Levels preserves the active slice. Invalid underground picks show
          // the same rule feedback as the committed edit.
          if (s.style !== 'levels') p[2] = Math.max(p[2], groundK(level, p[0], p[1]));
          const issue = card ? turnPointIssue(s, p) : isMember
            ? start
              ? memberIssue(level, s.model, start, p, tool as MemberType)
              : remaining(level, s.model, tool as MemberType) <= 0
                ? 'No items left in supply'
                : null
            : nodeItemIssue(level, s.model, p, tool as NodeItem);
          hit = { kind: 'point', p, issue };
          ghost.position.set(...p).multiplyScalar(CELL_SIZE);
          const roles = SCENE_STYLES[s.style].roles;
          const roleColor = reachable && roles ? roles[GROWTH_ROLE_INDEX[reachable.role]] : '#31aa78';
          ghost.material.color.set(issue ? '#e75151' : roleColor);
          ghost.visible = true;
          if (start && isMember) {
            preview.geometry.dispose();
            const segments = [
              new THREE.Vector3(...start).multiplyScalar(CELL_SIZE),
              ghost.position,
            ];
            if (s.style === 'levels' && start[2] !== p[2]) {
              segments.push(segments[0], new THREE.Vector3(start[0], start[1], p[2]).multiplyScalar(CELL_SIZE));
            }
            preview.geometry = new THREE.BufferGeometry().setFromPoints(segments);
            preview.material.color.copy(ghost.material.color);
            preview.visible = true;
          }
        }
      }
    }
    function closestGrowthTarget() {
      let closest: ReturnType<typeof growthTargets>[number] | null = null;
      let distance = 12;
      for (const target of growthTargets(s)) {
        const [sx, sy, depth] = screen(basePoint(target.key));
        const candidate = Math.hypot(sx - x, sy - y);
        if (depth >= -1 && depth < 1 && candidate < distance) {
          closest = target;
          distance = candidate;
        }
      }
      return closest;
    }
    canvas.title =
      hit?.kind === 'point' || hit?.kind === 'bay'
        ? hit.issue || `${hit.p.map((v) => v * CELL_SIZE).join(', ')} m`
        : hit?.kind === 'member'
          ? `Member ${hit.id}`
          : hit?.kind === 'node'
            ? `Node ${hit.key}`
            : hit?.kind === 'connection'
              ? ["Connect member", hit.memberId, "end", hit.end.toUpperCase()].join(" ")
              : '';
    return hit;
  };
}
