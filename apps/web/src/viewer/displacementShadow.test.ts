import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { analyzeVoxel } from "../solver/voxel/analyze";
import type { EvaluatorLevel, EvaluatorModel } from "../evaluator/model";
import { deformationField, spanPoint } from "./deformationField";
import { buildDisplacementShadow, peakDisplacement, SHADOW_OPACITY } from "./displacementShadow";
import { basePoint } from "./sceneResults";
import { disposeGroup } from "./sceneGeometry";

const level: EvaluatorLevel = { type: "sandbox", loadCase: "applied", appliedSelfWeight: false, q0: 0, budget: Infinity, inv: null };
const cantilever: EvaluatorModel = {
  members: [{ id: 1, type: "heb", a: "0,0,0", b: "2,0,0", endA: "fixed", endB: "ball" }],
  attrs: { "0,0,0": { found: true }, "2,0,0": { load: 1 } }, nextId: 2,
};

describe("displacement shadow", () => {
  const field = deformationField(analyzeVoxel(cantilever, level), 0);

  it("finds the cantilever's peak at the loaded tip, matching the field's peak", () => {
    const peak = peakDisplacement(field)!;
    expect(peak.t).toBe(1);
    expect(peak.meters).toBeCloseTo(field.peakM, 12);
  });

  it("draws a translucent contour ghost through the amplified deflected tip", () => {
    const group = buildDisplacementShadow(field, 200, basePoint);
    const ghost = group.getObjectByName("Shadow of member 1") as THREE.Mesh;
    const material = ghost.material as THREE.MeshBasicMaterial;
    expect(material).toMatchObject({ transparent: true, opacity: SHADOW_OPACITY, depthWrite: false, vertexColors: true });
    ghost.geometry.computeBoundingBox();
    const tip = spanPoint(field.spans.get(1)![0], 1, 200);
    expect(ghost.geometry.boundingBox!.min.z).toBeLessThan(tip.z + 0.2);
    disposeGroup(group);
  });

  it("joins each displaced joint to its reference position with a drop line", () => {
    const group = buildDisplacementShadow(field, 200, basePoint);
    const travel = group.getObjectByName("Joint travel") as THREE.LineSegments;
    const points = travel.geometry.getAttribute("position");
    // The fixed foundation does not move; only the tip has a drop line.
    expect(points.count).toBe(2);
    expect(points.getZ(0)).toBeCloseTo(0, 9);
    expect(points.getZ(1)).toBeCloseTo(spanPoint(field.spans.get(1)![0], 1, 200).z, 6);
    disposeGroup(group);
  });

  it("draws nothing for an empty field rather than inventing a shape", () => {
    const group = buildDisplacementShadow(deformationField(null, 0), 50, basePoint);
    expect(group.children).toHaveLength(0);
    expect(peakDisplacement(deformationField(null, 0))).toBeUndefined();
  });
});
