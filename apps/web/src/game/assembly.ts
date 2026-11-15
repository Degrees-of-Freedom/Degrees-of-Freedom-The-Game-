import { CELL_SIZE, parseNodeKey, type GridPoint, type Member } from './model';
import { localAxes } from '../solver/frameMath';

/** A factory-welded four-panel planar truss. Terminal stubs isolate each
 * external connector from the welded cluster. A ball at the tip releases the
 * entire assembly's moment without releasing any factory post/chord joint. */
export const PLANAR = {
  id: 'planar-welded-1', depthM: 0.5, terminalM: 0.125,
  section: 'shs', panels: 4,
} as const;

export interface AssemblyNode {
  id: string;
  point: GridPoint;
  station: number;
}
export interface AssemblyPart {
  id: number;
  name: string;
  a: AssemblyNode;
  b: AssemblyNode;
  pinned: boolean;
}

/** Grid coordinates for viewing and collision, stable node IDs for analysis.
 * Only the lower chord exposes external ports. Coincidence at a post, diagonal
 * or upper chord cannot create a playable interface. */
export function assemblyParts(member: Member): AssemblyPart[] {
  if (member.assembly !== PLANAR.id) return [];
  const a = parseNodeKey(member.a), b = parseNodeKey(member.b);
  const delta = b.map((v, axis) => v - a[axis]);
  const span = Math.hypot(...delta);
  if (!(span > 0)) return [];
  const [, , up] = localAxes(delta.map(x => x/span));
  const tip = Math.min(PLANAR.terminalM/(span*CELL_SIZE), 1/16);
  const stations = [tip, 0.25, 0.5, 0.75, 1-tip];
  const node = (name: string, station: number, height = 0): AssemblyNode => ({
    id: 'assembly:' + member.id + ':' + name, station,
    point: a.map((x, i) => x + station*delta[i] + height*up[i]/CELL_SIZE) as GridPoint,
  });
  const lower = stations.map((s, i) => node('lower-' + i, s));
  for (let i = 1; i <= 3; i++) lower[i].id = 'port:' + member.id + ':' + i;
  const upper = stations.map((s, i) => node('upper-' + i, s, PLANAR.depthM));
  const parts: AssemblyPart[] = [];
  const add = (name: string, a: AssemblyNode, b: AssemblyNode, pinned = false) => {
    // Positive playable IDs and the original negative quarter-piece range
    // remain unchanged. A match has at most sixteen player element plays.
    const id = -(1000000 + member.id*64 + parts.length);
    parts.push({ id, name, a, b, pinned });
  };
  add('terminal-a', node('a', 0), lower[0]);
  add('terminal-b', lower[4], node('b', 1));
  for (let i = 0; i <= 4; i++) {
    add('post-' + i, lower[i], upper[i]);
    if (i === 4) break;
    add('lower-' + i, lower[i], lower[i+1]);
    add('upper-' + i, upper[i], upper[i+1]);
    add('diagonal-' + i, i % 2 ? upper[i] : lower[i], i % 2 ? lower[i+1] : upper[i+1], true);
  }
  return parts;
}
