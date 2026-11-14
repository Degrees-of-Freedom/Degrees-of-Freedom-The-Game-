import {
  type GameModel,
  type Level,
  type MemberType,
  type NodeItem,
} from './model';
export const ITEMS = {
  shs: {
    kind: 'beam',
    label: 'SHS 100×6',
    color: '#a3adb8',
    cost: 120,
    maxCells: 3,
  },
  glulam: {
    kind: 'beam',
    label: 'Glulam 200×400',
    color: '#c8955a',
    cost: 180,
    maxCells: 3,
  },
  ipe: {
    kind: 'beam',
    label: 'IPE 300',
    color: '#6a8db3',
    cost: 260,
    maxCells: 3,
  },
  heb: {
    kind: 'beam',
    label: 'HEB 300',
    color: '#45617f',
    cost: 620,
    maxCells: 3,
  },
  cable: {
    kind: 'cable',
    label: 'Cable Ø24',
    color: '#2b2f36',
    cost: 90,
    maxCells: 8,
  },
  joint: {
    kind: 'joint',
    label: 'Moment connection',
    color: '#f39c34',
    cost: 80,
  },
  found: { kind: 'found', label: 'Foundation', color: '#b9b4aa', cost: 400 },
  load: { kind: 'load', label: 'Point load 50 kN', color: '#ff5a5f', cost: 0 },
} as const;
export const MEMBER_TYPES: MemberType[] = [
  'shs',
  'glulam',
  'ipe',
  'heb',
  'cable',
];
function used(model: GameModel, type: MemberType | NodeItem): number {
  if (MEMBER_TYPES.includes(type as MemberType))
    return model.members.filter((m) => m.type === type).length;
  return Object.values(model.attrs).filter((a) =>
    type === 'found'
      ? a.found && !a.locked
      : type === 'joint'
        ? a.joint
        : a.load,
  ).length;
}
export function remaining(
  level: Level,
  model: GameModel,
  type: MemberType | NodeItem,
): number {
  return level.inv === null
    ? Infinity
    : (type === 'load' ? 0 : (level.inv[type] ?? 0)) - used(model, type);
}
export function costOf(model: GameModel): number {
  return (
    model.members.reduce((sum, m) => sum + ITEMS[m.type].cost, 0) +
    Object.values(model.attrs).reduce(
      (sum, a) =>
        sum +
        (a.joint ? ITEMS.joint.cost : 0) +
        (a.found && !a.locked ? ITEMS.found.cost : 0),
      0,
    )
  );
}
