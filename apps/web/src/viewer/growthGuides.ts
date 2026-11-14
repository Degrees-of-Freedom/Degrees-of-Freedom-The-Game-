import * as THREE from 'three';
import { CELL_SIZE, parseNodeKey } from '../game/model';
import type { useGameStore } from '../game/store';
import { GROWTH_ROLE_INDEX, growthTargets } from './growthTargets';
import type { ScenePalette } from './sceneStyle';

export function buildGrowthGuides(
  group: THREE.Group,
  state: ReturnType<typeof useGameStore.getState>,
  palette: ScenePalette,
) {
  const targets = growthTargets(state);
  if (!targets.length || !state.chainStart || !palette.roles) return;
  const origin = new THREE.Vector3(...parseNodeKey(state.chainStart)).multiplyScalar(CELL_SIZE);
  const markerPositions: number[] = [];
  const markerColors: number[] = [];
  const spokes: THREE.Vector3[] = [];
  for (const target of targets) {
    const end = new THREE.Vector3(...target.point).multiplyScalar(CELL_SIZE);
    markerPositions.push(...end.toArray());
    markerColors.push(...new THREE.Color(palette.roles[GROWTH_ROLE_INDEX[target.role]]).toArray());
    spokes.push(origin, origin.clone().lerp(end, 0.28));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(markerPositions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(markerColors, 3));
  group.add(new THREE.Points(geometry, new THREE.PointsMaterial({
    size: 8,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  })));
  group.add(new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(spokes),
    new THREE.LineBasicMaterial({ color: palette.grid, transparent: true, opacity: 0.18, depthWrite: false }),
  ));
}
