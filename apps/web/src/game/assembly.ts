import { CELL_SIZE, parseNodeKey, type GridPoint, type Member } from './model';
import { localAxes } from '../solver/frameMath';

/** A factory-welded four-panel planar truss. Terminal stubs isolate each
 * external connector from the welded cluster. A ball at the tip releases the
 * entire assembly's moment without releasing any factory post/chord joint. */
export const PLANAR = {
  id: 'planar-welded-1', depthM: 0.5, terminalM: 0.125,
  section: 'shs', panels: 4,
} as const;

/** Three continuous SHS chords, equilateral welded rings, and a pin-ended
 * diagonal in every face of every panel. The reference line is chord one. */
export const TRICHORD = {
  id: 'trichord-ring-1', sideM: 0.5, terminalM: 0.125,
  section: 'shs', panels: 4,
} as const;

export type AssemblyId = typeof PLANAR.id | typeof TRICHORD.id;

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
  chord: boolean;
}

/** Grid coordinates for viewing and collision, stable node IDs for analysis.
 * Only the lower chord exposes external ports. Coincidence at a post, diagonal
 * or upper chord cannot create a playable interface. */
export function assemblyParts(member: Member): AssemblyPart[] {
  if (member.assembly !== PLANAR.id && member.assembly !== TRICHORD.id) return [];
  const a = parseNodeKey(member.a), b = parseNodeKey(member.b);
  const delta = b.map((v, axis) => v - a[axis]);
  const span = Math.hypot(...delta);
  if (!(span > 0)) return [];
  const [, side, up] = localAxes(delta.map(x => x/span));
  const triangular = member.assembly === TRICHORD.id;
  const printing = triangular ? TRICHORD : PLANAR;
  const tip = Math.min(printing.terminalM/(span*CELL_SIZE), 1/16);
  const stations = [tip, 0.25, 0.5, 0.75, 1-tip];
  const node = (name: string, station: number, height = 0, lateral = 0): AssemblyNode => ({
    id: 'assembly:' + member.id + ':' + name, station,
    point: a.map((x, i) => x + station*delta[i] + (height*up[i] + lateral*side[i])/CELL_SIZE) as GridPoint,
  });
  const lower = stations.map((s, i) => node('lower-' + i, s));
  for (let i = 1; i <= 3; i++) lower[i].id = 'port:' + member.id + ':' + i;
  const parts: AssemblyPart[] = [];
  const add = (name: string, a: AssemblyNode, b: AssemblyNode, role: 'chord' | 'diagonal' | 'frame' = 'frame') => {
    // Positive playable IDs and the original negative quarter-piece range
    // remain unchanged. A match has at most sixteen player element plays.
    const id = -(1000000 + member.id*64 + parts.length);
    parts.push({ id, name, a, b, pinned: role === 'diagonal', chord: role === 'chord' });
  };
  add('terminal-a', node('a', 0), lower[0]);
  add('terminal-b', lower[4], node('b', 1));
  if (triangular) {
    const second = stations.map((s, i) => node('second-' + i, s, 0, TRICHORD.sideM));
    const third = stations.map((s, i) => node('third-' + i, s, TRICHORD.sideM*Math.sqrt(3)/2, TRICHORD.sideM/2));
    const chords = [lower, second, third];
    for (const [face, left] of chords.entries()) {
      const right = chords[(face + 1) % chords.length];
      for (let i = 0; i < stations.length; i++) {
        add('ring-' + face + '-' + i, left[i], right[i]);
        if (i === stations.length - 1) continue;
        add('chord-' + face + '-' + i, left[i], left[i+1], 'chord');
        add('diagonal-' + face + '-' + i, i % 2 ? right[i] : left[i], i % 2 ? left[i+1] : right[i+1], 'diagonal');
      }
    }
    return parts;
  }
  // Retain the original planar part order and identifiers for saved matches.
  const upper = stations.map((s, i) => node('upper-' + i, s, PLANAR.depthM));
  for (let i = 0; i <= 4; i++) {
    add('post-' + i, lower[i], upper[i]);
    if (i === 4) break;
    add('lower-' + i, lower[i], lower[i+1], 'chord');
    add('upper-' + i, upper[i], upper[i+1], 'chord');
    add('diagonal-' + i, i % 2 ? upper[i] : lower[i], i % 2 ? lower[i+1] : upper[i+1], 'diagonal');
  }
  return parts;
}
