import * as THREE from "three";
import { displacementAt, type Element, type ElementForce, type VoxelAnalysis } from "../solver/voxelResults";
import { verifiedResponse } from "../solver/voxelVerification";

export interface DeflectedSpan {
  element: Element;
  response: ElementForce;
  a: THREE.Vector3;
  b: THREE.Vector3;
}

/** Centreline displacement in global metres. The recovered member-end motion
 * includes end slip and rotations released from the joint. Euler–Bernoulli
 * interpolation uses dv/dx = rz and dw/dx = -ry in the element basis. */
export function spanDisplacement(span: DeflectedSpan, t: number) {
  const samples = span.response.motionSamples;
  if (samples && samples.length >= 2) {
    // Interpolate in each actual corotational mesh interval. In particular
    // the fitting's own end translation and spin can differ from its joint's.
    const end = samples.findIndex((sample,i) => i > 0 && t <= sample.fraction);
    const right = end < 0 ? samples.length-1 : end;
    const a = samples[right-1], b = samples[right];
    const width = b.fraction-a.fraction;
    const x = (t-a.fraction)/width, h = x*x*(3-2*x);
    const result = new THREE.Vector3().fromArray(a.motion).multiplyScalar(1-h)
      .addScaledVector(new THREE.Vector3().fromArray(b.motion), h);
    const axis = new THREE.Vector3().fromArray(span.element.ex);
    for (const [sample, weight] of [[a, x*(1-x)**2],[b, -x*x*(1-x)]] as const) {
      const rotation = new THREE.Vector3().fromArray(sample.motion, 3);
      const angle = rotation.length();
      if (angle > 0) {
        const tangentChange = axis.clone().applyAxisAngle(rotation.divideScalar(angle), angle).sub(axis);
        result.addScaledVector(tangentChange, weight * width * span.element.L);
      }
    }
    return result;
  }
  const { element: { R, L, it }, response: { ul } } = span;
  let y = (1-t)*ul[1] + t*ul[7], z = (1-t)*ul[2] + t*ul[8];
  if (it.kind === "beam") {
    const h = t*t*(3-2*t), left = L*t*(1-t)**2, right = L*t*t*(t-1);
    y = (1-h)*ul[1] + h*ul[7] + left*ul[5] + right*ul[11];
    z = (1-h)*ul[2] + h*ul[8] - left*ul[4] - right*ul[10];
  }
  const x = (1-t)*ul[0] + t*ul[6];
  return new THREE.Vector3(
    x*R[0][0] + y*R[1][0] + z*R[2][0],
    x*R[0][1] + y*R[1][1] + z*R[2][1],
    x*R[0][2] + y*R[1][2] + z*R[2][2],
  );
}

export function spanPoint(span: DeflectedSpan, t: number, scale: number) {
  return span.a.clone().lerp(span.b, t).addScaledVector(spanDisplacement(span, t), scale);
}

export const SHAPE_INTERVALS = 16;

/** Index by physical parent for drawing and analytical ID for submember/port
 * inspection. Independent coincident endpoints retain their own solutions. */
export function deformationField(result: VoxelAnalysis | null, comboIndex: number) {
  const spans = new Map<number, DeflectedSpan[]>(), nodes = new Map<string, Float64Array>();
  const unavailable = new Set<number>();
  let peakM = 0;
  const combo = result?.combos[comboIndex], ctx = result?.ctx;
  if (ctx && combo) {
    const verified = new Set<number>();
    const parentIds = result?.physicalParents ?? new Map(ctx.els.map(e => [e.m.id, e.m.parentSpan?.memberId ?? e.m.id]));
    for (const region of combo.components ?? []) {
      if (region.status !== "computed" || !verifiedResponse(region.verification)) {
        for (const id of region.memberIds) unavailable.add(parentIds.get(id) ?? id);
        continue;
      }
      region.memberIds.forEach(id => verified.add(id));
      for (const key of region.nodes) {
        const id = ctx.idx.get(key);
        const u = id === undefined ? undefined : displacementAt(combo, ctx.aid[id]);
        if (u) nodes.set(key, u);
      }
    }
    for (const e of ctx.els) {
      const parent = e.m.parentSpan?.memberId ?? e.m.id;
      const response = combo.ef?.get(e);
      if (!verified.has(e.m.id) || !response) { unavailable.add(parent); continue; }
      const span = { element: e, response, a: new THREE.Vector3().fromArray(ctx.pos[ctx.act[e.a]]),
        b: new THREE.Vector3().fromArray(ctx.pos[ctx.act[e.b]]) };
      const group = spans.get(parent) ?? [];
      group.push(span);
      spans.set(parent, group);
      for (let i = 0; i <= SHAPE_INTERVALS; i++) peakM = Math.max(peakM, spanDisplacement(span, i/SHAPE_INTERVALS).length());
    }
  }
  return { spans, nodes, unavailable, peakM };
}

export type DeformationField = ReturnType<typeof deformationField>;
