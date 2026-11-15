import { nodeKey, parseNodeKey } from './model';
import { CARD_DEFINITION_VERSION, isReleaseCatalogue } from './cardCatalogue';
import { finalReceipt, NEUTRAL_OWNER } from './finalScore';
import { findMaterialClash } from './materialClashes';
import { analyzeTurn } from './turnAnalysis';
import { compareIssues, inspectIssues, type IssueAssessment, type IssueFinding, type IssueSnapshot } from './turnIssues';
import { analysisLoadJoint, originalPorts } from './turnPorts';
import { attachmentId } from './attachmentSites';
import type { TurnState } from './turns';

/** Permanent playtest scaffolding uses printed steel sections and the
 * card-strength fixed/ball end laws, under the same card-gravity analysis.
 * Each candidate adds one real ground foundation and one finite-length member. */
export const LEGACY_REPAIR_POLICY = 'local-steel-prop-1' as const;
export const REPAIR_POLICY = 'local-steel-prop-2' as const;
export type RepairPolicy = typeof REPAIR_POLICY | typeof LEGACY_REPAIR_POLICY;
const maxAttempts = 3;
type Board = TurnState['board'];
type Member = Board['members'][number];
type Joint = Board['joints'][number];
type Connection = Board['connections'][number];
export interface SystemProvenance {
  policy: RepairPolicy;
  definitionVersion: typeof CARD_DEFINITION_VERSION;
  turn: number;
  issueId: string;
  /** Stable public identity of each permanent prop, fitting and ground anchor. */
  objectId: string;
}
interface Contact {
  id: string;
  point: string;
  looseEnd?: 'a' | 'b';
}
interface SupportResult {
  jointId: string;
  owner: string;
  upwardKN: number | null;
  reason: string;
}
export interface RepairAttempt {
  issueId: string;
  memberId: number;
  contact: string;
  ground: string;
  propId: number;
  status: 'verified' | 'rejected';
  reason: string;
}
export interface CorrectionReceipt {
  policy: RepairPolicy;
  beforeModelId: string;
  afterModelId: string;
  attempts: RepairAttempt[];
  pending: string[];
  memory: IssueAssessment['memory'];
  changes: IssueAssessment['changes'];
  /** Certified end/section readings on the accepted repair objects. */
  repairChecks: IssueFinding[];
  beforeFoundations: SupportResult[];
  afterFoundations: SupportResult[];
}

function evidence(turn: TurnState) {
  let analysis: ReturnType<typeof analyzeTurn> | null = null;
  try { analysis = analyzeTurn(turn, 'card-gravity'); } catch { /* Unverified forces remain null. */ }
  const receipt = finalReceipt(turn, analysis);
  const owners = new Map(turn.board.joints.map(j => [j.id, j.foundationOwner]));
  const foundations = receipt.components.flatMap(scope => scope.foundations.map(support => ({
    ...support, owner: owners.get(support.jointId)!, reason: scope.reason,
  })));
  return { issues: inspectIssues(turn, analysis), foundations };
}

/** Prefer an unused local fitting; quarter ports belong to the flagged
 * reference member. An incoming snap to a different parent confers no right
 * for the repair to contact that other parent. */
function contacts(board: Board, member: Member, repairId: string): Contact[] {
  const ends = (['a','b'] as const).map(end => {
    const existing = board.connections.find(c => c.memberId === member.id && c.end === end);
    return existing ? { id: existing.jointId, point: member[end] } :
      { id: repairId + ':contact-' + end, point: member[end], looseEnd: end };
  });
  const ports = originalPorts(member);
  const quarters = [ports[1], ports[0], ports[2]].filter(p => p.available)
    .map(port => ({ id: port.id, point: nodeKey(...port.point) }));
  return [...ends.filter(c => c.looseEnd && !member.endTargets?.[c.looseEnd]), ...quarters, ...ends];
}

/** Ground coordinates are absolute grid units, independently identified from
 * every existing support. At z=0 use a one-cell lateral brace in bounds. */
function groundsAt(contact: Contact, member: Member) {
  const [x, y, z] = parseNodeKey(contact.point);
  const a = parseNodeKey(member.a), b = parseNodeKey(member.b);
  const transverseY = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
  const offset = (transverseY ? y : x) >= 1 ? -1 : 1;
  const diagonal = nodeKey(transverseY ? x : x + offset, transverseY ? y + offset : y, 0);
  return z > 0 ? [nodeKey(x, y, 0), diagonal] : [diagonal];
}

function localCandidates(turn: TurnState, member: Member, baseId: string, issue: IssueFinding) {
  const board = turn.board;
  const seen = new Set<string>();
  const interfaces = contacts(board, member, baseId);
  if (issue.category !== 'instability') {
    // A prop at the actual loaded fitting can divert card gravity before it
    // enters the overstressed span. Propping an already fixed support cannot.
    const loaded = new Set(board.loads.flatMap(load => [load.jointId, analysisLoadJoint(turn, load.jointId)]));
    const restrained = new Set(board.joints.filter(j => j.foundationOwner).map(j => j.id));
    const flagged = board.connections.find(c => c.memberId === member.id && c.end === issue.end);
    const source = flagged && attachmentId(flagged.memberId, flagged.end);
    const priority = (contact: Contact) => restrained.has(contact.id) ? 3 : loaded.has(contact.id) ? 0 :
      contact.id === flagged?.jointId || contact.id === source ? 1 : 2;
    interfaces.sort((a,b) => priority(a) - priority(b));
  }
  return interfaces.flatMap(contact => {
    if (seen.has(contact.id)) return [];
    seen.add(contact.id);
    return groundsAt(contact, member).map(ground => ({ contact, ground }));
  });
}

function candidate(turn: TurnState, member: Member, contact: Contact, ground: string, turnNumber: number, finding: IssueFinding, policy: RepairPolicy):
  { state: TurnState } | { problem: string } {
  const { board, nextId } = turn;
  const baseId = 'neutral:' + turnNumber + ':' + nextId;
  const system = (suffix: string): SystemProvenance => ({ policy, definitionVersion: CARD_DEFINITION_VERSION,
    turn: turnNumber, issueId: finding.id, objectId: baseId + ':' + suffix });
  // Strength corrections use the already-printed HEB section. Its physical
  // flanges, web, bending, torsion and slenderness all enter the trial solve.
  const prop: Member = { id: nextId, type: finding.category === 'instability' ? 'shs' : 'heb', owner: NEUTRAL_OWNER, a: contact.point, b: ground,
    endTargets: { a: contact.id }, system: system('prop') };
  const clash = findMaterialClash(prop, board.members, member.id);
  if (clash) return { problem: clash };
  const groundId = baseId + ':ground';
  const joints: Joint[] = [{ id: groundId, point: ground, foundationOwner: NEUTRAL_OWNER, system: system('ground') }];
  const additions: Connection[] = [];
  if (!board.joints.some(j => j.id === contact.id)) {
    joints.push({ id: contact.id, point: contact.point, system: system('interface') });
  }
  if (contact.looseEnd) {
    // A separate fitted sleeve on this one loose end. Keep all existing
    // player connectors and the original printed member exactly as placed.
    additions.push({ memberId: member.id, end: contact.looseEnd, jointId: contact.id,
      profile: 'fixed', owner: NEUTRAL_OWNER, system: system('sleeve') });
  }
  // The first existing connector owns a common joint's law. A ball contact
  // can leave a mechanism; it must pass the same post-solve checks.
  const profile = board.connections.find(c => c.jointId === contact.id)?.profile ?? 'fixed';
  additions.push({ memberId: nextId, end: 'a', jointId: contact.id, profile,
    owner: NEUTRAL_OWNER, system: system('head') },
  { memberId: nextId, end: 'b', jointId: groundId, profile: 'fixed',
    owner: NEUTRAL_OWNER, system: system('foot') });
  return { state: { ...turn, nextId: nextId + 1, board: { ...board,
    members: [...board.members, prop], connections: [...board.connections, ...additions],
    joints: [...board.joints, ...joints] } } };
}

/** Every connected region influenced by the candidate (including merged
 * components and new fittings) needs verified stability and capacity. For a
 * disconnected, unaffected region preserve its prior valid results. */
function rejection(before: IssueSnapshot, after: IssueSnapshot, propId: number, issueId: string, policy: RepairPolicy, memory: IssueAssessment['memory']) {
  const prior = new Map(before.findings.map(f => [f.id, f]));
  // Apply the same exit threshold as the charge ledger. Raw entry-threshold
  // booleans alone would falsely clear a previously active overload at 1.000.
  if (policy === REPAIR_POLICY) {
    const comparison = compareIssues(before, after, memory);
    const active = comparison.changes.find(change => change.after.active &&
      (change.id === issueId || change.after.memberIds.includes(propId) || change.eligible));
    if (active) return active.id + ' remains active: ' + active.after.reason +
      (active.after.utilization !== undefined ? ' (' + active.after.utilization.toFixed(3) + ')' : '');
  }
  if (after.findings.find(f => f.id === issueId)?.active !== false)
    return issueId + (policy === LEGACY_REPAIR_POLICY || issueId.startsWith('instability:')
      ? ' still lacks a verified stable response.' : ' still lacks a verified capacity clearance.');
  for (const f of after.findings) {
    const old = prior.get(f.id);
    const affected = f.memberIds.includes(propId) || !old;
    if (f.validity !== 'verified' && (affected || old?.validity === 'verified'))
      return f.id + ' could not be verified: ' + f.reason;
    if (f.active && (affected || old?.active !== true))
      return f.id + ' remains active: ' + f.reason + (f.utilization !== undefined ? ' (' + f.utilization.toFixed(3) + ')' : '');
  }
  return null;
}

/** A bounded transaction on an already frozen player board. A rejected
 * candidate never consumes an ID or changes the following candidate's model.
 * Replay reconstructs the same transaction from its immutable pre-move board. */
export function correctTurnIssues(frozen: TurnState, assessment: IssueAssessment, turnNumber: number, policy: RepairPolicy) {
  const supported = (finding: IssueFinding) => policy === REPAIR_POLICY || finding.category === 'instability';
  const targets = assessment.changes.filter(c => supported(c.after) && c.after.active === true &&
      (!isReleaseCatalogue(frozen.catalogue) || c.eligible))
    .sort((a,b) => Number(b.category === 'instability') - Number(a.category === 'instability') || a.memberId - b.memberId);
  if (!targets.length || assessment.beforeModelId === assessment.afterModelId) return undefined;
  const initial = evidence(frozen);
  let current = frozen, verified = initial;
  const attempts: RepairAttempt[] = [];
  for (const issue of targets) {
    if (attempts.length >= maxAttempts) break;
    if (verified.issues !== initial.issues) {
      const remaining = compareIssues(initial.issues, verified.issues, assessment.memory);
      if (!remaining.changes.some(change => change.id === issue.id && change.after.active)) continue;
    }
    const member = current.board.members.find(m => m.id === issue.memberId)!;
    const baseId = 'neutral:' + turnNumber + ':' + current.nextId;
    for (const { contact, ground } of localCandidates(current, member, baseId, issue.after)) {
      if (attempts.length >= maxAttempts) break;
      const attempt = { issueId: issue.id, memberId: member.id, contact: contact.id, ground, propId: current.nextId };
      const trial = candidate(current, member, contact, ground, turnNumber, issue.after, policy);
      if ('problem' in trial) {
        attempts.push({ ...attempt, status: 'rejected', reason: trial.problem });
        continue;
      }
      const post = evidence(trial.state);
      const lostSupport = verified.foundations.find(prior => prior.upwardKN !== null &&
        !post.foundations.some(f => f.jointId === prior.jointId && f.upwardKN !== null));
      const reason = rejection(verified.issues, post.issues, current.nextId, issue.id, policy, assessment.memory) ??
        (lostSupport ? 'Equilibrium became unverified at support ' + lostSupport.jointId + '.' : null) ??
        (post.foundations.some(f => f.jointId === baseId + ':ground' && f.upwardKN !== null)
          ? null : 'Neutral support equilibrium was not verified.');
      if (reason) {
        attempts.push({ ...attempt, status: 'rejected', reason });
        continue;
      }
      attempts.push({ ...attempt, status: 'verified', reason: 'Verified equilibrium, stability and section and connector capacities.' });
      current = trial.state;
      verified = post;
      break;
    }
  }
  const post = compareIssues(initial.issues, verified.issues, assessment.memory);
  const props = new Set(attempts.filter(a => a.status === 'verified').map(a => a.propId));
  const fittings = new Set(current.board.connections.filter(c => c.system?.turn === turnNumber)
    .map(c => 'connection-overload:' + c.memberId + ':' + c.end));
  const receipt: CorrectionReceipt = { policy, beforeModelId: initial.issues.modelId, afterModelId: verified.issues.modelId,
    attempts, pending: policy === LEGACY_REPAIR_POLICY ? verified.issues.findings.filter(f => supported(f) && f.active === true).map(f => f.id) :
      post.changes.filter(c => c.after.active === true).map(c => c.id),
    memory: post.memory, changes: post.changes,
    repairChecks: verified.issues.findings.filter(f => props.has(f.memberId) || fittings.has(f.id)),
    beforeFoundations: initial.foundations, afterFoundations: verified.foundations };
  return { state: current, receipt };
}
