import { describe, expect, it } from "vitest";
import { SCORED_CATALOGUE } from "./cardCatalogue";
import { awardFinalScore } from "./finalScore";
import { publicTurnReport } from "./publicTurnModel";
import { assessTurnIssues } from "./turnIssues";
import {
  cancelTurnDraft, createTurnGame, endTurn, parseTurnState, stageConnection,
  stageElement, stageLoad, type TurnState,
} from "./turns";

function accepted(result: ReturnType<typeof endTurn>) {
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

function wire(turn: TurnState, events: unknown[] = turn.events) {
  return JSON.parse(JSON.stringify({ version: turn.version, catalogue: turn.catalogue, engine: turn.engine, seed: turn.seed, events }));
}

function resume(turn: TurnState, events?: unknown[]) {
  const restored = parseTurnState(wire(turn, events));
  if (!restored) throw new Error("Expected a recoverable match");
  return restored;
}

/** End an originating turn in the historical issues-only or penalty-only
 * format, predating any automated correction. The board in that save must
 * remain available for a later player's own physical repair.
 */
function historicalEnd(turn: TurnState, withPenalty: boolean) {
  const next = accepted(endTurn(turn));
  const report = next.reports.at(-1)!;
  return resume(turn, [...turn.events, {
    kind: "end", turn: report.turn, status: report.status, issues: report.issues,
    ...(withPenalty && { penaltyDecision: report.penaltyDecision }),
  }]);
}

function pinMechanism() {
  let turn = createTurnGame(7, SCORED_CATALOGUE);
  turn = accepted(stageElement(turn, "element-6", "port:1:1", "port:2:1"));
  turn = accepted(stageConnection(turn, "connection-13", 3, "a"));
  return accepted(stageLoad(turn, "load-18", "port:1:1"));
}

describe("originating turn deductions", () => {
  it("keeps preview and cancellation free, charges a verified mechanism once, and rejects changed receipts", () => {
    const turn = pinMechanism();
    const assessment = assessTurnIssues(turn);
    expect(assessment.changes.some(c => c.id === "instability:3" && c.eligible)).toBe(true);
    expect(turn.reports).toEqual([]);
    expect(accepted(cancelTurnDraft(turn)).reports).toEqual([]);
    const next = accepted(endTurn(turn));
    const report = next.reports[0];
    expect(report.penalty).toBe(-1);
    expect(report.penaltyDecision).toEqual({ policy: "issue-penalty-1", event: {
      id: [turn.catalogue, 7, 1, "player-1"].join("/"), turn: 1, playerId: "player-1", amount: -1,
      beforeModelId: assessment.beforeModelId, afterModelId: assessment.afterModelId, issueIds: ["instability:3"],
    } });
    expect(endTurn(next, 1).ok).toBe(false);
    expect(resume(resume(next))).toEqual(next);
    for (const field of ["issueIds", "amount", "id", "playerId", "beforeModelId", "afterModelId"]) {
      const invalid = wire(next);
      invalid.events.at(-1).penaltyDecision.event[field] = null;
      expect(parseTurnState(invalid)).toBeNull();
    }
  });

  it("links every qualifying issue to one point, including a different player's overloaded beam", () => {
    let turn = createTurnGame(97, SCORED_CATALOGUE);
    turn = accepted(stageElement(turn, "element-21", "1,3,0", "2,3,0"));
    turn = accepted(stageConnection(turn, "connection-26", 3, "a"));
    turn = accepted(stageConnection(turn, "connection-20", 3, "b"));
    turn = accepted(endTurn(turn));
    turn = accepted(stageElement(turn, "element-4", "1,1,2", "2,1,2"));
    turn = accepted(stageLoad(turn, "load-3", "2,3,0"));
    turn = accepted(endTurn(turn));
    const report = turn.reports[1];
    expect(report.penaltyDecision?.event).toMatchObject({
      playerId: "player-2", turn: 2, amount: -1, issueIds: ["instability:4", "member-overload:3"],
    });
    const publicReport = publicTurnReport(report);
    expect(publicReport.penalty).toBe(-1);
    expect(publicReport.penaltyReasons.map(r => r.id)).toEqual(["instability:4", "member-overload:3"]);
    expect(Math.abs(publicReport.penaltyReasons[1].utilization! / 1.21761 - 1)).toBeLessThan(1e-3);
    expect(JSON.stringify(publicReport)).not.toContain("97/");
    expect(resume(turn)).toEqual(turn);
  });

  it("keeps the original deduction through a pass, a verified player repair, reload and final scoring", () => {
    let turn = historicalEnd(pinMechanism(), true);
    const original = turn.reports[0];
    turn = historicalEnd(turn, true);
    const pass = turn.reports[1];
    expect(pass.issues?.changes.find(c => c.id === "instability:3")?.change).toBe("persistent");
    expect(pass.penaltyDecision).toEqual({ policy: "issue-penalty-1", event: null });
    turn = accepted(stageConnection(turn, "connection-0", 3, "b"));
    turn = accepted(endTurn(turn));
    expect(turn.reports[2].issues?.changes.find(c => c.id === "instability:3")?.change).toBe("resolved");
    expect(turn.reports[2].penalty).toBe(0);
    expect(turn.reports[0]).toEqual(original);
    while (!turn.finished) turn = accepted(endTurn(turn));
    expect(turn.reports.filter(r => r.penalty === -1)).toEqual([original]);
    const score = turn.finalScore!.awards[0];
    expect(score.penaltyPoints).toBe(1);
    expect(score.finalScore).toBe(score.awardedShare - 1);
    expect(resume(turn)).toEqual(turn);
  });

  it("preserves older uncharged issue reports on resume, including a completed match's exact awards", () => {
    let turn = historicalEnd(pinMechanism(), false);
    expect(turn.reports[0].issues?.changes.some(change => change.eligible)).toBe(true);
    expect(turn.reports[0].penalty).toBe(0);
    expect(turn.reports[0].penaltyDecision).toBeUndefined();
    expect(publicTurnReport(turn.reports[0]).penaltyReasons).toEqual([]);
    const resumed = accepted(endTurn(turn));
    expect(resumed.reports[0]).toEqual(turn.reports[0]);
    expect(resumed.reports[1].penalty).toBe(0);

    // Stage the player's historical repair before completing the old match.
    turn = accepted(stageConnection(turn, "connection-2", 3, "b"));
    while (turn.turn < 16) turn = historicalEnd(turn, false);
    const live = accepted(endTurn(turn));
    const last = live.reports.at(-1)!;
    const final = awardFinalScore(live, live.finalScore!.receipt);
    const historical = resume(turn, [...turn.events, {
      kind: "end", turn: 16, status: last.status, issues: last.issues, final,
    }]);
    expect(historical.reports.every(r => r.penalty === 0 && !r.penaltyDecision)).toBe(true);
    expect(historical.finalScore).toEqual(final);
    expect(resume(historical)).toEqual(historical);
  });

  it("finishes below zero when the player earned no attraction and incurred a deduction", () => {
    let turn = createTurnGame(7, SCORED_CATALOGUE);
    turn = accepted(stageElement(turn, "element-6", "port:1:1", "port:2:1"));
    while (!turn.finished) turn = accepted(endTurn(turn));
    expect(turn.finalScore?.awards.map(a => a.finalScore)).toEqual([-1, 0]);
    expect(turn.finalScore?.winners).toEqual(["player-2"]);
    expect(resume(turn).finalScore).toEqual(turn.finalScore);
  });
});
