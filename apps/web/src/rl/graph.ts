import { parseNodeKey, type GameModel, type GridPoint } from "../game/model";

/**
 * Nodes with a member path to a foundation, including the foundations. This is
 * the cheap connectivity the shaping reward and features use; the game's
 * analysis remains the authority on stability and success.
 */
export function supportedNodeKeys(model: GameModel): Set<string> {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root)!;
    parent.set(key, root);
    return root;
  };
  const touch = (key: string) => {
    if (!parent.has(key)) parent.set(key, key);
  };
  for (const m of model.members) {
    touch(m.a);
    touch(m.b);
    parent.set(find(m.a), find(m.b));
  }
  const foundations = Object.entries(model.attrs)
    .filter(([, a]) => a.found)
    .map(([key]) => key);
  for (const key of foundations) touch(key);
  const supportedRoots = new Set(foundations.map(find));
  return new Set([...parent.keys()].filter((key) => supportedRoots.has(find(key))));
}

export const distance = (p: GridPoint, q: GridPoint): number =>
  Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/** Distance in cells beyond which a supported node counts as no progress. */
export const REACH_RANGE = 8;

/**
 * Mean closeness in [0, 1] of the supported structure to each weight: 1 once a
 * weight is supported, falling linearly to 0 at `REACH_RANGE` cells away.
 */
export function reach(model: GameModel): number {
  const targets = Object.keys(model.attrs).filter((k) => model.attrs[k].target);
  if (!targets.length) return 0;
  const supported = supportedNodeKeys(model);
  const anchors = [...supported].map(parseNodeKey);
  const total = targets.reduce((sum, key) => {
    if (supported.has(key)) return sum + 1;
    const at = parseNodeKey(key);
    const nearest = Math.min(REACH_RANGE, ...anchors.map((p) => distance(p, at)));
    return sum + (1 - nearest / REACH_RANGE);
  }, 0);
  return total / targets.length;
}
