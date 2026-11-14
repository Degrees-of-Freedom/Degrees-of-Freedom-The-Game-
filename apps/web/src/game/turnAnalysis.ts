import { parseNodeKey } from './model';
import { turnJoints, type TurnState } from './turns';
import { analyzeVoxel } from '../solver/voxel';
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
    if (!joint.foundationOwner) inactiveRotations.add(joint.id);
  }
  for (const load of [...turn.board.loads, ...turn.draft.loads]) {
    const joint = attrs[load.jointId];
    joint.load = (joint.load ?? 0) + load.magnitude;
  }
  const members = [...turn.board.members, ...turn.draft.members].map(({ id, a, b, type }) => {
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
    return { id, a: start.key, b: finish.key, type, endA: start.profile, endB: finish.profile };
  });
  return { members, attrs, positions, inactiveRotations, nextId: turn.nextId };
}

export function analyzeTurn(turn: TurnState) {
  return analyzeVoxel(toTurnVoxelInput(turn), turnLevel);
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
