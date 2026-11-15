import { expect, it } from "vitest";
import { publicRepairReport } from "./publicRepairReport";
import { SCORED_CATALOGUE } from "./cardCatalogue";
import { createTurnGame, endTurn, stageConnection, stageElement, stageLoad } from "./turns";

it("projects committed local repair evidence without copying private comparison signatures", () => {
  let turn = createTurnGame(7, SCORED_CATALOGUE);
  function apply(result: ReturnType<typeof endTurn>) {
    if (!result.ok) throw Error(result.reason);
    turn = result.state;
  }
  apply(stageElement(turn, "element-6", "port:1:1", "port:2:1"));
  apply(stageConnection(turn, "connection-13", 3, "a"));
  apply(stageLoad(turn, "load-18", "port:1:1"));
  apply(endTurn(turn));
  const record = publicRepairReport(turn.reports[0])!;
  expect(record).toMatchObject({ turn: 1, penalty: -1, foreman: true, pending: [],
    issues: [{ category: "instability", memberId: 3, reason: expect.stringContaining("pin") }],
    attempts: [{ status: "rejected" }, { status: "verified", contact: "port:3:2", propId: 4 }],
  });
  expect(record.supports.some(s => s.before?.upwardKN === null)).toBe(true);
  expect(record.supports.find(s => s.owner === "neutral")).toMatchObject({
    before: undefined, after: { upwardKN: expect.any(Number) },
  });
  const json = JSON.stringify(record);
  for (const omitted of ["element-6", "load-18", "connection-13", "7/", "ModelId", "memory", "hand"]) {
    expect(json).not.toContain(omitted);
  }
  // The public presentation uses the frozen charge even after all instability
  // has been repaired. Corrupt, unrelated, or inconclusive evidence stays quiet.
  const report = turn.reports[0];
  const decision = report.penaltyDecision!, event = decision.event!, issues = report.issues!;
  expect(publicRepairReport({...report, penalty: 0})?.foreman).toBe(false);
  expect(publicRepairReport({...report, penaltyDecision: undefined})?.foreman).toBe(false);
  for (const mismatch of [{turn: 9}, {playerId:"another-player"}, {id:"stale-event"}, {afterModelId:"stale"}, {issueIds:[]}]) {
    expect(publicRepairReport({...report, penaltyDecision:{...decision,event:{...event,...mismatch}}})?.foreman).toBe(false);
  }
  const change = issues.changes.find(change => event.issueIds.includes(change.id))!;
  for (const classification of ["new","worsened","persistent","improved","resolved","unknown"] as const) {
    const projected = publicRepairReport({...report, issues:{...issues,changes:[{...change, change:classification}]}});
    expect(projected?.foreman).toBe(classification === "new" || classification === "worsened");
  }
  expect(publicRepairReport({...report,issues:{...issues,changes:[{...change,after:{...change.after,validity:"unknown"}}]}})?.foreman).toBe(false);
  expect(record.charge).toEqual({id:"1/player-1", unstableMemberId:3});
  for (const utilization of [1.01, 1.2499, 1.25]) {
    const finding = { ...change, category: "member-overload" as const,
      after: { ...change.after, category: "member-overload" as const, utilization } };
    expect(publicRepairReport({ ...report, issues: { ...issues, changes: [finding] } })?.charge)
      .toEqual({id:"1/player-1", unstableMemberId:undefined});
    expect(publicRepairReport({ ...report, issues: { ...issues, changes: [{ ...finding, change: "persistent" }] } })?.charge).toBeUndefined();
  }
  expect(publicRepairReport({...report,correction:undefined})).toMatchObject({foreman:true,attempts:[],policy:undefined});
  apply(endTurn(turn));
  expect(publicRepairReport(turn.reports[1])).toBeNull();
});
