import { nodeValid } from "../../game/terrain";
import { canFound } from "../../game/terrain";
import {
  nodeKey,
  parseNodeKey,
  type GameModel,
  type GridPoint,
  type MemberType,
} from "../../game/model";
import { ITEMS } from "../../game/inventory";
import type { GoalScenario } from "../types";
import { nodeZone } from "../zones";
import {
  actionsBetween,
  analyze,
  cloneModel,
  foundationsLeft,
  jointsLeft,
  MemberGeometry,
  MinHeap,
  modelCost,
  supplyLeft,
  type PlanResult,
  type Planner,
} from "./common";

const DIRECTIONS: GridPoint[] = (() => {
  const out: GridPoint[] = [];
  for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++)
      for (let z = -1; z <= 1; z++) if (x || y || z) out.push([x, y, z]);
  return out;
})();

/** Upgrade path when a section fails its checks: stiffer and costlier. */
const UPGRADE: Partial<Record<MemberType, MemberType>> = { shs: "glulam", glulam: "ipe", ipe: "heb" };

export interface GraphPlannerOptions {
  /** Sections to start new members from (each is tried; the cheapest solved plan wins). */
  baseTypes: readonly MemberType[];
  /** Cells around the weights' footprint the search may use. */
  margin: number;
}

/**
 * Graph search plus procedural build-up.
 *
 * 1. Graph: lattice nodes are vertices; every legal member (terrain, zones,
 *    length) is an edge priced at section cost, half a joint and a little for
 *    length. Existing structure costs nothing to start from; a new foundation
 *    costs its price.
 * 2. Growth: weights are connected one at a time by the cheapest path, so later
 *    weights branch off earlier structure (an incremental Steiner tree). Every
 *    order of up to four weights is tried and the cheapest solved result kept.
 * 3. Repair: while the solver reports a mechanism, add the moment connection
 *    that frees the most nodes; then upgrade sections whose utilisation exceeds
 *    1. Both steps are driven by the game's own analysis.
 */
export class GraphPlanner implements Planner {
  readonly name = "graph";
  private readonly options: GraphPlannerOptions;

  constructor(options: Partial<GraphPlannerOptions> = {}) {
    this.options = { baseTypes: ["glulam", "ipe"], margin: 3, ...options };
  }

  plan(scenario: GoalScenario, base: GameModel): PlanResult {
    const open = this.openWeights(base);
    let best: PlanResult | null = null;
    // Shared trees save material but can leave mechanisms under heavy point
    // loads, so independent columns are searched too.
    for (const share of [true, false])
      for (const type of this.options.baseTypes)
        for (const order of permutations(open).slice(0, 24)) {
          const attempt = this.build(scenario, base, order, type, share);
          if (!best || better(attempt, best)) best = attempt;
          if (share && open.length <= 1) break; // identical to the unshared plan
        }
    return best ?? this.finish(scenario, base, base);
  }

  private openWeights(model: GameModel): string[] {
    const supported = supportedKeys(model);
    return Object.keys(model.attrs).filter((k) => model.attrs[k].target && !supported.has(k));
  }

  private build(scenario: GoalScenario, base: GameModel, order: string[], type: MemberType, share: boolean): PlanResult {
    const model = cloneModel(base);
    const geometry = new MemberGeometry(scenario.level, scenario.zones);
    for (const weight of order) {
      const path = this.cheapestPath(scenario, model, geometry, weight, type, share);
      if (!path) return { ...this.finish(scenario, base, model), solved: false, note: `No path to ${weight}` };
      this.addPath(model, path, type);
    }
    return this.finish(scenario, base, this.repair(scenario, model, type, geometry));
  }

  /** Dijkstra from supported nodes and legal foundation sites to `target`. */
  private cheapestPath(
    scenario: GoalScenario,
    model: GameModel,
    geometry: MemberGeometry,
    target: string,
    type: MemberType,
    share: boolean,
    avoid: ReadonlySet<string> = new Set(),
  ): string[] | null {
    const { level, zones = [] } = scenario;
    const goal = parseNodeKey(target);
    const supported = supportedKeys(model);
    const weights = Object.keys(model.attrs).filter((k) => model.attrs[k].target).map(parseNodeKey);
    const lo = [0, 1].map((i) => Math.max(0, Math.min(...weights.map((w) => w[i])) - this.options.margin));
    const hi = [0, 1].map((i) => Math.min(i ? level.ny : level.nx, Math.max(...weights.map((w) => w[i])) + this.options.margin));
    const inRegion = (p: GridPoint) =>
      p[0] >= lo[0] && p[0] <= hi[0] && p[1] >= lo[1] && p[1] <= hi[1] && p[2] <= level.nz;

    const dist = new Map<string, number>();
    const prev = new Map<string, string>();
    const heap = new MinHeap<string>();
    const start = (key: string, cost: number) => {
      if (cost < (dist.get(key) ?? Infinity)) {
        dist.set(key, cost);
        heap.push(key, cost);
      }
    };
    // Unshared plans still start from the ground, but never from other columns.
    if (share) for (const key of supported) start(key, 0);
    if (foundationsLeft(scenario, model) > 0)
      for (let i = lo[0]; i <= hi[0]; i++)
        for (let j = lo[1]; j <= hi[1]; j++) {
          const p: GridPoint = [i, j, 0];
          if (canFound(level, p) && !nodeZone(zones, p)) start(nodeKey(...p), ITEMS.found.cost);
        }

    const edge = ITEMS[type].cost + ITEMS.joint.cost / 2;
    for (let top = heap.pop(); top; top = heap.pop()) {
      const key = top.v;
      if (top.p > (dist.get(key) ?? Infinity)) continue;
      if (key === target) break;
      const p = parseNodeKey(key);
      for (const dir of DIRECTIONS)
        for (let len = 1; len <= ITEMS[type].maxCells; len++) {
          const q: GridPoint = [p[0] + dir[0] * len, p[1] + dir[1] * len, p[2] + dir[2] * len];
          if (!inRegion(q) || !nodeValid(level, q) || !geometry.fits(p, q, type)) continue;
          const qKey = nodeKey(...q);
          if (avoid.has(qKey)) continue;
          // Slender members buckle, so cost grows with length squared; a small
          // pull toward the weight breaks ties between equal-cost paths.
          const length = Math.hypot(dir[0], dir[1], dir[2]) * len;
          const toward = Math.hypot(...goal.map((g, i) => g - q[i])) - Math.hypot(...goal.map((g, i) => g - p[i]));
          const cost = top.p + edge + 40 * length * length + 0.5 * toward;
          if (cost < (dist.get(qKey) ?? Infinity)) {
            dist.set(qKey, cost);
            prev.set(qKey, key);
            heap.push(qKey, cost);
          }
        }
    }
    if (!dist.has(target)) return null;
    const path = [target];
    while (prev.has(path[0]) && !(share && supported.has(path[0]))) path.unshift(prev.get(path[0])!);
    return path;
  }

  private addPath(model: GameModel, path: string[], type: MemberType): void {
    // A path starts at a node that is already a foundation or support, or at a
    // new foundation site.
    if (!supportedKeys(model).has(path[0])) (model.attrs[path[0]] ??= {}).found = true;
    for (let i = 1; i < path.length; i++)
      model.members.push({ id: model.nextId++, a: path[i - 1], b: path[i], type });
  }

  /**
   * Beam search over repairs. Moves: add the moment connection that frees the
   * most nodes (mechanisms), upgrade the worst overloaded section, or add a
   * second leg to a weight. Order matters (upgrading first can spoil a frame
   * that reinforcing would have solved), so a few states are kept at each
   * depth and ranked by the game's own objectives.
   */
  private repair(
    scenario: GoalScenario,
    start: GameModel,
    type: MemberType,
    geometry: MemberGeometry,
  ): GameModel {
    const width = 3;
    let beam = [start];
    let best = start;
    let bestScore = score(scenario, start);
    for (let depth = 0; depth < 14; depth++) {
      const next: { model: GameModel; score: number }[] = [];
      for (const model of beam) {
        const result = analyze(scenario, model);
        if (result.success) return model;
        const moves: (GameModel | null)[] = [];
        if (result.mechanism) {
          moves.push(jointsLeft(scenario, model) > 0 ? this.bestJoint(scenario, model) : null);
        } else if (!result.unresolved) {
          moves.push(this.upgradeWorst(scenario, model, result.members));
          moves.push(this.reinforce(scenario, model, type, geometry));
        }
        for (const m of moves) if (m) next.push({ model: m, score: score(scenario, m) });
      }
      if (!next.length) break;
      next.sort((x, y) => y.score - x.score);
      beam = dedupe(next).slice(0, width).map((n) => n.model);
      if (next[0].score > bestScore) {
        bestScore = next[0].score;
        best = next[0].model;
      }
    }
    return best;
  }

  /**
   * Add an independent second leg to the weight where it helps most: a path
   * from new ground that avoids the structure already there, then joints. The
   * legs form a frame, which resists the sway a single slender leg cannot.
   */
  private reinforce(
    scenario: GoalScenario,
    model: GameModel,
    type: MemberType,
    geometry: MemberGeometry,
  ): GameModel | null {
    const current = analyze(scenario, model).objectives.filter((o) => o.ok).length;
    const used = new Set(model.members.flatMap((m) => [m.a, m.b]));
    let best: { model: GameModel; score: number } | null = null;
    for (const weight of Object.keys(model.attrs).filter((k) => model.attrs[k].target)) {
      const avoid = new Set([...used].filter((k) => k !== weight));
      const path = this.cheapestPath(scenario, model, geometry, weight, type, false, avoid);
      if (!path || path.length < 2) continue;
      let candidate = cloneModel(model);
      this.addPath(candidate, path, type);
      for (let i = 0; i < 12 && analyze(scenario, candidate).mechanism && jointsLeft(scenario, candidate) > 0; i++)
        candidate = this.bestJoint(scenario, candidate) ?? candidate;
      const r = analyze(scenario, candidate);
      const score = (r.success ? 100 : 0) + r.objectives.filter((o) => o.ok).length - 20 * Number(r.mechanism);
      if (!best || score > best.score) best = { model: candidate, score };
    }
    return best && best.score > current ? best.model : null;
  }

  private bestJoint(scenario: GoalScenario, model: GameModel): GameModel | null {
    const ends = new Set(model.members.flatMap((m) => [m.a, m.b]));
    let best: { model: GameModel; score: [number, number] } | null = null;
    for (const key of ends) {
      if (model.attrs[key]?.joint) continue;
      const candidate = cloneModel(model);
      (candidate.attrs[key] ??= {}).joint = true;
      const r = analyze(scenario, candidate);
      const score: [number, number] = [r.unstable.size, -r.objectives.filter((o) => o.ok).length];
      if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && score[1] < best.score[1]))
        best = { model: candidate, score };
    }
    return best?.model ?? null;
  }

  private upgradeWorst(
    scenario: GoalScenario,
    model: GameModel,
    members: Record<number, { util: number }>,
  ): GameModel | null {
    const ranked = model.members
      .filter((m) => (members[m.id]?.util ?? 0) > 1)
      .sort((a, b) => members[b.id].util - members[a.id].util);
    for (const m of ranked) {
      const type = UPGRADE[m.type];
      if (!type || !scenario.memberTypes.includes(type) || supplyLeft(scenario, model, type) <= 0) continue;
      const next = cloneModel(model);
      next.members.find((x) => x.id === m.id)!.type = type;
      return next;
    }
    return null;
  }

  private finish(scenario: GoalScenario, base: GameModel, model: GameModel): PlanResult {
    const result = analyze(scenario, model);
    return {
      actions: actionsBetween(base, model),
      model,
      solved: !!result.success,
      cost: modelCost(model),
    };
  }
}

/** Higher is better: solved, then objectives passed, fewer unstable nodes, then cost. */
function score(scenario: GoalScenario, model: GameModel): number {
  const r = analyze(scenario, model);
  return (
    (r.success ? 1000 : 0) +
    r.objectives.filter((o) => o.ok).length * 10 -
    (r.mechanism ? 40 : 0) -
    r.unstable.size -
    modelCost(model) / 10_000
  );
}

function dedupe<T extends { model: GameModel }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(({ model }) => {
    const key =
      model.members.map((m) => `${m.a}>${m.b}:${m.type}`).sort().join(";") +
      "|" + Object.entries(model.attrs).filter(([, a]) => a.joint || a.found).map(([k, a]) => `${k}${a.joint ? "j" : ""}${a.found ? "f" : ""}`).sort().join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const better = (a: PlanResult, b: PlanResult): boolean =>
  a.solved !== b.solved ? a.solved : a.cost < b.cost;

function supportedKeys(model: GameModel): Set<string> {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while ((parent.get(r) ?? r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  for (const m of model.members) {
    for (const k of [m.a, m.b]) if (!parent.has(k)) parent.set(k, k);
    parent.set(find(m.a), find(m.b));
  }
  const roots = new Set<string>();
  for (const [k, a] of Object.entries(model.attrs))
    if (a.found) {
      if (!parent.has(k)) parent.set(k, k);
      roots.add(find(k));
    }
  return new Set([...parent.keys()].filter((k) => roots.has(find(k))));
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  if (items.length > 4) return [items];
  return items.flatMap((x, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [x, ...rest]),
  );
}
