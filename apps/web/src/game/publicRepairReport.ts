import type { TurnReport } from "./turns";

/** Only physical evidence from a committed turn belongs in a public repair
 * explanation. Model fingerprints, issue memory, cards and draws stay private. */
export function publicRepairReport(report: TurnReport) {
  const receipt = report.correction;
  if (!receipt) return null;
  const affected = new Set([...receipt.attempts.map(attempt => attempt.issueId), ...receipt.pending]);
  const issues = report.issues?.changes.filter(change => affected.has(change.id))
    .map(({ id, memberId, end, category, after }) => {
      const finalFinding = receipt.changes.find(change => change.id === id)?.after;
      return { id, memberId, end, category, reason: after.reason,
        contacts: after.contactNodes ?? [], station: after.station, utilization: after.utilization,
        finalUtilization: finalFinding?.utilization };
    }) ?? [];
  const attempts = receipt.attempts.map(({ issueId, memberId, contact, ground, propId, status, reason }) =>
    ({ issueId, memberId, contact, ground, propId, status, reason }));
  const checks = receipt.repairChecks.filter(check => check.utilization !== undefined)
    .map(({ id, memberId, end, utilization, reason, station }) => ({ id, memberId, end, utilization, reason, station }));
  const supports = [...new Set([...receipt.beforeFoundations, ...receipt.afterFoundations].map(f => f.jointId))]
    .map(jointId => {
      const before = receipt.beforeFoundations.find(f => f.jointId === jointId);
      const after = receipt.afterFoundations.find(f => f.jointId === jointId);
      const reading = (support: typeof before) => support && ({ upwardKN: support.upwardKN, reason: support.reason });
      return { jointId, owner: (after ?? before)!.owner, before: reading(before), after: reading(after) };
    });
  return { turn: report.turn, playerId: report.playerId, penalty: report.penalty,
    issues, attempts, checks, supports, pending: [...receipt.pending], policy: receipt.policy };
}

export type PublicRepairReport = NonNullable<ReturnType<typeof publicRepairReport>>;
