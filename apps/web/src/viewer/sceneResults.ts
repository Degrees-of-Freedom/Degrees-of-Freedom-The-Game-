import * as THREE from 'three';
import { CELL_SIZE, parseNodeKey, type GridPoint } from '../game/model';
import type { SceneView } from './sceneView';
export const basePoint = (key: string) =>
  new THREE.Vector3(
    ...(parseNodeKey(key).map((v) => v * CELL_SIZE) as GridPoint),
  );
export function displayPoint(key: string, v: SceneView) {
  const p = basePoint(key),
    result = v.result,
    c = result?.combos[v.combo],
    index = result?.ctx?.idx.get(key),
    active = index === undefined ? -1 : (result?.ctx?.aid[index] ?? -1);
  if (v.deformed && c?.u && active >= 0) {
    const factor = Math.min(500, 1.2 / (c.maxD || 1)) * v.scale;
    p.add(
      new THREE.Vector3(
        c.u[active * 6],
        c.u[active * 6 + 1],
        c.u[active * 6 + 2],
      ).multiplyScalar(factor),
    );
  }
  return p;
}
export function addResultArrows(
  structure: THREE.Group,
  v: SceneView,
  point: (key: string) => THREE.Vector3,
) {
  const result = v.result,
    resultCombo = result?.combos[v.combo];
  if (v.loads && result?.ctx && resultCombo && !resultCombo.fail) {
    const ctx = result.ctx;
    for (const load of resultCombo.vis || []) {
      const key = ctx.keys[ctx.act[load.a]],
        dir = new THREE.Vector3(...(load.v as GridPoint));
      if (!key || !dir.length()) continue;
      dir.normalize();
      const p = point(key),
        length = 1.5;
      structure.add(
        new THREE.ArrowHelper(
          dir,
          p.clone().addScaledVector(dir, -length),
          length,
          load.kind === 'Q' ? 0xe74e50 : 0x58aacf,
          0.4,
          0.22,
        ),
      );
    }
    for (const [a, reaction] of Object.entries(resultCombo.reac || {})) {
      const key = ctx.keys[ctx.act[Number(a)]],
        dir = new THREE.Vector3(reaction[0], reaction[1], reaction[2]);
      if (!key || dir.length() < 0.5) continue;
      dir.normalize();
      const p = basePoint(key),
        length = 1.5;
      structure.add(
        new THREE.ArrowHelper(
          dir,
          p.clone().addScaledVector(dir, -length),
          length,
          0x3aab72,
          0.4,
          0.22,
        ),
      );
    }
  }
}
