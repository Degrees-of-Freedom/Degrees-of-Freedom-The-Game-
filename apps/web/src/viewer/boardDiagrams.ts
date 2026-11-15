import * as THREE from "three";
import type { StructureEvaluation } from "../evaluator/results";
import { verifiedResponse } from "../solver/voxel/linearVerification";
import { spanPoint, type DeformationField } from "./deformationField";

export type SectionAction = 1 | 2 | 4 | 5;
export const boardActions = { 1: "Shear Vy", 2: "Shear Vz", 4: "Moment My", 5: "Moment Mz" } as const;

/** One common magnitude scale per action. Separate polylines retain the two
 * distinct cuts on either side of a joint load or an assembly connection. */
export function boardDiagram(result: StructureEvaluation, action: SectionAction) {
  const combo = result.combos[0];
  const verified = new Set(combo?.components?.filter(scope =>
    scope.status === "computed" && verifiedResponse(scope.verification)).flatMap(scope => scope.memberIds));
  const series = (result.ctx?.els ?? []).flatMap(element => {
    if (element.it.kind !== "beam" || !verified.has(element.m.id)) return [];
    const stations = combo?.ef?.get(element)?.stations;
    if (!stations?.length || stations.some(s => !Number.isFinite(s.forces[action]))) return [];
    return [{ element, stations }];
  });
  let peak = 0;
  for (const {stations} of series) for (const s of stations) peak = Math.max(peak, Math.abs(s.forces[action]));
  return { action, series, peak };
}

export type BoardDiagram = ReturnType<typeof boardDiagram>;

export function drawBoardDiagram(group: THREE.Group, diagram: BoardDiagram, point: (key: string) => THREE.Vector3,
  field: DeformationField | undefined, displacementScale: number) {
  const {action, series, peak} = diagram;
  if (!peak) return;
  const lines: THREE.Vector3[] = [];
  for (const {element, stations} of series) {
    const start = point(element.m.a), end = point(element.m.b);
    const axis = new THREE.Vector3().fromArray(element.R[action === 1 || action === 5 ? 1 : 2]);
    const parent = element.m.parentSpan?.memberId ?? element.m.id;
    const span = field?.spans.get(parent)?.find(s => s.element === element);
    let previous: THREE.Vector3 | undefined;
    for (const station of stations) {
      const base = span ? spanPoint(span, station.fraction, displacementScale) : start.clone().lerp(end, station.fraction);
      const tip = base.clone().addScaledVector(axis, station.forces[action] / peak * 1.5);
      lines.push(base, tip);
      if (previous) lines.push(previous, tip);
      previous = tip;
    }
  }
  const plotted = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lines),
    new THREE.LineBasicMaterial({ color: action < 3 ? 0x80e6b6 : 0xff94d5, depthTest: false, depthWrite: false }));
  plotted.renderOrder = 3;
  group.add(plotted);
}
