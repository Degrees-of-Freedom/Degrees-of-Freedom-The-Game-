import { recordTurnAnalysis } from './turnEvidence';
import { CELL_SIZE, parseNodeKey } from './model';
import { assemblyParts, type AssemblyNode } from './assembly';
import type { TurnState } from './turns';
import { analysisLoadJoint, originalPorts, turnJoints } from './turnPorts';
import { connectionDefinition } from './jointFreedom';
import { analyzeVoxel } from '../solver/voxel';
import { assessCardCapacity } from '../solver/voxelCapacity';
import type { VoxelLevel, VoxelModel } from '../solver/voxelInput';
import { createTurnSolver } from '../solver/wasm/turnSolver';
import type { WasmSource } from '../solver/wasm/wasmSolver';
import { effectiveJointConnections } from './jointCorrections';

let releaseSolver = createTurnSolver();
/** Initialize once in the transaction worker before replaying or assessing
 * the release. Tests can provide the same checked-in binary as bytes. */
export async function prepareReleaseSolver(source?: WasmSource): Promise<void> {
  if (source) releaseSolver = createTurnSolver(source);
  await releaseSolver.prepare();
}

const turnLevel: VoxelLevel = { type: 'sandbox', q0: 0, budget: Infinity, inv: null, loadCase: 'applied' };

/** Expand independent member ends before analysis. Coincident geometry alone
 * confers no constraint, and an unattached end retains free translations. */
export function toTurnVoxelInput(turn: TurnState): VoxelModel {
  const connections = new Map(effectiveJointConnections({...turn.board, connections: [...turn.board.connections, ...turn.draft.connections]})
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
    const joint = attrs[analysisLoadJoint(turn, load.jointId)];
    joint.load = (joint.load ?? 0) + load.magnitude;
  }
  const members = [...turn.board.members, ...turn.draft.members].flatMap<VoxelModel['members'][number]>(member => {
    const { id, a, b, type } = member;
    const spring = member.springStiffnessNPerM === undefined ? {} : { springStiffnessNPerM: member.springStiffnessNPerM };
    function end(side: 'a' | 'b', point: string) {
      const connection = connections.get(`${id}:${side}`);
      const key = connection?.jointId ?? `endpoint:${id}:${side}`;
      if (!connection) positions[key] = parseNodeKey(point);
      const profile = connection?.profile ?? 'fixed';
      const axial = type === 'cable' || type === 'spring';
      if (!axial && profile !== 'ball') inactiveRotations.delete(key);
      if (axial && !connection) inactiveRotations.add(key);
      const simple = profile === 'ball' ? 'ball' as const : 'fixed' as const;
      const law = profile === 'fixed' || profile === 'ball' ? undefined : connectionDefinition(profile, connection?.axes);
      return { key, profile: simple, law };
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
        ...(part.a.station === 0 && start.law && {connectionA: start.law}),
        ...(part.b.station === 1 && finish.law && {connectionB: finish.law}),
        parentSpan: {memberId: id, fromQuarter: part.a.station*4, toQuarter: part.b.station*4, assemblyPart: part.name,
          ...(part.chord && {unbracedLengthM: chordLength})},
      }));
    }
    const ports = originalPorts(member).filter(port => port.available && attrs[port.id]);
    if (!ports.length) return [{ id, a: start.key, b: finish.key, type, ...spring, endA: start.profile, endB: finish.profile,
      ...(member.restLengthM !== undefined && {restLengthM: member.restLengthM}),
      ...(start.law && {connectionA:start.law}), ...(finish.law && {connectionB:finish.law}) }];
    // Parent continuity passes all six DOFs across internal stations, even if
    // a new external connector releases moment at that same location.
    if (type !== 'spring' && type !== 'cable') for (const port of ports) inactiveRotations.delete(port.id);
    const stations = [{ id: start.key, quarter: 0 }, ...ports, { id: finish.key, quarter: 4 }];
    return stations.slice(1).map((to, i) => {
      const from = stations[i];
      return {
        // Player IDs are positive. Analytical pieces never re-enter the playable catalogue.
        id: -(id * 4 + from.quarter), type, ...spring, a: from.id, b: to.id,
        ...(member.restLengthM !== undefined && {restLengthM: member.restLengthM * (to.quarter-from.quarter)/4}),
        endA: i === 0 ? start.profile : 'fixed',
        endB: to.quarter === 4 ? finish.profile : 'fixed',
        ...(i === 0 && start.law && {connectionA:start.law}),
        ...(to.quarter === 4 && finish.law && {connectionB:finish.law}),
        parentSpan: { memberId: id, fromQuarter: from.quarter, toQuarter: to.quarter },
      };
    });
  });
  return { members, attrs, positions, inactiveRotations, nextId: turn.nextId };
}

/** Scoring uses card gravity alone. Ordinary experimental previews retain their original load case. */
export function analyzeTurn(turn: TurnState, loading: 'with-self-weight' | 'card-gravity' = 'with-self-weight') {
  const input = toTurnVoxelInput(turn);
  const release = turn.catalogue === 'grow-dusk-release-1';
  const response = release ? releaseSolver.analyze(input, turn.catalogue)
    : analyzeVoxel(input, { ...turnLevel, appliedSelfWeight: loading === 'with-self-weight' });
  const originalConnections = [...turn.board.connections, ...turn.draft.connections];
  const effectiveConnections = effectiveJointConnections({...turn.board, connections: originalConnections});
  const capacity = release || loading === 'card-gravity'
    ? assessCardCapacity(input, response, originalConnections.map((connection, i) =>
      effectiveConnections[i].profile === connection.profile ? connection :
        {...connection, transferProfile: effectiveConnections[i].profile}))
    : undefined;
  if (capacity && turn.board.jointCorrections?.length) {
    // Original fittings retain their printed force limits. The added moment
    // sleeve must independently satisfy the existing rated fixed-fitting law.
    const effective = assessCardCapacity(input, response, effectiveConnections);
    for (const [id, check] of Object.entries(effective.connections)) {
      const original = capacity.connections[id];
      if (check.status === 'unavailable' || original?.status !== 'verified' ||
          check.utilization > original.utilization) capacity.connections[id] = check;
    }
  }
  const physicalParents = new Map(input.members.filter(m => m.parentSpan).map(m => [m.id, m.parentSpan!.memberId]));
  return { ...response, capacity, physicalParents };
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

/** Archive experimental reactions separately from verified scoring evidence. */
export function analyzeCompletedTurn(turn: TurnState, newMatchId = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('')) {
  const startedAt = new Date().toISOString();
  let result: ReturnType<typeof analyzeTurn> | undefined;
  try { result = analyzeTurn(turn); } catch { /* Preserve unavailable evidence. */ }
  let status: 'stable' | 'unstable' | 'partial' | 'unresolved' = 'unresolved';
  if (result && !result.error && result.combos.length) {
    const scopes = result.combos[0].components ?? [];
    status = scopes.some(s => s.status === 'computed') && scopes.some(s => s.status !== 'computed') ? 'partial' : result.unresolved ? 'unresolved' : result.mechanism ? 'unstable' : result.floating.length ? 'partial' : 'stable';
  }
  const matchId = turn.reports.at(-1)?.analysis?.request.snapshot.modelId ?? newMatchId();
  return { status, analysis: recordTurnAnalysis(turn, result, status, startedAt, matchId) };
}
