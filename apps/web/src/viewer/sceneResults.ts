import * as THREE from 'three';
import { CELL_SIZE, parseNodeKey, type GridPoint } from '../game/model';
import { addSceneLabel, forceLabel } from './sceneLabels';
import type { SceneView } from './sceneView';
import { displacementAt } from '../solver/voxelResults';
export const basePoint = (key: string) =>
  new THREE.Vector3(
    ...(parseNodeKey(key).map((v) => v * CELL_SIZE) as GridPoint),
  );
/** Use the solver projection for loose multiplayer endpoints as well as lattice joints. */
export function viewBasePoint(key: string, view: SceneView) {
  const ctx = view.result?.ctx;
  const index = ctx?.idx.get(key);
  const coordinates = index === undefined ? undefined : ctx?.pos[index];
  return coordinates
    ? new THREE.Vector3(coordinates[0], coordinates[1], coordinates[2])
    : basePoint(key);
}
export function displayPoint(key: string, v: SceneView) {
  const p = viewBasePoint(key, v),
    result = v.result,
    c = result?.combos[v.combo],
    index = result?.ctx?.idx.get(key),
    active = index === undefined ? -1 : (result?.ctx?.aid[index] ?? -1);
  const displacement = v.deformed && displacementAt(c, active);
  if (displacement && c) {
    const factor = Math.min(500, 1.2 / (c.maxD || 1)) * v.scale;
    p.add(
      new THREE.Vector3(
        displacement[0],
        displacement[1],
        displacement[2],
      ).multiplyScalar(factor),
    );
  }
  return p;
}
export function addResultArrows(
  structure: THREE.Group,
  v: SceneView,
  point: (key: string) => THREE.Vector3,
  labelForces = false,
) {
  const result = v.result,
    resultCombo = result?.combos[v.combo];
  if (v.loads && result?.ctx && resultCombo && !resultCombo.fail) {
    const ctx = result.ctx;
    for (const load of resultCombo.vis || []) {
      const key = ctx.keys[ctx.act[load.a]],
        dir = new THREE.Vector3(...(load.v as GridPoint));
      if (!key || !dir.length()) continue;
      const value = dir.clone();
      dir.normalize();
      const p = point(key),
        length = labelForces ? 1.15 + Math.min(2, Math.log10(1 + value.length()) * 0.32) : 1.5;
      structure.add(
        new THREE.ArrowHelper(
          dir,
          p.clone().addScaledVector(dir, -length),
          length,
          load.kind === 'Q' ? labelForces ? 0xf2b134 : 0xe74e50 : 0x58aacf,
          0.4,
          0.22,
        ),
      );
      if (labelForces && load.kind === 'Q') addSceneLabel(structure, p.clone().addScaledVector(dir, -length), forceLabel(value), 'load');
    }
    for (const [a, reaction] of Object.entries(resultCombo.reac || {})) {
      const key = ctx.keys[ctx.act[Number(a)]],
        dir = new THREE.Vector3(reaction[0], reaction[1], reaction[2]);
      if (!key || dir.length() < 0.5) continue;
      const value = dir.clone();
      dir.normalize();
      const p = viewBasePoint(key, v),
        length = 1.5;
      structure.add(
        new THREE.ArrowHelper(
          dir,
          p,
          length,
          0x3aab72,
          0.4,
          0.22,
        ),
      );
      if (labelForces) addSceneLabel(structure, p.clone().addScaledVector(dir, 0.75 * length), 'R · ' + forceLabel(value), 'reaction');
    }
  }
}
