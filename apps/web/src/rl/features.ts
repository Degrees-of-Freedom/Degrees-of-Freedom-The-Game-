import { ITEMS } from "../game/inventory";
import { nodeKey, parseNodeKey, type GridPoint, type MemberType } from "../game/model";
import { distance, REACH_RANGE, supportedNodeKeys } from "./graph";
import type { GoalAction, Observation } from "./types";

/** Section types the feature vector distinguishes; others share no column. */
const SECTION_TYPES = ["shs", "glulam", "ipe", "heb"] as const satisfies readonly MemberType[];

/**
 * Names of the action features, in vector order. They describe an action in
 * the context of the current structure, which lets one small set of weights
 * work for any number of weights and any grid position.
 */
export const ACTION_FEATURE_NAMES = [
  // No per-kind bias for foundation/member/joint: `kindBalancedPrior` sets the
  // initial split between kinds, and a learnable bias drifted negative from
  // noisy early samples, starving the joint that completes a structure.
  "isFinish",
  "isWait",
  "waitWhileHolding",
  // foundation
  "foundationFirst",
  "foundationBelowWeight",
  "foundationNearness",
  "foundationRedundant",
  // member
  "sectionShs",
  "sectionGlulam",
  "sectionIpe",
  "sectionHeb",
  "memberLength",
  "memberCost",
  "memberVertical",
  "memberFromSupported",
  "memberConnectsWeight",
  "memberCloser",
  "memberFloating",
  // state × action interactions: a linear scorer cannot otherwise express
  // "this only matters while the structure is a mechanism / once all is connected"
  "memberWhileMechanism",
  "memberWhenAllConnected",
  "foundationWhenAllConnected",
  "jointOnSupportedWhileMechanism",
  // joint
  "jointAtFoundation",
  "jointAtLoadedBase",
  "jointAtWeight",
  "jointAtOther",
  "jointWhileMechanism",
] as const;

export type ActionFeatureName = (typeof ACTION_FEATURE_NAMES)[number];
export const ACTION_FEATURE_COUNT = ACTION_FEATURE_NAMES.length;

const INDEX = Object.fromEntries(
  ACTION_FEATURE_NAMES.map((name, i) => [name, i]),
) as Record<ActionFeatureName, number>;

/** Per-step facts shared by every candidate action. */
export interface StateContext {
  supported: Set<string>;
  /** Weights without a path to a foundation. */
  open: GridPoint[];
  weightKeys: Set<string>;
  foundationKeys: Set<string>;
  /** Nodes that at least one member ends at. */
  memberEnds: Set<string>;
  mechanism: boolean;
  /** Every weight already has a path to a foundation. */
  allConnected: boolean;
  /** Most expensive section cost, used to scale cost features. */
  maxCost: number;
}

export function stateContext(obs: Observation): StateContext {
  const supported = supportedNodeKeys(obs.model);
  const weightKeys = new Set(obs.targets.map((t) => t.key));
  const foundationKeys = new Set(
    Object.entries(obs.model.attrs)
      .filter(([, a]) => a.found)
      .map(([key]) => key),
  );
  return {
    supported,
    open: obs.targets.filter((t) => !supported.has(t.key)).map((t) => t.at),
    weightKeys,
    foundationKeys,
    memberEnds: new Set(obs.model.members.flatMap((m) => [m.a, m.b])),
    mechanism: obs.analysis.mechanism,
    allConnected: obs.targets.length > 0 && obs.targets.every((t) => supported.has(t.key)),
    maxCost: Math.max(...SECTION_TYPES.map((t) => ITEMS[t].cost)),
  };
}

const nearestOpen = (ctx: StateContext, p: GridPoint): number =>
  ctx.open.length ? Math.min(...ctx.open.map((t) => distance(p, t))) : REACH_RANGE;

/** Feature vector for taking `action` in the state described by `ctx`. */
export function actionFeatures(
  ctx: StateContext,
  action: GoalAction,
  out = new Float64Array(ACTION_FEATURE_COUNT),
): Float64Array {
  out.fill(0);
  switch (action.kind) {
    case "finish":
      out[INDEX.isFinish] = 1;
      break;
    case "wait":
      out[INDEX.isWait] = 1;
      // Waiting only pays when what exists is already stable and connected.
      out[INDEX.waitWhileHolding] = ctx.allConnected && !ctx.mechanism ? 1 : 0;
      break;
    case "foundation": {
      out[INDEX.foundationWhenAllConnected] = ctx.allConnected ? 1 : 0;
      out[INDEX.foundationFirst] = ctx.foundationKeys.size === 0 ? 1 : 0;
      const horizontal = ctx.open.length
        ? Math.min(...ctx.open.map((t) => Math.hypot(t[0] - action.at[0], t[1] - action.at[1])))
        : REACH_RANGE;
      // An existing foundation within 2 cells horizontally already serves this spot.
      out[INDEX.foundationRedundant] = [...ctx.foundationKeys].some((key) => {
        const f = parseNodeKey(key);
        return Math.hypot(f[0] - action.at[0], f[1] - action.at[1]) <= 2;
      })
        ? 1
        : 0;
      out[INDEX.foundationBelowWeight] = horizontal === 0 ? 1 : 0;
      out[INDEX.foundationNearness] = 1 - Math.min(horizontal, REACH_RANGE) / REACH_RANGE;
      break;
    }
    case "member": {
      const section = SECTION_TYPES.indexOf(action.type as (typeof SECTION_TYPES)[number]);
      if (section >= 0) out[INDEX.sectionShs + section] = 1;
      const length = distance(action.a, action.b);
      out[INDEX.memberLength] = length / (ITEMS[action.type].maxCells * Math.SQRT2);
      out[INDEX.memberCost] = ITEMS[action.type].cost / ctx.maxCost;
      const aKey = nodeKey(...action.a);
      const bKey = nodeKey(...action.b);
      const aSupported = ctx.supported.has(aKey);
      const bSupported = ctx.supported.has(bKey);
      // Orient from the supported end so "vertical" means growing away from the ground.
      const [from, to] = bSupported && !aSupported ? [action.b, action.a] : [action.a, action.b];
      out[INDEX.memberVertical] = (to[2] - from[2]) / length;
      out[INDEX.memberFromSupported] = aSupported || bSupported ? 1 : 0;
      const hitsOpenWeight = (key: string) =>
        ctx.weightKeys.has(key) && !ctx.supported.has(key);
      out[INDEX.memberConnectsWeight] =
        (aSupported && hitsOpenWeight(bKey)) || (bSupported && hitsOpenWeight(aKey)) ? 1 : 0;
      out[INDEX.memberCloser] =
        (nearestOpen(ctx, from) - nearestOpen(ctx, to)) / (ITEMS[action.type].maxCells * Math.SQRT2);
      out[INDEX.memberFloating] = !aSupported && !bSupported ? 1 : 0;
      out[INDEX.memberWhileMechanism] = ctx.mechanism ? 1 : 0;
      out[INDEX.memberWhenAllConnected] = ctx.allConnected ? 1 : 0;
      break;
    }
    case "joint": {
      const key = nodeKey(...action.at);
      if (ctx.foundationKeys.has(key)) {
        out[INDEX.jointAtFoundation] = 1;
        // The joint that lets a column take moment from its fixed foundation.
        out[INDEX.jointAtLoadedBase] = ctx.memberEnds.has(key) ? 1 : 0;
      }
      else if (ctx.weightKeys.has(key)) out[INDEX.jointAtWeight] = 1;
      else out[INDEX.jointAtOther] = 1;
      out[INDEX.jointWhileMechanism] = ctx.mechanism ? 1 : 0;
      out[INDEX.jointOnSupportedWhileMechanism] =
        ctx.mechanism && ctx.supported.has(key) ? 1 : 0;
      break;
    }
  }
  return out;
}

/** Features of a state for the value baseline. */
export const STATE_FEATURE_COUNT = 5;
export function stateFeatures(obs: Observation): Float64Array {
  const a = obs.analysis;
  return Float64Array.of(
    1,
    a.targets ? a.connectedTargets / a.targets : 0,
    a.reach,
    a.connectedTargets > 0 && !a.mechanism && !a.unresolved ? 1 : 0,
    obs.step / obs.maxSteps,
  );
}


/**
 * Fixed log-prior that gives each action kind (foundation, member, joint) an
 * equal share of the initial probability, split evenly within the kind.
 * Without it the single joint that completes a structure is drowned out by
 * hundreds of member candidates and is almost never tried. `finish` and `wait` get the
 * weight of one ordinary action each, so a fresh policy rarely gives up. The offset
 * is constant, so it does not change the policy gradient.
 */
export function kindBalancedPrior(actions: readonly GoalAction[]): Float64Array {
  const counts = new Map<GoalAction["kind"], number>();
  for (const a of actions) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
  const passive = (k: GoalAction["kind"]) => k === "finish" || k === "wait";
  const kinds = [...counts.keys()].filter((k) => !passive(k)).length;
  return Float64Array.from(actions, (a) =>
    passive(a.kind)
      ? -Math.log(actions.length)
      : -Math.log(kinds * counts.get(a.kind)!),
  );
}
