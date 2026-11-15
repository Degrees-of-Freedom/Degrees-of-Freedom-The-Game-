import { memberIssue, nodeItemIssue } from "../game/placementRules";
import {
  nodeKey,
  parseNodeKey,
  type GameModel,
  type GridPoint,
  type Level,
  type MemberType,
} from "../game/model";
import { ITEMS, remaining } from "../game/inventory";
import { canFound, groundK } from "../game/terrain";
import type { GoalAction, KeepOutZone } from "./types";
import { memberZone, nodeZone } from "./zones";

/** The 26 neighbouring directions members grow along from an existing node. */
const DIRECTIONS: readonly GridPoint[] = (() => {
  const out: GridPoint[] = [];
  for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++)
      for (let z = -1; z <= 1; z++)
        if (x !== 0 || y !== 0 || z !== 0) out.push([x, y, z]);
  return out;
})();

/** Stable string identity of an action, used to dedupe and to log. */
export function actionId(action: GoalAction): string {
  switch (action.kind) {
    case "foundation":
      return `foundation@${nodeKey(...action.at)}`;
    case "joint":
      return `joint@${nodeKey(...action.at)}`;
    case "finish":
      return "finish";
    case "wait":
      return "wait";
    case "member": {
      const [first, second] = [nodeKey(...action.a), nodeKey(...action.b)].sort();
      return `${action.type}:${first}-${second}`;
    }
  }
}

/** Every lattice node the structure currently touches. */
export function occupiedNodes(model: GameModel): GridPoint[] {
  const keys = new Set<string>();
  for (const m of model.members) {
    keys.add(m.a);
    keys.add(m.b);
  }
  for (const [key, attrs] of Object.entries(model.attrs))
    if (attrs.found || attrs.joint || attrs.load) keys.add(key);
  return [...keys].map(parseNodeKey);
}

/**
 * Apply an action to a copy of the model, or explain why the rules reject it.
 * Mirrors the store's `addMember` / `placeNodeItem` for the goal mode so an
 * agent cannot do anything a player could not.
 */
export function applyAction(
  level: Level,
  model: GameModel,
  action: GoalAction,
  zones: readonly KeepOutZone[] = [],
): { model: GameModel; issue: null } | { model: GameModel; issue: string } {
  if (action.kind === "finish" || action.kind === "wait") return { model, issue: null };
  const next: GameModel = structuredClone(model);
  if (action.kind === "member") {
    const zone = memberZone(zones, action.a, action.b);
    if (zone) return { model, issue: `Member passes through keep-out zone ${zone.id}` };
    const issue = memberIssue(level, model, action.a, action.b, action.type);
    if (issue) return { model, issue };
    next.members.push({
      id: next.nextId++,
      a: nodeKey(...action.a),
      b: nodeKey(...action.b),
      type: action.type,
    });
    return { model: next, issue: null };
  }
  const zone = nodeZone(zones, action.at);
  if (zone) return { model, issue: `Node is inside keep-out zone ${zone.id}` };
  const type = action.kind === "foundation" ? "found" : "joint";
  const issue = nodeItemIssue(level, model, action.at, type);
  if (issue) return { model, issue };
  const key = nodeKey(...action.at);
  const attrs = (next.attrs[key] ??= {});
  // Both are toggles in the editor; the agent only ever adds, never removes.
  if (attrs[type]) return { model, issue: `Already has a ${type}` };
  attrs[type] = true;
  return { model: next, issue: null };
}

export interface EnumerateOptions {
  memberTypes: readonly MemberType[];
  zones?: readonly KeepOutZone[];
}

/**
 * Lists legal actions for one level. Whether a member fits the terrain depends
 * only on its geometry, so that costly check is cached; supply and duplicate
 * checks, which depend on the model, run every time. `applyAction` still runs
 * the game's full rule check on whatever is finally played.
 */
export class ActionEnumerator {
  private readonly geometry = new Map<string, boolean>();
  private readonly unlimited: Level;

  constructor(
    private readonly level: Level,
    private readonly options: EnumerateOptions,
  ) {
    this.unlimited = { ...level, inv: null };
  }

  /**
   * All currently legal actions, in a deterministic order, `finish` first.
   * Members grow from an existing node (a weight, foundation or member end)
   * along the 26 lattice directions at every length the section allows.
   */
  enumerate(model: GameModel, { canWait = false } = {}): GoalAction[] {
    const { level } = this;
    const zones = this.options.zones ?? [];
    const actions: GoalAction[] = [{ kind: "finish" }];
    if (canWait) actions.push({ kind: "wait" });

    for (let i = 0; i <= level.nx; i++)
      for (let j = 0; j <= level.ny; j++) {
        const at: GridPoint = [i, j, groundK(level, i, j)];
        if (
          canFound(level, at) &&
          !nodeZone(zones, at) &&
          !model.attrs[nodeKey(...at)]?.found &&
          !nodeItemIssue(level, model, at, "found")
        )
          actions.push({ kind: "foundation", at });
      }

    const nodes = occupiedNodes(model);
    for (const at of nodes)
      if (
        !model.attrs[nodeKey(...at)]?.joint &&
        !nodeItemIssue(level, model, at, "joint")
      )
        actions.push({ kind: "joint", at });

    const connected = new Set(
      model.members.flatMap((m) => [`${m.a}|${m.b}`, `${m.b}|${m.a}`]),
    );
    const seen = new Set<string>();
    for (const type of this.options.memberTypes) {
      if (remaining(level, model, type) <= 0) continue;
      for (const a of nodes)
        for (const dir of DIRECTIONS)
          for (let length = 1; length <= ITEMS[type].maxCells; length++) {
            const b: GridPoint = [
              a[0] + dir[0] * length,
              a[1] + dir[1] * length,
              a[2] + dir[2] * length,
            ];
            const aKey = nodeKey(...a);
            const bKey = nodeKey(...b);
            const id = aKey < bKey ? `${type}:${aKey}-${bKey}` : `${type}:${bKey}-${aKey}`;
            if (seen.has(id) || connected.has(`${aKey}|${bKey}`)) continue;
            seen.add(id);
            if (this.fitsTerrain(a, b, type)) actions.push({ kind: "member", a, b, type });
          }
    }
    return actions;
  }

  private fitsTerrain(a: GridPoint, b: GridPoint, type: MemberType): boolean {
    const key = `${type}:${a.join(",")}>${b.join(",")}`;
    let fits = this.geometry.get(key);
    if (fits === undefined) {
      fits =
        memberIssue(this.unlimited, EMPTY_MODEL, a, b, type) === null &&
        !memberZone(this.options.zones ?? [], a, b);
      this.geometry.set(key, fits);
    }
    return fits;
  }
}

const EMPTY_MODEL: GameModel = { members: [], attrs: {}, nextId: 1 };

/** One-off enumeration without a cache; prefer an `ActionEnumerator` in loops. */
export function enumerateActions(
  level: Level,
  model: GameModel,
  options: EnumerateOptions,
): GoalAction[] {
  return new ActionEnumerator(level, options).enumerate(model);
}
