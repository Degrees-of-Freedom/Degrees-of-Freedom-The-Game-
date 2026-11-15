import { nodeValid, canFound } from "../../game/terrain";
import {
  nodeKey,
  parseNodeKey,
  type GameModel,
  type GridPoint,
  type Member,
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

/** Sections cheapest first; used when trying to downgrade a member. */
const BY_COST: MemberType[] = ["shs", "glulam", "ipe", "heb"];

export interface ErosionOptions {
  /** Section of the starting ground structure. */
  startType: MemberType;
  /** Cells around the weights' footprint the ground structure covers. */
  margin: number;
  /** Longest axis-aligned member in the ground structure, in cells. */
  maxLength: number;
  /**
   * Analyses the whole run may spend. Every accepted step is valid, so running
   * out simply stops erosion and returns the structure reached so far.
   */
  analysisBudget: number;
  /** Share of removable members dropped per erosion step before backing off. */
  removeFraction: number;
}

/**
 * Evolutionary structural optimisation on a ground structure.
 *
 * Start from every legal short member between lattice nodes around the weights,
 * with a moment connection at every node and a foundation at every ground
 * node: heavy, but it carries the load. Then erode:
 *
 * 1. Members. Drop the least-utilised members (the solver's own utilisation),
 *    several at a time. If the level stops passing, restore them and try fewer;
 *    a member whose removal alone breaks the level is kept for good.
 * 2. Joints, then foundations. Remove each one that is not needed.
 * 3. Sections. Swap each member for the cheapest section that still passes.
 *
 * Every step is accepted only if the game's analysis still reports success.
 * Existing structure (earlier stages) is never removed.
 */
export class ErosionPlanner implements Planner {
  readonly name = "erosion";
  private readonly options: ErosionOptions;
  private used = 0;

  constructor(options: Partial<ErosionOptions> = {}) {
    this.options = { startType: "glulam", margin: 1, maxLength: 3, removeFraction: 0.25, analysisBudget: 600, ...options };
  }

  plan(scenario: GoalScenario, base: GameModel): PlanResult {
    this.used = 0;
    const start = this.groundStructure(scenario, base);
    if (!analyze(scenario, start).success)
      return { actions: [], model: base, solved: false, cost: modelCost(base), note: "Ground structure does not pass" };

    const fixed = new Set(base.members.map((m) => m.id));
    let model = this.erodeMembers(scenario, start, fixed);
    model = this.erodeNodes(scenario, model, "joint");
    model = this.erodeNodes(scenario, model, "found", base);
    model = this.downgradeSections(scenario, model, fixed);
    model = prune(model, base);

    const solved = !!analyze(scenario, model).success && withinSupply(scenario, model);
    return {
      actions: actionsBetween(base, model),
      model,
      solved,
      cost: modelCost(model),
      note: solved ? undefined : "Eroded structure exceeds the level's supply",
    };
  }

  /** Analysis that counts against the budget. */
  private check(scenario: GoalScenario, model: GameModel): ReturnType<typeof analyze> {
    this.used++;
    return analyze(scenario, model);
  }

  private get exhausted(): boolean {
    return this.used >= this.options.analysisBudget;
  }

  private groundStructure(scenario: GoalScenario, base: GameModel): GameModel {
    const { level, zones = [] } = scenario;
    const { startType: type, margin, maxLength } = this.options;
    const model = cloneModel(base);
    const weights = Object.keys(base.attrs).filter((k) => base.attrs[k].target).map(parseNodeKey);
    const lo = [0, 1].map((i) => Math.max(0, Math.min(...weights.map((w) => w[i])) - margin));
    const hi = [0, 1].map((i) => Math.min(i ? level.ny : level.nx, Math.max(...weights.map((w) => w[i])) + margin));
    const top = Math.max(...weights.map((w) => w[2]));
    const geometry = new MemberGeometry(level, zones);
    const have = new Set(model.members.flatMap((m) => [`${m.a}>${m.b}`, `${m.b}>${m.a}`]));

    for (let i = lo[0]; i <= hi[0]; i++)
      for (let j = lo[1]; j <= hi[1]; j++)
        for (let k = 0; k <= top; k++) {
          const p: GridPoint = [i, j, k];
          if (!nodeValid(level, p) || nodeZone(zones, p)) continue;
          const key = nodeKey(...p);
          (model.attrs[key] ??= {}).joint = true;
          if (k === 0 && canFound(level, p)) model.attrs[key].found = true;
          for (const dir of DIRECTIONS)
            // Long members only along an axis; diagonals stay one cell.
            for (let len = 1; len <= (dir.filter(Boolean).length === 1 ? maxLength : 1); len++) {
              const q: GridPoint = [p[0] + dir[0] * len, p[1] + dir[1] * len, p[2] + dir[2] * len];
              if (q[0] < lo[0] || q[0] > hi[0] || q[1] < lo[1] || q[1] > hi[1] || q[2] < 0 || q[2] > top) continue;
              if (!nodeValid(level, q) || !geometry.fits(p, q, type)) continue;
              const qKey = nodeKey(...q);
              if (have.has(`${key}>${qKey}`)) continue;
              have.add(`${key}>${qKey}`).add(`${qKey}>${key}`);
              model.members.push({ id: model.nextId++, a: key, b: qKey, type });
            }
        }
    // Every node reached by a member also needs its joint and, on the ground, a foundation.
    for (const m of model.members)
      for (const key of [m.a, m.b]) {
        const p = parseNodeKey(key);
        if (nodeZone(zones, p)) continue;
        (model.attrs[key] ??= {}).joint = true;
        if (p[2] === 0 && canFound(level, p)) model.attrs[key].found = true;
      }
    return model;
  }

  /**
   * Drop least-utilised members in batches that shrink after a failure and
   * grow back after a success. When a batch is down to one member, make a
   * single pass over the remaining members in utilisation order, trying each.
   */
  private erodeMembers(scenario: GoalScenario, start: GameModel, fixed: Set<number>): GameModel {
    let model = start;
    const keep = new Set(fixed);
    const maxFraction = this.options.removeFraction;
    let fraction = maxFraction;
    const without = (from: GameModel, ids: Set<number>): GameModel => {
      const trial = cloneModel(from);
      trial.members = trial.members.filter((m) => !ids.has(m.id));
      // The game counts a jointed node with no member as a floating part, so
      // clearing what the removed members were holding up is part of removing them.
      cascade(trial);
      return trial;
    };
    const ranked = (): Member[] => {
      const result = this.check(scenario, model);
      return model.members
        .filter((m) => !keep.has(m.id))
        .sort((a, b) => (result.members[a.id]?.util ?? 0) - (result.members[b.id]?.util ?? 0));
    };

    for (let guard = 0; guard < 400 && !this.exhausted; guard++) {
      const removable = ranked();
      if (!removable.length) break;
      const batch = Math.max(1, Math.ceil(removable.length * fraction));
      if (batch > 1) {
        const trial = without(model, new Set(removable.slice(0, batch).map((m) => m.id)));
        if (this.check(scenario, trial).success) {
          model = trial;
          fraction = Math.min(maxFraction, fraction * 1.5);
        } else fraction = Math.max(fraction / 2, 1 / removable.length);
        continue;
      }
      // Single pass: one trial per member, accepted on success.
      let removed = 0;
      for (const m of removable) {
        if (this.exhausted) break;
        if (!model.members.some((x) => x.id === m.id)) continue; // already cascaded away
        const trial = without(model, new Set([m.id]));
        if (this.check(scenario, trial).success) {
          model = trial;
          removed++;
        } else keep.add(m.id);
      }
      if (!removed) break;
      fraction = Math.min(maxFraction, fraction * 2);
    }
    return model;
  }

  /** Remove each joint (or foundation) that the structure does not need. */
  private erodeNodes(scenario: GoalScenario, start: GameModel, kind: "joint" | "found", base?: GameModel): GameModel {
    let model = start;
    for (const key of Object.keys(model.attrs).filter((k) => model.attrs[k][kind])) {
      if (this.exhausted) break;
      if (kind === "found" && base?.attrs[key]?.found) continue;
      if (kind === "found" && model.attrs[key]?.locked) continue;
      const trial = cloneModel(model);
      delete trial.attrs[key][kind];
      if (this.check(scenario, trial).success) model = trial;
    }
    return model;
  }

  private downgradeSections(scenario: GoalScenario, start: GameModel, fixed: Set<number>): GameModel {
    let model = start;
    for (const id of model.members.map((m) => m.id)) {
      if (fixed.has(id) || this.exhausted) continue;
      const current = model.members.find((m) => m.id === id)!;
      for (const type of BY_COST) {
        if (ITEMS[type].cost >= ITEMS[current.type].cost) break;
        if (!scenario.memberTypes.includes(type)) continue;
        const trial = cloneModel(model);
        trial.members.find((m) => m.id === id)!.type = type;
        if (this.check(scenario, trial).success) {
          model = trial;
          break;
        }
      }
    }
    return model;
  }
}

/**
 * After removing members, also remove what they were holding up: dead-end
 * spurs (a node with one member that is not a weight or a foundation) and then
 * orphan joints and foundations.
 */
function cascade(model: GameModel): void {
  for (let changed = true; changed; ) {
    changed = false;
    const degree = new Map<string, number>();
    for (const m of model.members)
      for (const k of [m.a, m.b]) degree.set(k, (degree.get(k) ?? 0) + 1);
    // Drop any member with an end that is only a spur.
    const pruned = model.members.filter((m) => {
      const ends = [m.a, m.b];
      return !ends.some((k) => (degree.get(k) ?? 0) === 1 && !model.attrs[k]?.target && !model.attrs[k]?.found);
    });
    if (pruned.length !== model.members.length) {
      model.members = pruned;
      changed = true;
    }
  }
  dropOrphans(model);
}

/** Clear joints and foundations from nodes no member reaches (weights are kept). */
function dropOrphans(model: GameModel): void {
  const used = new Set(model.members.flatMap((m) => [m.a, m.b]));
  for (const [key, attrs] of Object.entries(model.attrs)) {
    if (used.has(key) || attrs.target) continue;
    delete attrs.joint;
    delete attrs.found;
    if (!Object.keys(attrs).length) delete model.attrs[key];
  }
}

/** Remove joints and foundations that no member uses; keep the base's attributes. */
function prune(model: GameModel, base: GameModel): GameModel {
  const used = new Set(model.members.flatMap((m: Member) => [m.a, m.b]));
  const next = cloneModel(model);
  for (const [key, attrs] of Object.entries(next.attrs)) {
    if (!used.has(key) && !attrs.target && !base.attrs[key]) {
      delete next.attrs[key].joint;
      delete next.attrs[key].found;
    }
    if (!Object.keys(next.attrs[key]).length) delete next.attrs[key];
  }
  return next;
}

function withinSupply(scenario: GoalScenario, model: GameModel): boolean {
  const types = new Set(model.members.map((m) => m.type));
  return (
    [...types].every((t) => supplyLeft(scenario, model, t) >= 0) &&
    jointsLeft(scenario, model) >= 0 &&
    foundationsLeft(scenario, model) >= 0
  );
}
