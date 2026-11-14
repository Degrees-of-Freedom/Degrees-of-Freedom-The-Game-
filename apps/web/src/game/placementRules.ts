import {
  nodeKey,
  parseNodeKey,
  allNodeKeys,
  type GridPoint,
  type GameModel,
  type Level,
  type Member,
  type MemberType,
  type NodeItem,
} from './model';
import { canFound, groundAtPoint, nodeValid } from './terrain';
import { ITEMS, remaining } from './inventory';
export function memberIssue(
  level: Level,
  model: GameModel,
  a: GridPoint,
  b: GridPoint,
  type: MemberType,
): string | null {
  if (a.join() === b.join()) return 'Pick a different end point';
  if (!nodeValid(level, a) || !nodeValid(level, b))
    return 'Outside the voxel space or inside the ground';
  const d = a.map((v, i) => b[i] - v);
  if (Math.max(...d.map(Math.abs)) > ITEMS[type].maxCells)
    return `Too long — max ${ITEMS[type].maxCells} cells per axis`;
  const ak = nodeKey(...a),
    bk = nodeKey(...b);
  if (
    model.members.some(
      (m) => (m.a === ak && m.b === bk) || (m.a === bk && m.b === ak),
    )
  )
    return 'These points are already connected';
  if (remaining(level, model, type) <= 0)
    return `No ${ITEMS[type].label} left in supply`;
  for (let t = 0.05; t < 0.96; t += 0.05)
    if (
      a[2] + d[2] * t <
      groundAtPoint(level, a[0] + d[0] * t, a[1] + d[1] * t) - 1e-6
    )
      return 'Member would pass through the ground';
  return null;
}
export function nodeItemIssue(
  level: Level,
  model: GameModel,
  p: GridPoint,
  type: NodeItem,
): string | null {
  const key = nodeKey(...p),
    a = model.attrs[key] ?? {};
  if (!nodeValid(level, p)) return 'Invalid position';
  if (type === 'found') {
    if (a.found) return a.locked ? 'Abutment bearings are fixed' : null;
    if (!canFound(level, p)) return 'Foundations need solid ground';
    if (remaining(level, model, type) <= 0)
      return 'No foundations left in supply';
  }
  if (type === 'joint' && !a.joint) {
    if (!model.members.some((m) => m.a === key || m.b === key))
      return 'Build members first';
    if (remaining(level, model, type) <= 0) return 'No moment connections left';
  }
  if (type === 'load' && a.locked) return 'Challenge weights are fixed';
  if (type === 'load' && !a.load) {
    if (level.type !== 'sandbox')
      return 'Point loads are available in sandbox only';
    if (!allNodeKeys(model).includes(key))
      return 'Place loads on existing nodes';
  }
  return null;
}
export function swapIssue(
  level: Level,
  model: GameModel,
  m: Member,
  type: MemberType,
): string | null {
  if (m.type === type) return 'Already this type';
  if (remaining(level, model, type) <= 0)
    return `No ${ITEMS[type].label} left in supply`;
  const a = parseNodeKey(m.a),
    b = parseNodeKey(m.b);
  return Math.max(...a.map((v, i) => Math.abs(v - b[i]))) > ITEMS[type].maxCells
    ? `Too long for ${ITEMS[type].label}`
    : null;
}
