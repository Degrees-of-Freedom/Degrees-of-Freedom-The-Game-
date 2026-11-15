import type { Element, FrameSystem } from './types';

/** A hinge's unresisted spin may be oblique in global coordinates. Every beam
 * touching this joint must release that same direction and the external moment
 * must do no work on it. Pick one coordinate per proven null direction as a
 * gauge, without creating springs, support reactions or eliminating translations. */
export function inactiveConnectorSpins(ctx: FrameSystem, F: Float64Array) {
  const gauges = new Set<number>();
  if (!ctx.els.some(e => e.connector)) return gauges;
  const ends = new Map<number, { e: Element; side: number }[]>();
  for (const e of ctx.els) for (const [side, node] of [e.a, e.b].entries()) {
    const list = ends.get(node) ?? [];
    list.push({ e, side });
    ends.set(node, list);
  }
  for (const [node, list] of ends) {
    const candidate = list.find(({ e }) => e.connector);
    const connection = candidate?.e.connector?.ends[candidate.side];
    if (!connection) continue;
    const pivots: { axis: number; vector: number[] }[] = [];
    const offset = 6*node+3;
    for (const [q, direction] of connection.axes.entries()) {
      if (connection.laws[3+q].kind !== 'free') continue;
      if (direction.some((v, i) => Math.abs(v) > 1e-12 && ctx.eq[offset+i] < 0)) continue;
      const hasRestraint = list.some(({ e, side }) => {
        if (e.it.kind !== 'beam') return false;
        // The older editor's implicit pin may still transfer torsion. Only
        // an explicit three-rotation release proves this whole spin is absent.
        if (!e.connector) return (side === 0 ? e.m.endA : e.m.endB) !== 'ball';
        const end = e.connector.ends[side];
        return end.axes.some((a, j) => end.laws[3+j].kind !== 'free' &&
          Math.abs(a.reduce((sum, v, i) => sum + v * direction[i], 0)) > 1e-12);
      });
      if (hasRestraint) continue;
      if (Math.abs(direction.reduce((sum, v, i) => sum + v*F[offset+i], 0)) > 1e-10) return null;
      const vector = [...direction];
      for (const pivot of pivots) {
        const ratio = vector[pivot.axis]/pivot.vector[pivot.axis];
        for (let i=0; i<3; i++) vector[i] -= ratio*pivot.vector[i];
      }
      const axis = vector.indexOf(vector.reduce((best, v) => Math.abs(v)>Math.abs(best) ? v : best, 0));
      if (axis < 0 || Math.abs(vector[axis]) < 1e-12) continue;
      pivots.push({axis, vector});
      gauges.add(ctx.eq[offset+axis]);
    }
  }
  return gauges;
}
