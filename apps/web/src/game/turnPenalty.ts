import type { IssueAssessment } from "./turnIssues";
import type { TurnState } from "./turns";

export interface PenaltyDecision {
  policy: "issue-penalty-1";
  event: null | {
    id: string;
    playerId: string;
    turn: number;
    amount: -1;
    beforeModelId: string;
    afterModelId: string;
    issueIds: string[];
  };
}

/** Record one charge for the acting player, linked to every qualifying change
 * in the frozen pre-correction assessment. An empty decision still records
 * which policy was in force when the turn ended.
 */
export function decidePenalty(state: TurnState, issues: IssueAssessment): PenaltyDecision {
  const issueIds = issues.changes.filter(change => change.eligible).map(change => change.id);
  const playerId = state.players[state.playerIndex].id;
  return {
    policy: "issue-penalty-1",
    event: issueIds.length ? {
      id: [state.catalogue, state.seed, state.turn, playerId].join("/"),
      playerId,
      turn: state.turn,
      amount: -1,
      beforeModelId: issues.beforeModelId,
      afterModelId: issues.afterModelId,
      issueIds,
    } : null,
  };
}
