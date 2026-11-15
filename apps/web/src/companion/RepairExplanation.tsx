import { repairContactLabel, repairReaction, type PublicRepairReport } from "../game/publicRepairReport";

/** Describe the recorded turn in its original order. A later pass, a replay,
 * or a change in today's model cannot alter the outcome of this explanation. */
export function RepairExplanation({ report, foreman = false }: { report: PublicRepairReport; foreman?: boolean }) {
  const accepted = report.attempts.filter(a => a.status === "verified");
  const fittings = report.jointAttempts.filter(a => a.status === "verified");
  const rejected = report.attempts.length - accepted.length;
  const readings = report.supports.filter(s => s.owner === "neutral" && !s.before && s.after);
  const seat = report.playerId.replace(/^player-(\d+)$/, "Player $1");
  return <section aria-label={`Repair explanation for turn ${report.turn}`}>
    <strong>{foreman && "Foreman report · "}Turn {report.turn} · {!report.policy ? "No repair recorded" :
      report.pending.length ? "Repair pending" : accepted.length || fittings.length ? "Verified repair" : "Repair assessment"}</strong>
    {report.issues.map(issue => <p key={issue.id}>Member {issue.memberId}
      {issue.end && " end " + issue.end.toUpperCase()}
      {issue.category === "instability" ? " was unstable." : issue.category === "connection-overload"
        ? " had an overloaded connector." : " was overloaded."}{" "}
      {issue.reason}{issue.utilization !== undefined && ` Utilization was ${issue.utilization.toFixed(3)}.`}
    </p>)}
    <p>{report.penalty === -1 ? `${seat} keeps the −1 point deduction from that turn.` : "This turn incurred no deduction."}</p>
    {report.jointAttempts.map(a => <p key={a.issueId + "/" + a.jointId}>{a.status === "verified"
      ? `A joint fitting locked ${["Rx", "Ry", "Rz"].filter((_, i) => a.lockedRotations & (1 << i)).join(", ")} at ${a.jointId}.`
      : `The fitting at ${a.jointId} was rejected.`} {a.reason}</p>)}
    {accepted.map(attempt => <p key={attempt.propId}>I added permanent neutral steel prop {attempt.propId}
      {" from "}{repairContactLabel(attempt.contact)} to ground ({attempt.ground}).
      {" "}Its stability, equilibrium and strength checks passed.</p>)}
    {readings.map(s => <p key={s.jointId}>
      {s.after!.upwardKN === null ? "The new anchor’s reaction is unavailable." :
        `The anchor reacted at ${repairReaction(s.after!.upwardKN)} (upward positive).`}
      {" "}Neither player scores its share.
    </p>)}
    {report.pending.length > 0 && <p>{rejected > 0 && `${rejected} local candidate${rejected === 1 ? " was" : "s were"} rejected. `}
      {accepted.length === 0 ? "I could not verify a local repair. Your pieces stay in place." :
        "The installed props stay in place. The remaining issues were still pending."}</p>}
  </section>;
}
