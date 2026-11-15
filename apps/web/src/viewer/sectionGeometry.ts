import * as THREE from "three";
import { localAxes } from "../solver/frameMath";
import { SECTION_GEOMETRY } from "../solver/voxelSections";

export type WideFlange = "ipe" | "heb";
export const READABLE_SECTION_SCALE = 1.5;

/** Unit-length prism along mesh Z. The section dimensions are metres in the
 * solver's local Y/Z plane. Nominal rolled sections omit the root fillets. */
export function wideFlangeGeometry(type: WideFlange, steps = 1): THREE.ExtrudeGeometry {
  const { width, depth, web, flange } = SECTION_GEOMETRY[type];
  const w = width / 2, d = depth / 2, t = web / 2, inner = d - flange;
  const outline = new THREE.Shape();
  outline.moveTo(-w, -d);
  outline.lineTo(w, -d);
  outline.lineTo(w, -inner);
  outline.lineTo(t, -inner);
  outline.lineTo(t, inner);
  outline.lineTo(w, inner);
  outline.lineTo(w, d);
  outline.lineTo(-w, d);
  outline.lineTo(-w, inner);
  outline.lineTo(-t, inner);
  outline.lineTo(-t, -inner);
  outline.lineTo(-w, -inner);
  outline.closePath();
  return new THREE.ExtrudeGeometry(outline, { depth: 1, steps, bevelEnabled: false }).translate(0, 0, -0.5);
}

/** Fit a unit prism to displayed endpoints. Carry the reference roll onto a
 * deformed chord by the minimum rotation, without inventing member twist. */
export function poseSection(
  mesh: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3,
  referenceDirection: THREE.Vector3, transverseScale = READABLE_SECTION_SCALE,
) {
  const direction = end.clone().sub(start);
  const span = direction.length();
  const ex = referenceDirection.clone().normalize();
  const ey = new THREE.Vector3().fromArray(localAxes(ex.toArray())[1]);
  // The solver's near-vertical reference is global Y. Project it into the
  // section plane when the display chord is nearly, but not exactly, vertical.
  ey.addScaledVector(ex, -ey.dot(ex)).normalize();
  const ez = new THREE.Vector3().crossVectors(ex, ey);
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ey, ez, ex));
  if (span > 0) mesh.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(ex, direction.normalize()));
  mesh.position.copy(start).lerp(end, 0.5);
  mesh.scale.set(transverseScale, transverseScale, span);
}
