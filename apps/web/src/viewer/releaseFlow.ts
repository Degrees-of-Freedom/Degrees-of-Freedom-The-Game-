import * as THREE from "three";
import { computeLoadPath, type LoadPathMember } from "../evaluator/loadPath";
import type { StructureEvaluation } from "../evaluator/results";

/** Each verified gravity transfer has its own direction and scale. Preserve
 * the underlying section geometry and exact solver segment endpoints. */
export function buildReleaseFlow(group: THREE.Group, result: StructureEvaluation, point: (key: string) => THREE.Vector3,
  addMotion: (segment: LoadPathMember, relative: number) => void) {
  const path = computeLoadPath(result, 0);
  if (!path) return;
  for (const segment of path.members.values()) {
    if (!segment.direction || segment.force <= 0) continue;
    const a = point(segment.direction > 0 ? segment.a : segment.b);
    const b = point(segment.direction > 0 ? segment.b : segment.a);
    const delta = b.clone().sub(a);
    const relative = segment.force / path.maxForce;
    const length = Math.min(delta.length() * .6, 1.1 + .8 * relative);
    if (!Number.isFinite(length) || !length) continue;
    const start = a.clone().lerp(b, .5).addScaledVector(delta.normalize(), -.5 * length);
    const color = segment.mode === "compression" ? 0xff9977 : segment.mode === "tension" ? 0x87caff : 0xd8b4ff;
    const arrow = new THREE.ArrowHelper(delta, start, length, color, length*.38, length*.29);
    for (const child of [arrow.line, arrow.cone]) {
      child.renderOrder = 2;
      const material = child.material as THREE.Material;
      material.depthTest = false;
      material.depthWrite = false;
    }
    group.add(arrow);
    addMotion(segment, relative);
  }
}

/** A dashed marker identifies the witnessed region. No displacement or mode
 * direction is inferred from a failed solve or from free joint permissions. */
export function markInstability(group: THREE.Group, result: StructureEvaluation, point: (key: string) => THREE.Vector3) {
  const ids = new Set(result.combos[0]?.components?.flatMap(scope => scope.instabilityWitness?.memberIds ?? []));
  const points = (result.ctx?.els ?? []).filter(e => ids.has(e.m.id)).flatMap(e => [point(e.m.a), point(e.m.b)]);
  if (!points.length) return;
  const line = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineDashedMaterial({ color: 0xff477e, dashSize: .24, gapSize: .12, depthTest: false, depthWrite: false }));
  line.computeLineDistances();
  line.renderOrder = 3;
  group.add(line);
}
