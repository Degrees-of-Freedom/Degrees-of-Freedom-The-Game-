import type { TurnReport } from "./turns";

/** Foreman presentation policy v1 consumes the charged, pre-repair comparison.
 * An accepted prop may have already resolved the originating physical issue. */
function foremanIssues(report: TurnReport) {
  const event = report.penaltyDecision?.event, assessment = report.issues;
  if (report.penalty !== -1 || !event || !assessment || event.turn !== report.turn ||
      event.playerId !== report.playerId || event.amount !== -1 ||
      event.beforeModelId !== assessment.beforeModelId || event.afterModelId !== assessment.afterModelId) return [];
  return assessment.changes.filter(c => event.issueIds.includes(c.id) && c.eligible &&
    (c.change === "new" || c.change === "worsened") && c.after.validity === "verified" && c.after.active === true)
    .map(c => c.id);
}

/** Only physical evidence from a committed turn belongs in a public repair
 * explanation. Model fingerprints, issue memory, cards and draws stay private. */
export function publicRepairReport(report: TurnReport) {
  const receipt = report.correction;
  const charged = foremanIssues(report);
  if (!receipt && !charged.length) return null;
  const affected = new Set([...charged, ...(receipt?.attempts ?? []).map(attempt => attempt.issueId), ...(receipt?.pending ?? [])]);
  const issues = report.issues?.changes.filter(change => affected.has(change.id))
    .map(({ id, memberId, end, category, after }) => {
      const finalFinding = receipt?.changes.find(change => change.id === id)?.after;
      return { id, memberId, end, category, reason: after.reason,
        contacts: after.contactNodes ?? [], station: after.station, utilization: after.utilization,
        finalUtilization: finalFinding?.utilization };
    }) ?? [];
  const attempts = (receipt?.attempts ?? []).map(({ issueId, memberId, contact, ground, propId, status, reason }) =>
    ({ issueId, memberId, contact, ground, propId, status, reason }));
  const checks = (receipt?.repairChecks ?? []).filter(check => check.utilization !== undefined)
    .map(({ id, memberId, end, utilization, reason, station }) => ({ id, memberId, end, utilization, reason, station }));
  const beforeFoundations = receipt?.beforeFoundations ?? [], afterFoundations = receipt?.afterFoundations ?? [];
  const supports = [...new Set([...beforeFoundations, ...afterFoundations].map(f => f.jointId))]
    .map(jointId => {
      const before = beforeFoundations.find(f => f.jointId === jointId);
      const after = afterFoundations.find(f => f.jointId === jointId);
      const reading = (support: typeof before) => support && ({ upwardKN: support.upwardKN, reason: support.reason });
      return { jointId, owner: (after ?? before)!.owner, before: reading(before), after: reading(after) };
    });
  return { turn: report.turn, playerId: report.playerId, penalty: report.penalty,
    foreman: charged.length > 0,
    releaseForeman: issues.some(issue => charged.includes(issue.id) &&
      (issue.category === "instability" || (issue.utilization ?? 0) >= 1.25)),
    issues, attempts, checks, supports,
    pending: [...(receipt?.pending ?? [])], policy: receipt?.policy };
}

export type PublicRepairReport = NonNullable<ReturnType<typeof publicRepairReport>>;

export function repairContactLabel(id: string) {
  const port = /^port:(\d+):([123])$/.exec(id);
  if (port) return `member ${port[1]} at ${Number(port[2]) * 25}%`;
  const sleeve = /:contact-([ab])$/.exec(id);
  return sleeve ? "end " + sleeve[1].toUpperCase() : "joint " + id;
}

const signedForce = new Intl.NumberFormat("en", { maximumFractionDigits: 3, signDisplay: "exceptZero" });

/** Preserve the sign of a verified small reaction even below display precision. */
export function repairReaction(upwardKN: number) {
  if (upwardKN !== 0 && Math.abs(upwardKN) < 0.0005) {
    return (upwardKN < 0 ? "−" : "+") + Math.abs(upwardKN).toExponential(2) + " kN";
  }
  return signedForce.format(upwardKN) + " kN";
}
