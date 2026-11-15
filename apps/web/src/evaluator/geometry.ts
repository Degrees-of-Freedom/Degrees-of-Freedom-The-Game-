/** Analytical geometry of a structure: node numbering, member axes and
 * connected components. It holds no stiffness, so every analysis engine
 * (the Rust solver adapters and the legacy voxel kernel) shares it, and the
 * viewer, design checks and objectives address members and nodes the same
 * way whichever engine produced the response. Lengths are metres. */
import type { EvaluatorMember, EvaluatorModel } from './model';
import type { Context, Element } from './results';
import { ITEMS, S, type Section } from './sections';
import { parse } from './coordinates';
import { localAxes } from './vector';

export interface Component {
  nodes: string[];
  memberIds: number[];
  supported: boolean;
}

/** Traverse analytical endpoints, including isolated loads and unused foundations. */
export function findComponents(keys: string[], idx: Map<string, number>, members: EvaluatorMember[], isF: boolean[]) {
  const neighbours: number[][] = keys.map(() => []);
  for (const member of members) {
    const a = idx.get(member.a)!, b = idx.get(member.b)!;
    neighbours[a].push(b);
    neighbours[b].push(a);
  }
  const components: Component[] = [];
  const labels = new Int32Array(keys.length).fill(-1);
  for (let start = 0; start < keys.length; start++) {
    if (labels[start] >= 0) continue;
    const label = components.length;
    const component: Component = { nodes: [], memberIds: [], supported: false };
    components.push(component);
    const stack = [start];
    labels[start] = label;
    while (stack.length) {
      const node = stack.pop()!;
      component.nodes.push(keys[node]);
      if (isF[node]) component.supported = true;
      for (const next of neighbours[node]) {
        if (labels[next] >= 0) continue;
        labels[next] = label;
        stack.push(next);
      }
    }
  }
  for (const member of members) components[labels[idx.get(member.a)!]].memberIds.push(member.id);
  return { components, labels };
}

/** Every analytical endpoint: member ends and attributed nodes (foundations,
 * joints and loads), in first-seen order. */
export function allNodeKeys(model: EvaluatorModel) {
  const keys = new Set<string>();
  for (const m of model.members) {
    keys.add(m.a);
    keys.add(m.b);
  }
  for (const k in model.attrs) {
    const a = model.attrs[k];
    if (a.found || a.joint || a.load) keys.add(k);
  }
  return [...keys];
}

/** Member axes and end fixity. `a` and `b` are active-node indices. A beam
 * end is rigid when its printed end is fixed or, with no printing, when the
 * node carries a joint. Cables and springs have no rotational fixity. */
export function memberGeometry(model: EvaluatorModel, m: EvaluatorMember, pa: number[], pb: number[], a: number, b: number): Element {
  const it: Section = ITEMS[m.type];
  const d = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]],
    L = Math.hypot(...d);
  const ex = d.map((v) => v / L),
    R = localAxes(ex);
  const cable = it.kind === 'cable';
  const rigidA = it.kind === 'beam' && (m.endA ? m.endA === 'fixed' : !!model.attrs[m.a]?.joint),
    rigidB = it.kind === 'beam' && (m.endB ? m.endB === 'fixed' : !!model.attrs[m.b]?.joint);
  return { m, it, L, R, ex, a, b, cable, rigidA, rigidB };
}

/** Number the supported nodes, build member geometry and find components.
 * Supported nodes are ordered spatially (z, x, y); floating nodes and the
 * members that start on them are left out of `ctx.act` and `ctx.els`. */
export function prepareGeometry(model: EvaluatorModel, keys = allNodeKeys(model)) {
  const idx = new Map(keys.map((k, n) => [k, n]));
  const pos = keys.map((k) => (model.positions?.[k] ?? parse(k)).map((v) => v * S));
  const isF = keys.map((k) => !!model.attrs[k]?.found);
  const { components, labels } = findComponents(keys, idx, model.members, isF);
  const sup = keys.map((_, n) => components[labels[n]].supported);
  const floating = keys.filter((_, n) => !sup[n]);
  const act: number[] = [],
    aid = new Int32Array(keys.length).fill(-1);
  keys.forEach((k, n) => {
    if (sup[n]) act.push(n);
  });
  // Spatial order keeps the legacy kernel's stiffness bandwidth small.
  act.sort(
    (p, q) =>
      pos[p][2] - pos[q][2] || pos[p][0] - pos[q][0] || pos[p][1] - pos[q][1],
  );
  act.forEach((n, a) => (aid[n] = a));
  const els: Element[] = [];
  for (const m of model.members) {
    const na = idx.get(m.a)!,
      nb = idx.get(m.b)!;
    if (!sup[na]) continue;
    els.push(memberGeometry(model, m, pos[na], pos[nb], aid[na], aid[nb]));
  }
  const ctx: Context = { keys, idx, pos, act, aid, NA: act.length, els, isF };
  return { ctx, components, labels, floating };
}
