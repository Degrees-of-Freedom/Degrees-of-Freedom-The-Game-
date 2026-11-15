import type { VoxelAnalysis } from './voxel';
import { RELEASE_SOLVER } from './voxelVerification';

/** A visual interpretation of member forces, not a separate structural analysis. */
export interface LoadPathMember {
  memberId: number;
  a: string;
  b: string;
  length: number;
  force: number;
  axial: number;
  mode: 'tension' | 'compression' | 'bending' | 'none';
  direction: -1 | 0 | 1;
  verticalTransferKN?: number;
}
export interface LoadPath {
  members: Map<number, LoadPathMember>;
  maxForce: number;
  distances: Map<string, number>;
  parents: Map<string, { next: string; id: number }>;
  shares: { key: string; verticalForce: number; fraction: number }[];
  totalVertical: number;
}
/** Compute a force-weighted route toward supports for one combination. */
export function computeLoadPath(
  result: VoxelAnalysis,
  comboIndex: number,
): LoadPath | null {
  const c = result.combos[comboIndex],
    ctx = result.ctx;
  if (
    result.error ||
    !ctx ||
    !c ||
    c.fail ||
    !c.ef ||
    !c.reac
  )
    return null;
  const members = new Map<number, LoadPathMember>();
  const release = c.components?.some(scope => scope.verification?.formulation === RELEASE_SOLVER);
  if (!release && (result.mechanism || result.unresolved)) return null;
  let maxForce = 1e-9;
  for (const e of ctx.els) {
    const r = c.ef.get(e);
    if (!r) continue;
    const f = r.f,
      force = Math.max(
        Math.hypot(f[0], f[1], f[2]),
        Math.hypot(f[6], f[7], f[8]),
      ),
      axial = r.cableTension ?? f[6];
    const mode = r.slack
      ? 'none'
      : Math.abs(axial) >= 0.7 * force
        ? axial > 0
          ? 'tension'
          : 'compression'
        : 'bending';
    members.set(e.m.id, {
      memberId: e.m.id,
      a: e.m.a,
      b: e.m.b,
      length: e.L,
      force: release ? Math.abs(r.verticalTransferKN ?? 0) : force,
      axial,
      mode,
      direction: 0,
      ...(release && {verticalTransferKN: r.verticalTransferKN}),
    });
    maxForce = Math.max(maxForce, members.get(e.m.id)!.force);
  }
  const adj = new Map<string, { to: string; weight: number; id: number }[]>();
  for (const x of members.values()) {
    if (x.force < (release ? 1e-8*Math.max(1,maxForce) : 0.01*maxForce)) continue;
    const weight = (x.length * maxForce) / (x.force + 0.02 * maxForce);
    for (const [p, q] of [
      [x.a, x.b],
      [x.b, x.a],
    ]) {
      // Search upstream from a receiving support, using only edges whose
      // measured vertical transfer reaches the current node.
      if (release && (x.verticalTransferKN! > 0 ? p !== x.b : p !== x.a)) continue;
      const edges = adj.get(p) ?? [];
      edges.push({ to: q, weight, id: x.memberId });
      adj.set(p, edges);
    }
  }
  const distances = new Map<string, number>(),
    parents = new Map<string, { next: string; id: number }>(),
    done = new Set<string>();
  ctx.act.forEach((n, a) => {
    if (ctx.isF[n] && (!release || (c.reac?.[a]?.[2] ?? 0) > 0)) distances.set(ctx.keys[n], 0);
  });
  for (;;) {
    let best: string | null = null,
      bd = Infinity;
    for (const [key, d] of distances)
      if (!done.has(key) && d < bd) {
        bd = d;
        best = key;
      }
    if (best === null) break;
    done.add(best);
    for (const { to, weight, id } of adj.get(best) ?? []) {
      const nd = bd + weight;
      if (nd < (distances.get(to) ?? Infinity)) {
        distances.set(to, nd);
        parents.set(to, { next: best, id });
      }
    }
  }
  for (const x of members.values()) {
    const da = distances.get(x.a),
      db = distances.get(x.b);
    if (release) {
      // Positive-face Fz is the force on the lower-station side. Under a
      // simultaneous downward gravity case it measures signed load transfer
      // along increasing station, independently of section axial sign.
      const transfer = x.verticalTransferKN ?? 0;
      x.direction = x.mode === 'none' || Math.abs(transfer) <= 1e-8*Math.max(1,maxForce) ? 0 : transfer > 0 ? 1 : -1;
    } else x.direction =
      da === undefined || db === undefined || Math.abs(da - db) < 1e-9
        ? 0
        : da > db
          ? 1
          : -1;
  }
  let totalVertical = 0;
  const shares = Object.entries(c.reac).map(([a, r]) => {
    const verticalForce = release ? r[2] : Math.max(0, r[2]);
    totalVertical += verticalForce;
    return { key: ctx.keys[ctx.act[Number(a)]], verticalForce, fraction: 0 };
  });
  if (release) totalVertical = result.appliedGravityKN ?? 0;
  shares.forEach((s) => {
    s.fraction = totalVertical > 0 ? s.verticalForce / totalVertical : 0;
  });
  shares.sort((a, b) => b.verticalForce - a.verticalForce);
  return { members, maxForce, distances, parents, shares, totalVertical };
}
/** Follow the route from a node to a support, if one is reachable. */
export function traceToGround(
  path: LoadPath,
  key: string,
): { members: Set<number>; nodes: Set<string>; end: string | null } {
  const members = new Set<number>(),
    nodes = new Set([key]);
  let cur = key,
    guard = 0;
  while (path.parents.has(cur) && guard++ < 1000) {
    const p = path.parents.get(cur)!;
    members.add(p.id);
    cur = p.next;
    nodes.add(cur);
  }
  return { members, nodes, end: path.distances.get(cur) === 0 ? cur : null };
}
