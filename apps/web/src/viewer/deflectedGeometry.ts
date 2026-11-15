import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { assemblySectionGeometry } from "./assemblyGeometry";
import { SHAPE_INTERVALS, spanPoint, type DeflectedSpan, type DeformationField } from "./deformationField";
import { READABLE_SECTION_SCALE, wideFlangeGeometry } from "./sectionGeometry";

/** Sweep the existing section along sampled analytical centrelines. The
 * recovered axial twist rotates the section about the deformed tangent. */
export function deflectedFrameGeometry(spans: DeflectedSpan[], scale: number, radius: number) {
  const pieces = spans.map(span => {
    const { element: e } = span;
    const type = e.m.type;
    const assembled = !!e.m.parentSpan?.assemblyPart;
    const profile = assembled ? assemblySectionGeometry(SHAPE_INTERVALS)
      : type === "ipe" || type === "heb" ? wideFlangeGeometry(type, SHAPE_INTERVALS)
      : new THREE.CylinderGeometry(radius, radius, 1, 12, SHAPE_INTERVALS).rotateX(Math.PI/2);
    const width = assembled || type === "ipe" || type === "heb" ? READABLE_SECTION_SCALE : 1;
    const position = profile.getAttribute("position");
    const ex = new THREE.Vector3().fromArray(e.R[0]), ey = new THREE.Vector3().fromArray(e.R[1]);
    const ez = new THREE.Vector3().fromArray(e.R[2]);
    const stations = Array.from({length: SHAPE_INTERVALS+1}, (_, i) => {
      const t = i / SHAPE_INTERVALS, center = spanPoint(span, t, scale);
      const tangent = spanPoint(span, Math.min(1,t+1e-5), scale)
        .sub(spanPoint(span, Math.max(0,t-1e-5), scale)).normalize();
      const roll = ((1-t)*span.response.ul[3] + t*span.response.ul[9])*scale;
      const orientation = new THREE.Quaternion().setFromUnitVectors(ex, tangent)
        .multiply(new THREE.Quaternion().setFromAxisAngle(ex, roll));
      return { center, y: ey.clone().applyQuaternion(orientation), z: ez.clone().applyQuaternion(orientation) };
    });
    for (let i = 0; i < position.count; i++) {
      const t = Math.max(0, Math.min(1, position.getZ(i)+0.5));
      const { center, y, z } = stations[Math.round(t*SHAPE_INTERVALS)];
      const p = center.clone().addScaledVector(y,width*position.getX(i)).addScaledVector(z,width*position.getY(i));
      position.setXYZ(i,p.x,p.y,p.z);
    }
    profile.computeVertexNormals();
    return profile;
  });
  if (pieces.length === 1) return pieces[0];
  const result = mergeGeometries(pieces);
  for (const piece of pieces) piece.dispose();
  return result;
}

export function undeformedReference(field: DeformationField) {
  const endpoints: THREE.Vector3[] = [];
  for (const spans of field.spans.values()) for (const span of spans) endpoints.push(span.a, span.b);
  const line = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(endpoints),
    new THREE.LineDashedMaterial({ color: 0xffefd4, transparent: true, opacity: 0.72, dashSize: 0.22,
      gapSize: 0.12, depthWrite: false }));
  line.name = "Undeformed reference";
  line.computeLineDistances();
  return line;
}
