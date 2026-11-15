import type { TurnState } from './turns';
import { analyzeTurn, toTurnVoxelInput } from './turnAnalysis';
import { rigidBodyWitnesses } from '../solver/rigidBodyFreedom';
import type { CapacityCheck } from '../solver/voxelCapacity';

export const ISSUE_POLICY = 'card-gravity-issues-1' as const;
const overloadEntry = 1.001, overloadExit = 0.999, worseningIncrement = 0.10;
export type IssueCategory = 'instability' | 'member-overload' | 'connection-overload';
export interface IssueFinding {
  id: string;
  category: IssueCategory;
  memberId: number;
  end?: 'a' | 'b';
  validity: 'verified' | 'unknown';
  active: boolean | null;
  reason: string;
  memberIds: number[];
  utilization?: number;
  station?: number;
  contactNodes?: string[];
}
export interface IssueSnapshot {
  policy: typeof ISSUE_POLICY;
  modelId: string;
  findings: IssueFinding[];
}
export interface IssueChange {
  id: string;
  category: IssueCategory;
  memberId: number;
  end?: 'a' | 'b';
  change: 'new' | 'worsened' | 'persistent' | 'improved' | 'resolved' | 'unknown';
  eligible: boolean;
  before: IssueFinding | null;
  after: IssueFinding;
}
/** Active episodes only. Null reference means the original severity was never
 * eligible for a deduction. Observing an old unknown cannot create back pay.
 */
export type IssueMemory = Record<string, { reference: number | null; lastUnattributed?: number }>;
export interface IssueAssessment {
  policy: typeof ISSUE_POLICY;
  beforeModelId: string;
  afterModelId: string;
  changes: IssueChange[];
  memory: IssueMemory;
}

type Subject = Pick<IssueFinding, 'id' | 'category' | 'memberId' | 'end'>;
function strength(subject: Subject, check: CapacityCheck | undefined, memberIds: number[]): IssueFinding {
  if (check?.status === 'verified') return { ...subject, memberIds, validity: 'verified',
    active: check.utilization > overloadEntry, utilization: check.utilization,
    station: check.station, reason: check.governing };
  return { ...subject, memberIds, validity: 'unknown', active: null,
    reason: check?.reason ?? 'Card-gravity strength verification unavailable.' };
}

/** Immutable, versioned comparison identity for the physical state only.
 * Original members and their explicit attachments determine analytical ports.
 */
function evidenceId(turn: TurnState) {
  const members = [...turn.board.members, ...turn.draft.members].sort((a, b) => a.id-b.id);
  const loads = [...turn.board.loads, ...turn.draft.loads].sort((a, b) => a.cardId.localeCompare(b.cardId));
  const connections = [...turn.board.connections, ...turn.draft.connections]
    .sort((a, b) => a.memberId-b.memberId || a.end.localeCompare(b.end));
  const joints = [...turn.board.joints].sort((a, b) => a.id.localeCompare(b.id));
  const signature = JSON.stringify([turn.catalogue, ISSUE_POLICY, members, loads, connections,
    joints.filter(j => j.foundationOwner).map(j => [j.id, j.foundationOwner, j.point])]);
  let hash = 2166136261;
  for (let i = 0; i < signature.length; ++i) hash = Math.imul(hash ^ signature.charCodeAt(i), 16777619);
  return `${turn.seed}/${(hash >>> 0).toString(16)}`;
}

/** Inspect each immutable parent/end, including another player's members and
 * system-owned objects. Forces are used only inside their verified component.
 */
export function inspectIssues(turn: TurnState, analysis?: ReturnType<typeof analyzeTurn> | null): IssueSnapshot {
  const members = [...turn.board.members, ...turn.draft.members];
  const connections = [...turn.board.connections, ...turn.draft.connections];
  const input = toTurnVoxelInput(turn);
  const motion = rigidBodyWitnesses(input);
  let result = analysis;
  if (result === undefined) {
    try { result = analyzeTurn(turn, 'card-gravity'); } catch { /* Unknown forces retain their physical scope. */ }
  }
  const parents = new Map(input.members.map(m => [m.id, m.parentSpan?.memberId ?? m.id]));
  const scopes = new Map<number, { ids: number[]; stable: boolean; reason: string }>();
  for (const scope of result?.combos[0]?.components ?? []) {
    const ids = [...new Set(scope.memberIds.map(id => parents.get(id) ?? id))].sort((a,b) => a-b);
    // Even a floating loop of three or more non-collinear pin contacts can
    // translate as a whole. No external support/constraint resists that motion.
    if (scope.status === 'unsupported' && !scope.nodes.some(key => input.attrs[key]?.found)) {
      for (const id of ids) motion.set(id, { motion: 'free translation', memberIds: ids, contactNodes: [] });
    }
    const verified = scope.verification?.status === 'verified-linear';
    for (const id of ids) scopes.set(id, { ids, stable: verified,
      reason: scope.verification?.reason ?? scope.reason ?? 'Stability verification unavailable.' });
  }
  const findings: IssueFinding[] = [];
  for (const member of members) {
    const memberId = member.id;
    const scope = scopes.get(memberId), witness = motion.get(memberId);
    const ids = scope?.ids ?? [memberId];
    const subject: Subject = { id: `instability:${memberId}`, category: 'instability', memberId };
    if (witness) {
      findings.push({ ...subject, validity: 'verified', active: true, memberIds: witness.memberIds,
        contactNodes: witness.contactNodes, reason: `Zero-strain rigid motion: ${witness.motion}.` });
    } else if (scope?.stable) {
      findings.push({ ...subject, validity: 'verified', active: false, memberIds: ids,
        reason: 'Verified small-displacement frame response.' });
    } else {
      findings.push({ ...subject, validity: 'unknown', active: null, memberIds: ids,
        reason: scope?.reason ?? 'No verified stability classification.' });
    }
    findings.push(strength({ id: `member-overload:${memberId}`, category: 'member-overload', memberId },
      result?.capacity?.members[memberId], ids));
  }
  for (const { memberId, end } of connections) {
    findings.push(strength({ id: `connection-overload:${memberId}:${end}`, category: 'connection-overload', memberId, end },
      result?.capacity?.connections[`${memberId}:${end}`], scopes.get(memberId)?.ids ?? [memberId]));
  }
  findings.sort((a, b) => a.id.localeCompare(b.id));
  return { policy: ISSUE_POLICY, modelId: evidenceId(turn), findings };
}

function withHysteresis(finding: IssueFinding, wasActive: boolean): IssueFinding {
  if (!wasActive || finding.utilization === undefined) return finding;
  return { ...finding, active: finding.utilization >= overloadExit };
}

/** Compare evidence on persistent physical IDs. A changed component label,
 * internal segment ID, or arbitrary eigenvector sign is never an issue ID.
 * Keep historical eligibility anchors through unknown intervals without
 * attributing an unobserved crossing to the current player.
 */
export function compareIssues(before: IssueSnapshot, after: IssueSnapshot, previous: IssueMemory = {}): IssueAssessment {
  const memory: IssueMemory = {};
  const changes: IssueChange[] = [];
  const prior = new Map(before.findings.map(f => [f.id, f]));
  for (const raw of after.findings) {
    const id = raw.id;
    const old = prior.get(id);
    const history = previous[id];
    const previousFinding = old && withHysteresis(old, !!history);
    const current = withHysteresis(raw, !!previousFinding?.active || !!history);
    let change: IssueChange['change'];
    if (current.active === null) {
      change = 'unknown';
      if (history) memory[id] = history;
    } else if (!current.active) {
      if (!previousFinding?.active && !history) continue;
      change = previousFinding?.validity === 'verified' ? 'resolved' : 'unknown';
    } else {
      // A newly attached body moving with a known unstable rigid cluster
      // inherits that motion. A new joint/segment ID does not create a charge.
      const inherited = current.category === 'instability' && current.memberIds.some(other =>
        other !== current.memberId && prior.get(`instability:${other}`)?.active === true);
      const uncertainLineage = !old && current.category === 'instability' && current.memberIds.some(other =>
        prior.get(`instability:${other}`)?.validity === 'unknown');
      if (previousFinding?.validity === 'unknown' || uncertainLineage) change = 'unknown';
      else if (!previousFinding?.active) change = inherited ? 'persistent' : 'new';
      else if (history?.reference != null && current.utilization !== undefined &&
          current.utilization - Math.max(history.reference, history.lastUnattributed ?? 0) >= worseningIncrement - 1e-12) change = 'worsened';
      else if (current.utilization !== undefined && previousFinding.utilization !== undefined &&
          current.utilization < previousFinding.utilization - 1e-10) change = 'improved';
      else change = 'persistent';
      // Start a fresh baseline when an active issue first becomes known.
      // Only an actual eligible transition advances the charge reference.
      const reference = change === 'new' || change === 'worsened' ? current.utilization ?? null :
        history?.reference ?? null;
      if (change === 'unknown' && current.utilization !== undefined && history?.reference != null) {
        memory[id] = { reference, lastUnattributed: Math.max(current.utilization, history.lastUnattributed ?? 0) };
      } else {
        memory[id] = change === 'new' || change === 'worsened' ? { reference } : { ...history, reference };
      }
    }
    changes.push({ id, category: current.category, memberId: current.memberId, end: current.end,
      change, eligible: change === 'new' || change === 'worsened', before: previousFinding ?? null, after: current });
  }
  return { policy: ISSUE_POLICY, beforeModelId: before.modelId, afterModelId: after.modelId, changes, memory };
}

/** Called only for a scored turn commit. Draft previews never alter memory. */
export function assessTurnIssues(turn: TurnState, previous: IssueMemory = {}) {
  const before = inspectIssues({ ...turn, draft: { members: [], connections: [], loads: [] } });
  const after = turn.draft.members.length || turn.draft.connections.length || turn.draft.loads.length
    ? inspectIssues(turn) : before;
  return compareIssues(before, after, previous);
}

/** Compare the supplied JSON against freshly recomputed evidence. Traversal is
 * bounded by the known record shape; key order in a private import is immaterial. */
export function matchesIssueEvidence(expected: unknown, supplied: unknown): boolean {
  if (expected === supplied) return true;
  if (!expected || typeof expected !== 'object' || !supplied || typeof supplied !== 'object') return false;
  if (Array.isArray(expected)) return Array.isArray(supplied) && expected.length === supplied.length &&
    expected.every((item, i) => matchesIssueEvidence(item, supplied[i]));
  if (Array.isArray(supplied)) return false;
  const entries = Object.entries(expected).filter(([, value]) => value !== undefined);
  const raw = supplied as Record<string, unknown>;
  const keys = Object.keys(raw).filter(key => raw[key] !== undefined);
  return entries.length === keys.length && entries.every(([key, value]) =>
    Object.hasOwn(raw, key) && matchesIssueEvidence(value, raw[key]));
}
