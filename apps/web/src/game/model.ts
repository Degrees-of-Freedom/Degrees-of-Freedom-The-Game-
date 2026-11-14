export type MemberType = 'shs' | 'glulam' | 'ipe' | 'heb' | 'cable';
export type NodeItem = 'joint' | 'found' | 'load';
export type Tool = MemberType | NodeItem | 'inspect' | 'delete' | 'swap';
export type LevelId =
  | 'library'
  | 'tower1'
  | 'tower2'
  | 'bridge1'
  | 'bridge2'
  | 'pickup1'
  | 'pickup2'
  | 'pickupR'
  | 'sandbox';
export type GridPoint = [number, number, number];
export interface Member {
  id: number;
  a: string;
  b: string;
  type: MemberType;
}
export interface NodeAttributes {
  found?: boolean;
  joint?: boolean;
  load?: number;
  locked?: boolean;
  target?: boolean;
}
export interface GameModel {
  members: Member[];
  attrs: Record<string, NodeAttributes>;
  nextId: number;
}
export interface Level {
  name: string;
  type: 'tower' | 'bridge' | 'pickup' | 'sandbox';
  nx: number;
  ny: number;
  nz: number;
  q0: number;
  budget: number;
  inv: Partial<Record<MemberType | 'joint' | 'found', number>> | null;
  desc: string;
  target?: number;
  payload?: number;
  cliffL?: number;
  cliffR?: number;
  cliffH?: number;
  water?: [number, number];
  ys?: number[];
  traffic?: number;
  lakes?: [number, number, number, number][];
  loads?: [number, number, number, number][];
  random?: boolean;
}
export const CELL_SIZE = 2;
export const nodeKey = (i: number, j: number, k: number) => `${i},${j},${k}`;
export const parseNodeKey = (key: string): GridPoint =>
  key.split(',').map(Number) as GridPoint;
export function allNodeKeys(model: GameModel): string[] {
  const keys = new Set(model.members.flatMap((m) => [m.a, m.b]));
  for (const [key, a] of Object.entries(model.attrs))
    if (a.found || a.joint || a.load) keys.add(key);
  return [...keys];
}
