import {
  parseStructuralAnalysisRequest,
  parseStructuralAnalysisResult,
  type StructuralAnalysisRequest,
  type StructuralAnalysisResult,
} from '@dof/solver-contract';
import { localAxes } from '../solver/voxel/frameMath';
import { ITEMS, S } from '../evaluator/sections';
import type { VoxelAnalysis } from '../evaluator/results';
import { parseNodeKey } from './model';
import { CONNECTION_PROFILES, turnJoints, type TurnReport, type TurnState } from './turns';

const gravity = 9.81;
const toSI = 1000;

function position(key: string): [number, number, number] {
  const [x, y, z] = parseNodeKey(key);
  return [x * S, y * S, z * S];
}

function referenceY(start: number[], end: number[]) {
  const delta = end.map((value, axis) => value - start[axis]);
  const length = Math.hypot(...delta);
  return localAxes(delta.map((value) => value / length))[1];
}

function cardProvenance(instanceId: string | undefined, definitionId: string, version: number) {
  return instanceId ? { card: { instanceId, definitionId, definitionVersion: String(version) } } : {};
}

/** Compile a whole turn directly from explicit attachments, never the render model. */
export function buildTurnRequest(turn: TurnState, matchId: string): StructuralAnalysisRequest {
  const entries = [...turn.board.members, ...turn.draft.members];
  const kinds = [...new Set(entries.map((entry) => entry.type))];
  const materials = kinds.map((id) => {
    const section = ITEMS[id];
    if (section.kind === 'spring') throw new Error('Spring turn evidence is not supported by the saved analysis schema.');
    return {
      id,
      elasticModulus: section.E * toSI,
      ...(section.kind === 'beam' && { shearModulus: section.G * toSI }),
      density: section.w * toSI / (gravity * section.A),
    };
  });
  const sections = kinds.map((id) => {
    const section = ITEMS[id];
    if (section.kind === 'spring') throw new Error('Spring turn evidence is not supported by the saved analysis schema.');
    return {
      id,
      area: section.A,
      ...(section.kind === 'beam' ? { iy: section.Iy, iz: section.Iz, torsionConstant: section.J } : {}),
      capacities: [],
    };
  });
  const members = entries.map((entry) => {
    const id = String(entry.id);
    const start = { id: `endpoint:${id}:a`, position: position(entry.a) };
    const end = { id: `endpoint:${id}:b`, position: position(entry.b) };
    const common = {
      id, start, end, materialId: entry.type, sectionId: entry.type,
      referenceY: referenceY(start.position, end.position),
      state: 'active',
      ...cardProvenance(entry.cardId, `element:${entry.type}`, turn.version),
    };
    if (entry.type !== 'cable') return { ...common, family: 'frame' };
    const { P0, E, A } = ITEMS.cable;
    return { ...common, family: 'cable', reference: { kind: 'initialStrain', value: P0 / (E * A) } };
  });
  const byMember = new Map(members.map((member) => [member.id, member]));
  const connections = [...turn.board.connections, ...turn.draft.connections].map((connection) => {
    const member = byMember.get(String(connection.memberId));
    if (!member) throw new Error('Connection refers to a missing member.');
    const endpoint = connection.end === 'a' ? member.start : member.end;
    return {
      id: `connection:${endpoint.id}`,
      endpointId: endpoint.id,
      jointId: connection.jointId,
      referenceY: member.referenceY,
      laws: CONNECTION_PROFILES[connection.profile].map((kind) => ({ kind })),
      capacities: [],
      state: 'active',
      ...cardProvenance(connection.cardId, `connection:${connection.profile}`, turn.version),
    };
  });
  const joints = turnJoints(turn);
  const foundations = joints.flatMap(({ id, foundationOwner }) => foundationOwner ? [{
    id: `foundation:${id}`, jointId: id, ownerId: foundationOwner, restrained: Array(6).fill(true),
  }] : []);
  const loads = [...turn.board.loads, ...turn.draft.loads].map((load) => ({
    id: load.cardId,
    target: { kind: 'joint', id: load.jointId },
    force: [0, 0, -load.magnitude * toSI],
    moment: [0, 0, 0],
    persistent: true,
    ...cardProvenance(load.cardId, `gravity:${load.magnitude}`, turn.version),
  }));
  const parentRevisionId = turn.reports.at(-1)?.analysis?.request.snapshot.revisionId;
  return parseStructuralAnalysisRequest({
    requestVersion: 1,
    snapshot: {
      format: 'dof-structural-state', schemaVersion: 1,
      modelId: matchId, revisionId: `turn-${turn.turn}`,
      ...(parentRevisionId && { parentRevisionId }),
      units: 'SI', globalAxes: 'right-handed-z-up',
      joints: joints.map(({ id }) => ({ id, position: position(id) })),
      materials, sections, members, connections, foundations, loads,
      loadCases: [{ id: 'applied', loads: loads.map(({ id }) => ({ loadId: id, factor: 1 })) }],
      // Match the current playtest's self-weight. Scored rules can choose a different policy.
      selfWeight: { enabled: true, gravity: [0, 0, -gravity] },
    },
    analysis: {
      kind: 'linear-static',
      loadPath: [{ selfWeightFactor: 1, factors: [{ caseId: 'applied', factor: 1 }] }],
    },
  });
}

/** Archive the available playtest reactions and scope without promoting them to scoring evidence. */
export function recordTurnAnalysis(
  turn: TurnState, result: VoxelAnalysis | undefined, status: TurnReport['status'],
  startedAt: string, matchId: string,
): StructuralAnalysisResult {
  const request = buildTurnRequest(turn, matchId);
  const snapshot = request.snapshot;
  const componentId = 'voxel-whole-model';
  const reactions = status === 'stable' || status === 'partial' ? result?.combos[0]?.reac : undefined;
  const context = result?.ctx;
  const foundations = snapshot.foundations.map(({ id, jointId }) => {
    const index = context?.idx.get(jointId);
    const reaction = context && index !== undefined ? reactions?.[context.aid[index]] : undefined;
    const value = reaction && Array.from(reaction, (quantity) => quantity * toSI);
    return {
      foundationId: id, componentId,
      reaction: value?.length === 6 && value.every(Number.isFinite)
        ? { validity: 'unverified', value, reason: 'voxel-playtest' }
        : { validity: 'unavailable', reason: 'no-equilibrium-reaction' },
    };
  });
  return parseStructuralAnalysisResult({
    format: 'dof-analysis-result', schemaVersion: 1, runId: 'voxel-playtest:' + snapshot.revisionId, purpose: 'turn',
    turn: { matchId, turnId: String(turn.turn), playerId: turn.players[turn.playerIndex].id, rulesVersion: String(turn.version) },
    startedAt, finishedAt: new Date(Math.max(Date.parse(startedAt), Date.now())).toISOString(), runtimeMs: result?.time ?? 0,
    request, resultStage: 0,
    solver: { id: 'voxel-playtest', version: '2', adapterId: 'shared-table', adapterVersion: '1', fidelity: 'experimental-applied-load' },
    conventions: {
      memberEndForce: 'unavailable', connectionForce: 'unavailable',
      connectionRelativeMotion: 'unavailable', residualNormalization: 'unavailable',
    },
    status: status === 'stable' ? 'success' : status === 'unstable' ? 'unstable' : 'unresolved',
    reasonCodes: status === 'partial' ? ['floating-components'] : status === 'unresolved' ? ['solve-unavailable'] : [],
    warnings: [
      'Experimental whole-model solve with lumped member self-weight. Use the turn summary for playtest feedback.',
      ...(result?.error ? [result.error] : []),
    ],
    components: [{
      id: componentId,
      jointIds: snapshot.joints.map(({ id }) => id),
      endpointIds: snapshot.members.flatMap(({ start, end }) => [start.id, end.id]),
      memberIds: snapshot.members.map(({ id }) => id),
      classification: status === 'stable' || status === 'unstable' ? status : 'unknown',
      validity: 'unverified',
      reasonCodes: ['voxel-playtest'],
    }],
    foundations, joints: [], endpoints: [], members: [], connections: [], modes: [],
  });
}
