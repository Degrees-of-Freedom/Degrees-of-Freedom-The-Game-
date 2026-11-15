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
  expect(record).toMatchObject({ turn: 1, penalty: -1, pending: [],
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
  apply(endTurn(turn));
  expect(publicRepairReport(turn.reports[1])).toBeNull();
});
