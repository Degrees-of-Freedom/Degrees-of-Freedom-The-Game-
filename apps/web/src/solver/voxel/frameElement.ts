import type { VoxelMember, VoxelModel } from '../../evaluator/model';
import type { Element, ElementForce } from './types';
import { memberGeometry } from '../../evaluator/geometry';
import { connectorSlips, reduceConnections, recoverConnectorMotion, type FrameConnection } from './frameConnections';
import {
  frameK,
  trussK,
  axialK,
  condense,
  toGlobal,
  vecToLocal,
  gaussSolve,
} from './frameMath';
export function makeElement(
  model: VoxelModel,
  m: VoxelMember,
  pa: number[],
  pb: number[],
  a: number,
  b: number,
  eq: Int32Array,
): Element {
  const { it, L, R, rigidA, rigidB } = memberGeometry(model, m, pa, pb, a, b);
  // Unused collars carry no external force. Combining their series segments
  // gives k/fraction for the active piece, independently of its placed length.
  const fraction = m.parentSpan ? (m.parentSpan.toQuarter - m.parentSpan.fromQuarter) / 4 : 1;
  const k =
    it.kind === 'spring' ? axialK((m.springStiffnessNPerM ?? it.stiffnessNPerM) / 1000 / fraction) : it.kind === 'cable'
      ? trussK(it.E, it.A, L)
      : frameK(it.E, it.G, it.A, it.Iy, it.Iz, it.J, L);
  const rel = [];
  if (it.kind === 'beam') {
    // One end release eliminates the whole torsion spring. Releasing both in
    // recovery would introduce a redundant rigid-body rotation in its subsystem.
    if (m.endA === 'ball') rel.push(3);
    else if (m.endB === 'ball') rel.push(9);
    if (!rigidA) rel.push(4, 5);
    if (!rigidB) rel.push(10, 11);
  }
  let connector: Element['connector'];
  if (m.connectionA || m.connectionB) {
    // Fixed and ball retain the legacy fast path when neither end needs a
    // general law. Translate the opposite end exactly on a mixed-law frame.
    const standard = (rigid: boolean): FrameConnection => ({
      axes: [[1,0,0], [0,1,0], [0,0,1]],
      laws: [{kind:'locked'}, {kind:'locked'}, {kind:'locked'},
        {kind:rigid?'locked':'free'}, {kind:rigid?'locked':'free'}, {kind:rigid?'locked':'free'}],
    });
    const ends: [FrameConnection, FrameConnection] = [
      m.connectionA ?? standard(rigidA), m.connectionB ?? standard(rigidB),
    ];
    connector = {ends, reduction: reduceConnections(k, connectorSlips(ends, R))};
  }
  const kgl = toGlobal(connector?.reduction.stiffness ?? condense(k, rel), R);
  const dofs = [];
  for (let q = 0; q < 6; q++) dofs.push(eq[a * 6 + q]);
  for (let q = 0; q < 6; q++) dofs.push(eq[b * 6 + q]);
  return { ...memberGeometry(model, m, pa, pb, a, b), k, rel, kgl, dofs, ...(connector && {connector}) };
}
export function recover(e: Element, u: Float64Array): ElementForce {
  const ug = new Float64Array(12);
  for (let q = 0; q < 6; q++) {
    ug[q] = u[e.a * 6 + q];
    ug[6 + q] = u[e.b * 6 + q];
  }
  let ul = vecToLocal(ug, e.R);
  if (e.connector) ul = recoverConnectorMotion(ul, e.connector.reduction.eliminations);
  else if (e.rel.length) {
    const r = e.rel,
      M = [],
      rhs = [];
    for (const ri of r) {
      M.push(r.map((c) => e.k[ri * 12 + c]));
      let s = 0;
      for (let c = 0; c < 12; c++)
        if (!r.includes(c)) s -= e.k[ri * 12 + c] * ul[c];
      rhs.push(s);
    }
    const sol = gaussSolve(M, rhs);
    r.forEach((ri, i) => (ul[ri] = sol[i]));
  }
  const f = new Float64Array(12);
  for (let i = 0; i < 12; i++) {
    let s = 0;
    for (let j = 0; j < 12; j++) s += e.k[i * 12 + j] * ul[j];
    f[i] = s;
  }
  return { ul, f };
}
