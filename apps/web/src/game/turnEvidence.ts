import {
  parseStructuralAnalysisRequest,
  parseStructuralAnalysisResult,
  type StructuralAnalysisRequest,
  type StructuralAnalysisResult,
} from '@dof/solver-contract';
import { localAxes } from '../evaluator/vector';
import { ITEMS, S } from '../evaluator/sections';
import type { StructureEvaluation } from '../evaluator/results';
import { parseNodeKey } from './model';
import { CONNECTION_PROFILES, RUST_TURN_ENGINE, turnJoints, type TurnReport, type TurnState } from './turns';
import { attachmentQuarter, isInteriorSite } from './attachmentSites';
import { CARD_STRENGTH } from '../evaluator/capacity';
import { CANTILEVER_CATALOGUE, isReleaseCatalogue } from './cardCatalogue';

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
  const selfWeight = turn.catalogue !== CANTILEVER_CATALOGUE;
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
  const fittings = [...turn.board.connections, ...turn.draft.connections];
  const connections = fittings.filter(c => !isInteriorSite(c.end)).map((connection) => {
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
  const collars = fittings.filter(c => isInteriorSite(c.end)).map(connection => ({
    id: `connection:port:${connection.memberId}:${attachmentQuarter(connection.end)}`,
    definitionVersion: 'fixed-interior-collar-1',
    source: { memberId: String(connection.memberId), quarter: attachmentQuarter(connection.end),
      jointId: `port:${connection.memberId}:${attachmentQuarter(connection.end)}` },
    jointId: connection.jointId,
    capacities: [{ name: 'resultant-force', value: CARD_STRENGTH.connections.fixed.force * toSI, unit: 'N' },
      { name: 'resultant-moment', value: CARD_STRENGTH.connections.fixed.moment * toSI, unit: 'N*m' }],
    state: 'active',
    ...cardProvenance(connection.cardId, `connection:${connection.profile}`, turn.version),
  }));
  const joints = turnJoints(turn);
  const foundations = joints.flatMap(({ id, foundationOwner }) => foundationOwner ? [{
    id: `foundation:${id}`, jointId: id, ownerId: foundationOwner, restrained: Array(6).fill(true),
  }] : []);
  const loads = [...turn.board.loads, ...turn.draft.loads].map((load) => ({
    id: load.cardId,
    target: turn.catalogue === CANTILEVER_CATALOGUE && /^endpoint:\d+:[ab]$/.test(load.jointId)
      ? (() => {
        const [, id, end] = /^endpoint:(\d+):([ab])$/.exec(load.jointId)!;
        const attachment = fittings.find(c => c.memberId === Number(id) && c.end === end);
        // A fitted end load acts at the original receiving interface. Keep a
        // collar source port here rather than erasing its side via aliasing.
        return attachment ? { kind: 'joint', id: attachment.jointId } : { kind: 'endpoint', id: load.jointId };
      })()
      : { kind: 'joint', id: load.jointId },
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
      joints: joints.map(({ id, point }) => ({ id, position: position(point ?? id) })),
      materials, sections, members, connections, foundations, loads,
      ...(collars.length && { collars }),
      loadCases: [{ id: 'applied', loads: loads.map(({ id }) => ({ loadId: id, factor: 1 })) }],
      // Preserve historical archives; the collar release uses card gravity.
      selfWeight: selfWeight ? { enabled: true, gravity: [0, 0, -gravity] } : { enabled: false },
    },
    analysis: {
      kind: isReleaseCatalogue(turn.catalogue) || turn.engine === RUST_TURN_ENGINE ? 'geometric-nonlinear-static' : 'linear-static',
      loadPath: [{ selfWeightFactor: selfWeight ? 1 : 0, factors: [{ caseId: 'applied', factor: 1 }] }],
    },
  });
}

/** Archive the available playtest reactions and scope without promoting them to scoring evidence. */
export function recordTurnAnalysis(
  turn: TurnState, result: StructureEvaluation | undefined, status: TurnReport['status'],
  startedAt: string, matchId: string,
): StructuralAnalysisResult {
  const request = buildTurnRequest(turn, matchId);
  const snapshot = request.snapshot;
  // The archive names the engine that ran. Either way these reactions are
  // playtest feedback, not scoring evidence (see `finalScore.ts`).
  const rust = isReleaseCatalogue(turn.catalogue) || turn.engine === RUST_TURN_ENGINE;
  const engine = rust
    ? { tag: 'rust-playtest', solver: { id: 'dof-rust', version: result?.reference?.solverVersion ?? 'unavailable', adapterId: 'shared-table', adapterVersion: '2', fidelity: 'nonlinear-applied-load' },
      warning: turn.catalogue === CANTILEVER_CATALOGUE
        ? 'Archived Shared table card-gravity response. Use the turn summary for verified scoring and connector checks.'
        : 'Geometrically nonlinear solve on the Rust solver, with member self-weight. Use the turn summary for playtest feedback.' }
    : { tag: 'voxel-playtest', solver: { id: 'voxel-playtest', version: '2', adapterId: 'shared-table', adapterVersion: '1', fidelity: 'experimental-applied-load' },
      warning: 'Experimental whole-model solve with lumped member self-weight. Use the turn summary for playtest feedback.' };
  const componentId = rust ? 'rust-whole-model' : 'voxel-whole-model';
  const reactions = status === 'stable' || status === 'partial' ? result?.combos[0]?.reac : undefined;
  const context = result?.ctx;
  const foundations = snapshot.foundations.map(({ id, jointId }) => {
    const index = context?.idx.get(jointId);
    const reaction = context && index !== undefined ? reactions?.[context.aid[index]] : undefined;
    const value = reaction && Array.from(reaction, (quantity) => quantity * toSI);
    return {
      foundationId: id, componentId,
      reaction: value?.length === 6 && value.every(Number.isFinite)
        ? { validity: 'unverified', value, reason: engine.tag }
        : { validity: 'unavailable', reason: 'no-equilibrium-reaction' },
    };
  });
  return parseStructuralAnalysisResult({
    format: 'dof-analysis-result', schemaVersion: 1, runId: engine.tag + ':' + snapshot.revisionId, purpose: 'turn',
    turn: { matchId, turnId: String(turn.turn), playerId: turn.players[turn.playerIndex].id, rulesVersion: String(turn.version) },
    startedAt, finishedAt: new Date(Math.max(Date.parse(startedAt), Date.now())).toISOString(), runtimeMs: result?.time ?? 0,
    request, resultStage: 0,
    solver: engine.solver,
    conventions: {
      memberEndForce: 'unavailable', connectionForce: 'unavailable',
      connectionRelativeMotion: 'unavailable', residualNormalization: 'unavailable',
    },
    status: status === 'stable' ? 'success' : status === 'unstable' ? 'unstable' : 'unresolved',
    reasonCodes: status === 'partial' ? ['floating-components'] : status === 'unresolved' ? ['solve-unavailable'] : [],
    warnings: [
      engine.warning,
      ...(result?.error ? [result.error] : []),
    ],
    components: [{
      id: componentId,
      jointIds: snapshot.joints.map(({ id }) => id),
      endpointIds: snapshot.members.flatMap(({ start, end }) => [start.id, end.id]),
      memberIds: snapshot.members.map(({ id }) => id),
      classification: status === 'stable' || status === 'unstable' ? status : 'unknown',
      validity: 'unverified',
      reasonCodes: [engine.tag],
    }],
    foundations, joints: [], endpoints: [], members: [], connections: [], modes: [],
  });
}
