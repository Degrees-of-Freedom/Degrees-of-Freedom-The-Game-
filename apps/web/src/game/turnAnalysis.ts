import { CELL_SIZE, parseNodeKey } from './model';
import { assemblyParts, type AssemblyNode } from './assembly';
import type { TurnState } from './turns';
import { originalPorts, turnJoints } from './turnPorts';
import { analyzeVoxel } from '../solver/voxel';
import { assessCardCapacity } from '../solver/voxelCapacity';
import type { VoxelLevel, VoxelModel } from '../solver/voxelInput';

const turnLevel: VoxelLevel = { type: 'sandbox', q0: 0, budget: Infinity, inv: null, loadCase: 'applied' };

/** Expand independent member ends before analysis. Coincident geometry alone
 * confers no constraint, and an unattached end retains free translations. */
export function toTurnVoxelInput(turn: TurnState): VoxelModel {
  const connections = new Map([...turn.board.connections, ...turn.draft.connections]
    .map((connection) => [`${connection.memberId}:${connection.end}`, connection]));
  const attrs: VoxelModel['attrs'] = {};
  const positions: NonNullable<VoxelModel['positions']> = {};
  const inactiveRotations = new Set<string>();
  for (const joint of turnJoints(turn)) {
    attrs[joint.id] = joint.foundationOwner ? { found: true, locked: true } : { joint: true };
    if (joint.point) positions[joint.id] = parseNodeKey(joint.point);
    if (!joint.foundationOwner) inactiveRotations.add(joint.id);
  }
  for (const load of [...turn.board.loads, ...turn.draft.loads]) {
    const joint = attrs[load.jointId];
    joint.load = (joint.load ?? 0) + load.magnitude;
  }
  const members = [...turn.board.members, ...turn.draft.members].flatMap<VoxelModel['members'][number]>(member => {
    const { id, a, b, type } = member;
    function end(side: 'a' | 'b', point: string) {
      const connection = connections.get(`${id}:${side}`);
      const key = connection?.jointId ?? `endpoint:${id}:${side}`;
      if (!connection) positions[key] = parseNodeKey(point);
      const profile = connection?.profile ?? 'fixed';
      if (type !== 'cable' && profile === 'fixed') inactiveRotations.delete(key);
      if (type === 'cable' && !connection) inactiveRotations.add(key);
      return { key, profile };
    }
    const start = end('a', a), finish = end('b', b);
    if (member.assembly) {
      const first = parseNodeKey(member.a), last = parseNodeKey(member.b);
      const chordLength = CELL_SIZE * Math.hypot(...last.map((v,i) => v-first[i]));
      const key = (node: AssemblyNode) => {
        if (node.station === 0) return start.key;
        if (node.station === 1) return finish.key;
        positions[node.id] = node.point;
        // The factory chords and welded posts participate in joint rotation.
        // An incoming external ball at an interior collar releases its own end only.
        inactiveRotations.delete(node.id);
        return node.id;
      };
      return assemblyParts(member).map(part => ({
        id: part.id, type, a: key(part.a), b: key(part.b),
        endA: part.a.station === 0 ? start.profile : part.pinned ? 'ball' : 'fixed',
        endB: part.b.station === 1 ? finish.profile : part.pinned ? 'ball' : 'fixed',
        parentSpan: {memberId: id, fromQuarter: part.a.station*4, toQuarter: part.b.station*4, assemblyPart: part.name,
          ...((part.name.startsWith('lower-') || part.name.startsWith('upper-')) && {unbracedLengthM: chordLength})},
      }));
    }
    const ports = originalPorts(member).filter(port => port.available && attrs[port.id]);
    if (!ports.length) return [{ id, a: start.key, b: finish.key, type, endA: start.profile, endB: finish.profile }];
    // Parent continuity passes all six DOFs across internal stations, even if
    // a new external connector releases moment at that same location.
    for (const port of ports) inactiveRotations.delete(port.id);
    const stations = [{ id: start.key, quarter: 0 }, ...ports, { id: finish.key, quarter: 4 }];
    return stations.slice(1).map((to, i) => {
      const from = stations[i];
      return {
        // Player IDs are positive. Analytical pieces never re-enter the playable catalogue.
        id: -(id * 4 + from.quarter), type, a: from.id, b: to.id,
        endA: i === 0 ? start.profile : 'fixed',
        endB: to.quarter === 4 ? finish.profile : 'fixed',
        parentSpan: { memberId: id, fromQuarter: from.quarter, toQuarter: to.quarter },
      };
    });
  });
  return { members, attrs, positions, inactiveRotations, nextId: turn.nextId };
}

/** Scoring uses card gravity alone. Ordinary experimental previews retain their original load case. */
export function analyzeTurn(turn: TurnState, loading: 'with-self-weight' | 'card-gravity' = 'with-self-weight') {
  const input = toTurnVoxelInput(turn);
  const response = analyzeVoxel(input, { ...turnLevel, appliedSelfWeight: loading === 'with-self-weight' });
  const capacity = loading === 'card-gravity'
    ? assessCardCapacity(input, response, [...turn.board.connections, ...turn.draft.connections])
    : undefined;
  return { ...response, capacity };
}

export function assessTurn(turn: TurnState): 'stable' | 'unstable' | 'partial' | 'unresolved' {
  try {
    const result = analyzeTurn(turn);
    if (result.error || !result.combos.length) return 'unresolved';
    const scopes = result.combos[0].components ?? [];
    if (scopes.some(s => s.status === 'computed') && scopes.some(s => s.status !== 'computed')) return 'partial';
    if (result.unresolved) return 'unresolved';
    if (result.mechanism) return 'unstable';
    return result.floating.length ? 'partial' : 'stable';
  } catch {
    return 'unresolved';
  }
}
