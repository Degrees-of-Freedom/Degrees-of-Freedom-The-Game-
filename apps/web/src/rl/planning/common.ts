import { ITEMS } from "../../game/inventory";
import { memberIssue } from "../../game/placementRules";
import {
  nodeKey,
  parseNodeKey,
  type GameModel,
  type GridPoint,
  type Level,
  type MemberType,
} from "../../game/model";
import { analyzeVoxel } from "../../solver/voxel";
import type { VoxelAnalysis } from "../../solver/voxel";
import { actionId } from "../actions";
import type { GoalAction, GoalScenario, KeepOutZone } from "../types";
import { memberZone, nodeZone } from "../zones";

/** What a planner returns for the weights currently on the board. */
export interface PlanResult {
  /** Build actions in an order the environment accepts, growing from existing nodes. */
  actions: GoalAction[];
  /** The model once the actions are applied. */
  model: GameModel;
  /** Whether the planner's own analysis shows every objective passing. */
  solved: boolean;
  cost: number;
  /** Why it failed, if it did. */
  note?: string;
}

/**
 * A planner builds a structure for the weights now on `model` and extends
 * what is already built. It sees the scenario's rules (zones, supply) but
 * learns nothing between calls.
 */
export interface Planner {
  readonly name: string;
  plan(scenario: GoalScenario, model: GameModel): PlanResult;
}

export const cloneModel = (m: GameModel): GameModel => structuredClone(m);

export function analyze(scenario: GoalScenario, model: GameModel): VoxelAnalysis {
  return analyzeVoxel(model, scenario.level);
}

export { costOf as modelCost } from "../../game/inventory";

/** Terrain and zone checks for a member, cached because planners ask repeatedly. */
export class MemberGeometry {
  private readonly cache = new Map<string, boolean>();
  private readonly unlimited: Level;
  private readonly empty: GameModel = { members: [], attrs: {}, nextId: 1 };

  constructor(
    level: Level,
    private readonly zones: readonly KeepOutZone[] = [],
  ) {
    this.unlimited = { ...level, inv: null };
  }

  fits(a: GridPoint, b: GridPoint, type: MemberType): boolean {
    const key = `${type}:${a.join(",")}>${b.join(",")}`;
    let ok = this.cache.get(key);
    if (ok === undefined) {
      ok =
        !nodeZone(this.zones, a) &&
        !nodeZone(this.zones, b) &&
        !memberZone(this.zones, a, b) &&
        memberIssue(this.unlimited, this.empty, a, b, type) === null;
      this.cache.set(key, ok);
    }
    return ok;
  }
}

/** A minimal binary min-heap keyed by priority. */
export class MinHeap<T> {
  private readonly items: { p: number; v: T }[] = [];
  get size(): number {
    return this.items.length;
  }
  push(v: T, p: number): void {
    const a = this.items;
    a.push({ p, v });
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent].p <= a[i].p) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }
  pop(): { v: T; p: number } | undefined {
    const a = this.items;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].p < a[m].p) m = l;
        if (r < a.length && a[r].p < a[m].p) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Actions that turn `base` into `target`, ordered so each is legal where it is
 * played: new foundations, then members grown outward from nodes that already
 * exist (weights, foundations, earlier members), then joints once their node
 * has a member. Assumes `target` only adds to `base`.
 */
export function actionsBetween(base: GameModel, target: GameModel): GoalAction[] {
  const actions: GoalAction[] = [];
  const occupied = new Set<string>();
  for (const m of base.members) (occupied.add(m.a), occupied.add(m.b));
  for (const [key, a] of Object.entries(base.attrs))
    if (a.found || a.joint || a.load) occupied.add(key);

  for (const [key, a] of Object.entries(target.attrs))
    if (a.found && !base.attrs[key]?.found) {
      actions.push({ kind: "foundation", at: parseNodeKey(key) });
      occupied.add(key);
    }

  const placed = new Set(base.members.map((m) => m.id));
  let todo = target.members.filter((m) => !placed.has(m.id));
  while (todo.length) {
    const next = todo.find((m) => occupied.has(m.a) || occupied.has(m.b));
    if (!next) throw new Error("Planned member does not touch any existing node");
    actions.push({
      kind: "member",
      a: parseNodeKey(occupied.has(next.a) ? next.a : next.b),
      b: parseNodeKey(occupied.has(next.a) ? next.b : next.a),
      type: next.type,
    });
    occupied.add(next.a).add(next.b);
    todo = todo.filter((m) => m !== next);
  }

  for (const [key, a] of Object.entries(target.attrs))
    if (a.joint && !base.attrs[key]?.joint) actions.push({ kind: "joint", at: parseNodeKey(key) });
  return actions;
}

/** Remaining supply of a section in `scenario` given `model`. */
export function supplyLeft(scenario: GoalScenario, model: GameModel, type: MemberType): number {
  const inv = scenario.level.inv;
  return inv === null ? Infinity : (inv[type] ?? 0) - model.members.filter((m) => m.type === type).length;
}
export const jointsLeft = (scenario: GoalScenario, model: GameModel): number =>
  scenario.level.inv === null
    ? Infinity
    : (scenario.level.inv.joint ?? 0) - Object.values(model.attrs).filter((a) => a.joint).length;
export const foundationsLeft = (scenario: GoalScenario, model: GameModel): number =>
  scenario.level.inv === null
    ? Infinity
    : (scenario.level.inv.found ?? 0) -
      Object.values(model.attrs).filter((a) => a.found && !a.locked).length;

export const sectionCost = (type: MemberType): number => ITEMS[type].cost;
export { nodeKey, actionId };
