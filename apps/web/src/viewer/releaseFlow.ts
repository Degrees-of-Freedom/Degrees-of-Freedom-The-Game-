import * as THREE from "three";
import { computeLoadPath, type LoadPathMember } from "../evaluator/loadPath";
import type { StructureEvaluation } from "../evaluator/results";
import { INSTABILITY_COLOR, LOAD_PATH_ARROWS } from "./viewPalette";
import { addSceneLabel } from "./sceneLabels";
import { formatValue, isNegligible } from "./viewFormat";

/** Force labels stay readable on busy boards: only the largest transfers above 5% of the peak are labelled. */
export const MAX_FLOW_LABELS = 16;
const kN = (n: number) => formatValue(n) + " kN";

/** Each verified gravity transfer has its own direction and scale. Preserve
 * the underlying section geometry and exact solver segment endpoints. */
export function buildReleaseFlow(group: THREE.Group, result: StructureEvaluation, point: (key: string) => THREE.Vector3,
  addMotion: (segment: LoadPathMember, relative: number) => void, labels = false) {
  const path = computeLoadPath(result, 0);
  if (!path) return;
  const labelled = new Set(labels ? [...path.members.values()]
    .filter(segment => segment.direction && !isNegligible(segment.force) && segment.force >= 0.05 * path.maxForce)
    .sort((a, b) => b.force - a.force).slice(0, MAX_FLOW_LABELS).map(segment => segment.memberId) : []);
  for (const segment of path.members.values()) {
    if (!segment.direction || segment.force <= 0) continue;
    const a = point(segment.direction > 0 ? segment.a : segment.b);
    const b = point(segment.direction > 0 ? segment.b : segment.a);
    const delta = b.clone().sub(a);
    const relative = segment.force / path.maxForce;
    const length = Math.min(delta.length() * .6, 1.1 + .8 * relative);
    if (!Number.isFinite(length) || !length) continue;
    const start = a.clone().lerp(b, .5).addScaledVector(delta.normalize(), -.5 * length);
    const color = LOAD_PATH_ARROWS[segment.mode === "compression" || segment.mode === "tension" ? segment.mode : "bending"];
    const arrow = new THREE.ArrowHelper(delta, start, length, color, length*.38, length*.29);
    for (const child of [arrow.line, arrow.cone]) {
      child.renderOrder = 2;
      const material = child.material as THREE.Material;
      material.depthTest = false;
      material.depthWrite = false;
    }
    group.add(arrow);
    addMotion(segment, relative);
    if (labelled.has(segment.memberId)) {
      const mode = segment.mode === "compression" || segment.mode === "tension" ? segment.mode : "bending";
      addSceneLabel(group, a.clone().lerp(b, .5), kN(segment.force), mode);
    }
  }
}

/** A dashed marker identifies the witnessed region. No displacement or mode
 * direction is inferred from a failed solve or from free joint permissions. */
export function markInstability(group: THREE.Group, result: StructureEvaluation, point: (key: string) => THREE.Vector3, labels = false) {
  const ids = new Set(result.combos[0]?.components?.flatMap(scope => scope.instabilityWitness?.memberIds ?? []));
  const points = (result.ctx?.els ?? []).filter(e => ids.has(e.m.id)).flatMap(e => [point(e.m.a), point(e.m.b)]);
  if (!points.length) return;
  const line = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineDashedMaterial({ color: INSTABILITY_COLOR, dashSize: .24, gapSize: .12, depthTest: false, depthWrite: false }));
  line.computeLineDistances();
  line.renderOrder = 3;
  group.add(line);
  if (labels) addSceneLabel(group, points[0].clone().lerp(points[1], .5), "Unstable", "warning");
}
