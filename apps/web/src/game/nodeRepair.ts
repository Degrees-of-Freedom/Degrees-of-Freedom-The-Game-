import { analyzeTurn } from './turnAnalysis';
import { finalReceipt } from './finalScore';
import { compareIssues, inspectIssues, type IssueAssessment } from './turnIssues';
import { CARD_DEFINITION_VERSION } from './cardCatalogue';
import { connectionDefinition } from './jointFreedom';
import { jointCorrectionMask } from './jointCorrections';
import { NODE_REPAIR_POLICY, type CorrectionReceipt } from './turnRepair';
import type { TurnState } from './turns';

function evidence(turn: TurnState) {
  let result: ReturnType<typeof analyzeTurn> | null = null;
  try { result = analyzeTurn(turn, 'card-gravity'); } catch { /* Unavailable is never a repair success. */ }
  const receipt = finalReceipt(turn, result);
  const foundations = receipt.components.flatMap(scope => scope.foundations.map(support => ({...support,
    owner: turn.board.joints.find(joint => joint.id === support.jointId)!.foundationOwner!, reason: scope.reason})));
  return {issues: inspectIssues(turn, result), foundations};
}

/** Fit a rated moment sleeve at an existing joint, locking relative rotations
 * through the existing members. No joint is restrained to ground by this
 * operation. A floating structure can therefore remain truthfully unresolved. */
export function correctJointReleases(frozen: TurnState, assessment: IssueAssessment, turnNumber: number) {
  const targets = assessment.changes.filter(change => change.eligible && change.after.active === true)
    .sort((a, b) => Number(b.category === 'instability') - Number(a.category === 'instability') || a.memberId - b.memberId);
  if (!targets.length || assessment.beforeModelId === assessment.afterModelId) return undefined;
  const initial = evidence(frozen);
  let current = frozen, verified = initial;
  const jointAttempts: NonNullable<CorrectionReceipt['jointAttempts']> = [];
  for (const issue of targets) {
    if (jointAttempts.length >= 3) break;
    if (verified.issues.findings.find(finding => finding.id === issue.id)?.active === false) continue;
    const members = new Set(issue.after.memberIds);
    const candidates = current.board.connections.filter(connection => members.has(connection.memberId))
      .sort((a, b) => Number(b.memberId === issue.memberId) - Number(a.memberId === issue.memberId) ||
        a.jointId.localeCompare(b.jointId));
    const seen = new Set<string>();
    for (const connection of candidates) {
      if (jointAttempts.length >= 3) break;
      if (seen.has(connection.jointId)) continue;
      seen.add(connection.jointId);
      const jointId = connection.jointId;
      const attached = current.board.connections.filter(end => end.jointId === jointId);
      if (jointCorrectionMask(current.board, jointId) === 7 ||
          attached.some(end => connectionDefinition(end.profile, end.axes).laws.slice(0, 3).some(law => law.kind !== 'locked')) ||
          !attached.some(end => connectionDefinition(end.profile, end.axes).laws.slice(3).some(law => law.kind !== 'locked'))) continue;
      const correction = {jointId, lockedRotations: 7, system: {policy: NODE_REPAIR_POLICY,
        definitionVersion: CARD_DEFINITION_VERSION, turn: turnNumber, issueId: issue.id,
        objectId: `system-joint:${turnNumber}:${jointId}`}} as const;
      const trial = {...current, board: {...current.board,
        jointCorrections: [...(current.board.jointCorrections ?? []), correction]}};
      const after = evidence(trial);
      const comparison = compareIssues(verified.issues, after.issues, assessment.memory);
      const target = comparison.changes.find(change => change.id === issue.id);
      const harmful = comparison.changes.find(change => change.after.active === true && change.eligible);
      const lost = after.issues.findings.find(finding => finding.validity !== 'verified' &&
        verified.issues.findings.some(prior => prior.id === finding.id && prior.validity === 'verified'));
      const missingSupport = verified.foundations.find(support => support.upwardKN !== null &&
        !after.foundations.some(next => next.jointId === support.jointId && next.upwardKN !== null));
      const reason = target?.after.active !== false ? 'The affected issue still lacks verified clearance.' :
        harmful ? `The fitted joint creates or worsens ${harmful.id}.` :
        lost ? `Verification was lost for ${lost.id}.` :
        missingSupport ? `Equilibrium was lost at ${missingSupport.jointId}.` : null;
      jointAttempts.push({issueId: issue.id, memberId: issue.memberId, jointId, lockedRotations: 7,
        status: reason ? 'rejected' : 'verified', reason: reason ?? 'Verified moment transfer, equilibrium, stability and fitting/member capacity.'});
      if (!reason) { current = trial; verified = after; break; }
    }
  }
  const post = compareIssues(initial.issues, verified.issues, assessment.memory);
  const receipt: CorrectionReceipt = {policy: NODE_REPAIR_POLICY, beforeModelId: initial.issues.modelId,
    afterModelId: verified.issues.modelId, attempts: [], jointAttempts,
    pending: post.changes.filter(change => change.after.active === true).map(change => change.id),
    memory: post.memory, changes: post.changes,
    repairChecks: verified.issues.findings.filter(finding => finding.category === 'connection-overload' &&
      current.board.connections.some(connection => connection.memberId === finding.memberId &&
        connection.end === finding.end && current.board.jointCorrections?.some(correction => correction.jointId === connection.jointId))),
    beforeFoundations: initial.foundations, afterFoundations: verified.foundations};
  return {state: current, receipt};
}
