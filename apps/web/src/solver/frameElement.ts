import type { VoxelMember, VoxelModel } from './voxelInput';
import type { Element, ElementForce } from './voxelResults';
import { ITEMS, type Section } from './voxelSections';
import {
  localAxes,
  frameK,
  trussK,
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
  const it: Section = ITEMS[m.type];
  const d = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]],
    L = Math.hypot(...d);
  const ex = d.map((v) => v / L),
    R = localAxes(ex);
  const cable = it.kind === 'cable';
  const rigidA = !cable && !!model.attrs[m.a]?.joint,
    rigidB = !cable && !!model.attrs[m.b]?.joint;
  const k =
    it.kind === 'cable'
      ? trussK(it.E, it.A, L)
      : frameK(it.E, it.G, it.A, it.Iy, it.Iz, it.J, L);
  const rel = [];
  if (!cable) {
    if (!rigidA) rel.push(4, 5);
    if (!rigidB) rel.push(10, 11);
  }
  const kgl = toGlobal(condense(k, rel), R);
  const dofs = [];
  for (let q = 0; q < 6; q++) dofs.push(eq[a * 6 + q]);
  for (let q = 0; q < 6; q++) dofs.push(eq[b * 6 + q]);
  return { m, it, L, R, ex, a, b, k, rel, kgl, dofs, cable, rigidA, rigidB };
}
export function recover(e: Element, u: Float64Array): ElementForce {
  const ug = new Float64Array(12);
  for (let q = 0; q < 6; q++) {
    ug[q] = u[e.a * 6 + q];
    ug[6 + q] = u[e.b * 6 + q];
  }
  const ul = vecToLocal(ug, e.R);
  if (e.rel.length) {
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
