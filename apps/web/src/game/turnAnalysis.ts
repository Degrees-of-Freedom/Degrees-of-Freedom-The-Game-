import { recordTurnAnalysis } from './turnEvidence';
import { CELL_SIZE, parseNodeKey } from './model';
import { assemblyParts, type AssemblyNode } from './assembly';
import { RUST_TURN_ENGINE, type TurnState } from './turns';
import { analysisLoadJoint, originalPorts, turnJoints } from './turnPorts';
import { connectionDefinition } from './jointFreedom';
import { analyzeVoxel } from '../solver/voxel/analyze';
import { assessCardCapacity } from '../evaluator/capacity';
import type { EvaluatorLevel, EvaluatorModel } from '../evaluator/model';
import { createTurnSolver } from '../evaluator/engine/releaseTurn';
import type { WasmSource } from '../solver/wasm/wasmSolver';
import { isReleaseCatalogue } from './cardCatalogue';
import { attachmentId, isInteriorSite } from './attachmentSites';
import { effectiveJointConnections } from './jointCorrections';

let turnSolver = createTurnSolver();
/** Instantiate the Rust turn solver once per thread before replaying or
 * assessing a match that uses it: in the release's transaction worker, and on
 * the main thread before the store decodes a saved playtest match. Tests can
 * provide the same checked-in binary as bytes. */
export async function prepareTurnSolver(source?: WasmSource): Promise<void> {
  if (source) turnSolver = createTurnSolver(source);
  await turnSolver.prepare();
}
/** The release's name for `prepareTurnSolver`. */
export const prepareReleaseSolver = prepareTurnSolver;

const turnLevel: EvaluatorLevel = { type: 'sandbox', q0: 0, budget: Infinity, inv: null, loadCase: 'applied' };

/** Expand independent member ends before analysis. Coincident geometry alone
 * confers no constraint, and an unattached end retains free translations. */
export function toTurnEvaluatorInput(turn: TurnState): EvaluatorModel {
  const connections = new Map(effectiveJointConnections({...turn.board, connections: [...turn.board.connections, ...turn.draft.connections]})
    .map((connection) => [`${connection.memberId}:${connection.end}`, connection]));
  const attrs: EvaluatorModel['attrs'] = {};
  const positions: NonNullable<EvaluatorModel['positions']> = {};
  const inactiveRotations = new Set<string>();
  // Fixed collars identify the same six-DOF analytical node while preserving
  // every physical source/target id in the turn model. Coincidence is irrelevant.
  const canonical = (id: string) => analysisLoadJoint(turn, id);
  for (const joint of turnJoints(turn)) {
    const key = canonical(joint.id);
    attrs[key] = { ...attrs[key], ...(joint.foundationOwner ? { found: true, locked: true } : { joint: true }) };
    positions[key] = parseNodeKey(joint.point ?? joint.id);
    if (!joint.foundationOwner && !attrs[key].found) inactiveRotations.add(key);
    else inactiveRotations.delete(key);
  }
  for (const load of [...turn.board.loads, ...turn.draft.loads]) {
    const joint = attrs[analysisLoadJoint(turn, load.jointId)];
    joint.load = (joint.load ?? 0) + load.magnitude;
  }
  const members = [...turn.board.members, ...turn.draft.members].flatMap<EvaluatorModel['members'][number]>(member => {
    const { id, a, b, type } = member;
    const spring = member.springStiffnessNPerM === undefined ? {} : { springStiffnessNPerM: member.springStiffnessNPerM };
    function end(side: 'a' | 'b', point: string) {
      const connection = connections.get(`${id}:${side}`);
      const key = connection ? canonical(connection.jointId) : `endpoint:${id}:${side}`;
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
    const ports = originalPorts(member).filter(port => port.available && attrs[canonical(port.id)])
      .map(port => ({ ...port, id: canonical(port.id) }));
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

/** Compatibility name for existing revised-release adapters and fixtures. */
export const toTurnVoxelInput = toTurnEvaluatorInput;

/** Whether a match is assessed by the Rust turn solver (see `TurnState.engine`). */
export function usesRustTurnSolver(turn: Pick<TurnState, 'catalogue' | 'engine'>) {
  return isReleaseCatalogue(turn.catalogue) || turn.engine === RUST_TURN_ENGINE;
}

/** Scoring uses card gravity alone. Ordinary previews also include member
 * self-weight. The release always uses card gravity. Matches saved before
 * the Rust migration replay on the legacy voxel kernel. */
export function analyzeTurn(turn: TurnState, loading: 'with-self-weight' | 'card-gravity' = 'with-self-weight') {
  const input = toTurnEvaluatorInput(turn);
  const release = isReleaseCatalogue(turn.catalogue);
  const response = release ? turnSolver.analyze(input, turn.catalogue)
    : usesRustTurnSolver(turn) ? turnSolver.analyze(input, `${turn.catalogue}/${turn.engine}`, { selfWeight: loading === 'with-self-weight' })
      : analyzeVoxel(input, { ...turnLevel, appliedSelfWeight: loading === 'with-self-weight' });
  const originalConnections = [...turn.board.connections, ...turn.draft.connections];
  const effectiveConnections = effectiveJointConnections({...turn.board, connections: originalConnections});
  const fittings = originalConnections;
  const bySource = new Map(fittings.map(c => [attachmentId(c.memberId, c.end), c]));
  const collarLoads = [...turn.board.loads, ...turn.draft.loads].flatMap(load => {
    let target = load.jointId;
    const visited = new Set<string>();
    // A load on an attached endpoint acts at its receiving joint. Attribute
    // it to the first collar source encountered, then let nested-collar demand
    // recovery carry it onward exactly once. A host-joint load never crosses
    // the collar merely because its analytical node has been aliased.
    while (!visited.has(target)) {
      visited.add(target);
      const connection = bySource.get(target);
      if (!connection) break;
      if (isInteriorSite(connection.end)) return [{ memberId: connection.memberId, end: connection.end,
        force: [0, 0, -load.magnitude] as [number, number, number] }];
      target = connection.jointId;
    }
    return [];
  });
  const capacity = release || loading === 'card-gravity'
    ? assessCardCapacity(input, response, originalConnections.map((connection, i) =>
      effectiveConnections[i].profile === connection.profile ? connection :
        {...connection, transferProfile: effectiveConnections[i].profile}), collarLoads)
    : undefined;
  if (capacity && turn.board.jointCorrections?.length) {
    // Original fittings retain their printed force limits. The added moment
    // sleeve must independently satisfy the existing rated fixed-fitting law.
    const effective = assessCardCapacity(input, response, effectiveConnections, collarLoads);
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
