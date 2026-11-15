import { publicRepairReport, repairContactLabel as contactLabel, repairReaction, type PublicRepairReport } from "../game/publicRepairReport";
import type { TurnReport } from "../game/turns";
import { attachmentLabel } from "../game/attachmentSites";

const seat = (id: string) => id === "neutral" ? "Neutral" : id.replace(/^player-(\d+)$/, "Player $1");
const issueNames = { instability: "instability", "connection-overload": "connector overload", "member-overload": "member overload" };

function reading(result: PublicRepairReport["supports"][number]["before"]) {
  if (!result) return "Absent";
  if (result.upwardKN === null) return "Unavailable · " + result.reason;
  return repairReaction(result.upwardKN);
}

function RepairEntry({ entry }: { entry: PublicRepairReport }) {
  const accepted = entry.attempts.filter(a => a.status === "verified");
  const rejected = entry.attempts.length - accepted.length;
  return <article>
    <h3>Turn {entry.turn} · {seat(entry.playerId)}</h3>
    <p><strong>{!entry.policy ? "No repair recorded" : entry.pending.length ? "Repair pending" : "Verified repair"}</strong>
      {" · "}{accepted.length} installed · {rejected} rejected</p>
    {entry.issues.map(issue => <p key={issue.id}>
      Member {issue.memberId}{issue.end && " · " + attachmentLabel(issue.end)} · {issueNames[issue.category]}.
      {" "}{issue.reason}{issue.contacts.length > 0 && " Contact at " + issue.contacts.map(contactLabel).join(", ") + "."}
      {issue.utilization !== undefined && " Utilization before repair " + issue.utilization.toFixed(3) + "."}
      {issue.finalUtilization !== undefined && " After repair " + issue.finalUtilization.toFixed(3) + "."}
      {issue.station !== undefined && " Station " + (issue.station * 100) + "%."}
    </p>)}
    <p>{entry.penalty === -1 ? "The turn keeps its −1 point deduction." : "No deduction on this turn."}</p>
    {accepted.map(a => <p key={a.propId}>
      Permanent neutral steel prop {a.propId} connects {contactLabel(a.contact)} to ground ({a.ground}).
      Its anchor earns no player attraction.
    </p>)}
    {entry.pending.length > 0 && <p>Pending after this turn · {entry.pending.map(id => {
      const issue = entry.issues.find(item => item.id === id);
      return issue ? "member " + issue.memberId + (issue.end ? " · " + attachmentLabel(issue.end) : "") + " " + issueNames[issue.category] : id;
    }).join(", ")}.</p>}
    <details>
      <summary>Verification details · turn {entry.turn}</summary>
      <ol>{entry.attempts.map((a, i) => <li key={i}>
        {a.status === "verified" ? "Installed" : "Rejected"} · {contactLabel(a.contact)} to ground ({a.ground}).
        {" "}{a.reason}
      </li>)}</ol>
      {entry.checks.length > 0 && <ul>{entry.checks.map(check => <li key={check.id}>
        Member {check.memberId}{check.end && " · " + attachmentLabel(check.end)} · {check.reason}.
        {" "}Utilization {check.utilization?.toFixed(3)}{check.station !== undefined && " at " + check.station * 100 + "%"}.
      </li>)}</ul>}
      <table>
        <caption>Foundation reactions · global Z, positive upward</caption>
        <thead><tr><th scope="col">Foundation</th><th scope="col">Before repair</th><th scope="col">After repair</th></tr></thead>
        <tbody>{entry.supports.map(s => <tr key={s.jointId}>
          <th scope="row">{seat(s.owner)} · {s.jointId}</th><td>{reading(s.before)}</td><td>{reading(s.after)}</td>
        </tr>)}</tbody>
      </table>
      {entry.policy && <p>Repair policy {entry.policy}</p>}
    </details>
  </article>;
}

export function RepairHistory({ reports }: { reports: TurnReport[] }) {
  const entries = reports.map(publicRepairReport).filter(entry => entry !== null);
  if (!entries.length) return null;
  return <details>
    <summary>Repair history ({entries.length})</summary>
    <section aria-label="Repair history">
      {entries.slice().reverse().map(entry => <RepairEntry key={entry.turn} entry={entry} />)}
    </section>
  </details>;
}
