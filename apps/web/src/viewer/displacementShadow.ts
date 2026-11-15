import * as THREE from "three";
import { displacementColor } from "./contourRamp";
import { deflectedFrameGeometry } from "./deflectedGeometry";
import { SHAPE_INTERVALS, spanDisplacement, spanPoint, type DeflectedSpan, type DeformationField } from "./deformationField";
import { REFERENCE_COLOR } from "./viewPalette";
import { addSceneLabel } from "./sceneLabels";
import { formatValue, isNegligible } from "./viewFormat";

/** Translucency of the deflected ghost; low enough to read the members at rest through it. */
export const SHADOW_OPACITY = 0.42;

/**
 * Displacement shadow: the frame stays at its reference position while a
 * translucent, contour-coloured ghost shows the verified deflected shape at
 * the displayed exaggeration. Dashed drop lines join each solved joint to its
 * displaced position. Only verified spans in the field are drawn; unavailable
 * members get no ghost rather than an invented one.
 */
export function buildDisplacementShadow(field: DeformationField, scale: number, basePoint: (key: string) => THREE.Vector3,
  trueScale = false) {
  const group = new THREE.Group();
  group.name = "Displacement shadow";
  const contour = field.peakM > 0 ? field.peakM : undefined;
  const lineXyz: number[] = [], lineRgb: number[] = [];
  const color = new THREE.Color();
  for (const [parent, spans] of field.spans) {
    const beams = spans.filter(span => span.element.it.kind === "beam");
    if (beams.length) {
      const mesh = new THREE.Mesh(deflectedFrameGeometry(beams, scale, 0.09, trueScale, contour),
        new THREE.MeshBasicMaterial({ vertexColors: contour !== undefined, color: contour === undefined ? REFERENCE_COLOR : "#ffffff",
          transparent: true, opacity: SHADOW_OPACITY, depthWrite: false }));
      mesh.name = "Shadow of member " + parent;
      mesh.renderOrder = 4;
      group.add(mesh);
    }
    // Axial-only elements (trusses, cables, springs) have no swept section: trace their centreline.
    for (const span of spans) {
      if (span.element.it.kind === "beam") continue;
      for (let i = 0; i < SHAPE_INTERVALS; i++) {
        for (const t of [i / SHAPE_INTERVALS, (i + 1) / SHAPE_INTERVALS]) {
          lineXyz.push(...spanPoint(span, t, scale).toArray());
          const fraction = contour ? spanDisplacement(span, t).length() / contour : 0;
          lineRgb.push(...displacementColor(fraction, color).toArray());
        }
      }
    }
  }
  if (lineXyz.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(lineXyz, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(lineRgb, 3));
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false }));
    lines.name = "Shadow of axial members";
    lines.renderOrder = 4;
    group.add(lines);
  }
  const drops: THREE.Vector3[] = [];
  for (const [key, u] of field.nodes) {
    const from = basePoint(key);
    const to = from.clone().add(new THREE.Vector3(u[0], u[1], u[2]).multiplyScalar(scale));
    if (from.distanceToSquared(to) > 1e-6) drops.push(from, to);
  }
  if (drops.length) {
    const travel = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(drops),
      new THREE.LineDashedMaterial({ color: REFERENCE_COLOR, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.8, depthWrite: false }));
    travel.computeLineDistances();
    travel.name = "Joint travel";
    travel.renderOrder = 5;
    group.add(travel);
  }
  return group;
}

/**
 * Location of the field's peak calculated displacement, sampled exactly as
 * `deformationField` computes `peakM`, so the label and legend agree.
 */
export function peakDisplacement(field: DeformationField): { span: DeflectedSpan; t: number; meters: number } | undefined {
  let best: { span: DeflectedSpan; t: number; meters: number } | undefined;
  for (const spans of field.spans.values()) for (const span of spans) {
    for (let i = 0; i <= SHAPE_INTERVALS; i++) {
      const t = i / SHAPE_INTERVALS, meters = spanDisplacement(span, t).length();
      if (Number.isFinite(meters) && meters > (best?.meters ?? 0)) best = { span, t, meters };
    }
  }
  return best;
}

/** Label the peak calculated displacement at its displayed position, in millimetres. */
export function labelPeakDisplacement(group: THREE.Group, field: DeformationField, scale: number) {
  const peak = peakDisplacement(field);
  if (!peak || isNegligible(1000 * peak.meters)) return;
  addSceneLabel(group, spanPoint(peak.span, peak.t, scale), `δ max ${formatValue(1000 * peak.meters)} mm`, "deflection");
}
