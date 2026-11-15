import type { FinalScore } from "../game/finalScore";
import "./FinalScorePanel.css";

const number = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
const seat = (id: string) => id.replace(/^player-(\d+)$/, "Player $1");

export function FinalScorePanel({ score }: { score: FinalScore }) {
  return (
    <section className="final-score" aria-label="Final score">
      <h3>{score.winners.map(seat).join(" and ")} {score.winners.length === 1 ? "wins" : "tie"}</h3>
      <p>{score.partial ? "Partial-evidence final result" : "Verified final reactions"} ·
        {" "}{score.totalGravityKN === 0 ? "No scored gravity loads" : `${number.format(score.totalGravityKN)} kN of gravity cards`}</p>
      <table>
        <caption>Final foundation share minus turn penalties</caption>
        <thead><tr><th scope="col">Player</th><th scope="col">Share</th><th scope="col">Penalties</th><th scope="col">Score</th></tr></thead>
        <tbody>{score.awards.map(a => <tr key={a.playerId}>
          <th scope="row">{seat(a.playerId)}</th><td>{number.format(a.awardedShare)}%</td>
          <td>{a.penaltyPoints}</td><td>{number.format(a.finalScore)}</td>
        </tr>)}</tbody>
      </table>
      <p>Neutral support share {number.format(score.neutralShare)}%.
        {" "}Unverified gravity {number.format(score.unknownGravityKN)} kN.</p>
      <details>
        <summary>Foundation reactions and evidence</summary>
        <p>Upward reactions are positive. Each verified component contributes to the award under the final gravity-card load.</p>
        <ul>{score.receipt.components.map((scope, i) => <li key={i}>
          {scope.reason} {scope.foundations.map(f =>
            `${f.jointId} (${f.upwardKN === null ? "reaction unavailable" : number.format(f.upwardKN) + " kN"})`
          ).join(", ")}
          {!scope.verified && scope.memberIds.length > 0 && ` Affected members ${scope.memberIds.join(", ")}.`}
        </li>)}</ul>
      </details>
    </section>
  );
}
