import * as THREE from 'three';
import { bayFaces } from '../game/bayBrace';
import { bayEdges, bayIssue } from '../game/bay';
import { CELL_SIZE, type GridPoint, type MemberType } from '../game/model';
import { LEVELS } from '../game/levels';
import type { useGameStore } from '../game/store';

export interface BayHit {
  kind: 'bay';
  p: GridPoint;
  size: GridPoint;
  type: MemberType;
  issue: string | null;
}

export const DEFAULT_BAY_SIZE: GridPoint = [2, 2, 2];

export function previewBay(
  state: ReturnType<typeof useGameStore.getState>,
  cursor: THREE.Vector3,
  size: GridPoint,
  type: MemberType,
  preview: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>,
  snappedOrigin?: GridPoint,
): BayHit {
  const p: GridPoint = snappedOrigin ?? [
    Math.floor(cursor.x / (CELL_SIZE * size[0])) * size[0],
    Math.floor(cursor.y / (CELL_SIZE * size[1])) * size[1],
    state.workK,
  ];
  const issue = bayIssue(LEVELS[state.levelId], state.model, p, size, type);
  preview.geometry.dispose();
  preview.geometry = new THREE.BufferGeometry().setFromPoints(
    bayEdges(p, size).flat().map((corner) => new THREE.Vector3(...corner).multiplyScalar(CELL_SIZE)),
  );
  preview.material.color.set(issue ? '#e75151' : '#31aa78');
  preview.visible = true;
  return { kind: 'bay', p, size, type, issue };
}

/** Place on the outward side of the nearest visible completed bay face. */
export function pickBayFace(state: ReturnType<typeof useGameStore.getState>, ray: THREE.Ray, size: GridPoint) {
  let distance = Infinity;
  let selected: GridPoint | undefined;
  const level = LEVELS[state.levelId];
  const bounds = [level.nx, level.ny, level.nz];
  for (const { corners: [a, , , d], normalAxis } of bayFaces(state.model, size)) {
    const facing = ray.direction.getComponent(normalAxis);
    if (Math.abs(facing) < 1e-5) continue;
    const t = (a[normalAxis] * CELL_SIZE - ray.origin.getComponent(normalAxis)) / facing;
    if (t <= 0 || t >= distance) continue;
    const hit = ray.at(t, new THREE.Vector3()).divideScalar(CELL_SIZE);
    if (a.some((min, axis) => hit.getComponent(axis) < min - 0.01 || hit.getComponent(axis) > d[axis] + 0.01)) continue;
    const origin: GridPoint = [...a];
    if (facing > 0) origin[normalAxis] -= size[normalAxis];
    if (origin.some((min, axis) => min < 0 || min + size[axis] > bounds[axis])) continue;
    distance = t;
    selected = origin;
  }
  return selected;
}