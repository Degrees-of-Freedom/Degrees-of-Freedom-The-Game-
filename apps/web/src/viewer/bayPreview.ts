import * as THREE from 'three';
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
): BayHit {
  const p: GridPoint = [
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
