import { describe, expect, it } from "vitest";
import { activeTurnHand, cancelTurnDraft, createTurnGame, endTurn, parseTurnState,
  projectTurnModel, stageConnection, stageElement, stageLoad } from "./turns";
import { analyzeTurn, toTurnEvaluatorInput } from "./turnAnalysis";
import { analyzeConnectivity } from "./connectivity";
import { publicTurnModel } from "./publicTurnModel";
import { findPort, originalPorts } from "./turnPorts";

function accepted(transition: ReturnType<typeof stageElement>) {
  if (!transition.ok) throw Error(transition.reason);
  return transition.state;
}

describe("original reference quarter interfaces", () => {
  it("resolves diagonal stations in parent direction without recursive targets", () => {
    const parent = { id: 8, a: "4,1,2", b: "1,4,5", type: "glulam" as const };
    const ports = originalPorts(parent);
    expect(ports.map(port => port.point)).toEqual([[3.25,1.75,2.75], [2.5,2.5,3.5], [1.75,3.25,4.25]]);
    for (const port of ports) expect(findPort([parent], port.id)).toEqual(port);
    expect(findPort([parent], "port:8:1:1")).toBeUndefined();
    expect(findPort([parent], "port:8:0.25")).toBeUndefined();
    expect(originalPorts({ ...parent, type: "cable" }).every(port => !port.available)).toBe(true);
  });

  it.each([1, 2, 3])("retains quarter %i, its applied force and original parent through replay", quarter => {
    const turn = createTurnGame(5);
    const port = `port:1:${quarter}`, other = `port:2:${quarter}`;
    expect(stageElement(turn, "element-7", `1,3,${quarter / 4}`, other).ok).toBe(false);
    expect(stageElement(turn, "element-7", "port:1:1:1", other).ok).toBe(false);
    const placed = accepted(stageElement(turn, "element-7", port, other));
    expect(placed.draft.members[0].a).toBe(`1,3,${quarter / 4}`);
    expect(stageLoad(placed, "load-4", port).ok).toBe(false);
    expect(toTurnEvaluatorInput(placed).members).toHaveLength(3);
    expect(analyzeConnectivity(projectTurnModel(placed), placed).unsupportedMembers).toContain(3);
    const attached = accepted(stageConnection(placed, "connection-6", 3, "a"));
    expect(attached.draft.connections).toHaveLength(1);
    expect(stageConnection(attached, "connection-18", 3, "a").ok).toBe(false);
    const loaded = accepted(stageLoad(attached, "load-4", port));
    expect(activeTurnHand(loaded)).toHaveLength(1);
    expect(publicTurnModel(loaded)).toEqual(publicTurnModel(turn));
    expect(accepted(cancelTurnDraft(loaded))).toEqual(turn);
    const committed = accepted(endTurn(loaded));
    expect(parseTurnState(committed)).toEqual(committed);
    const projection = projectTurnModel(committed);
    expect(projection.members).toHaveLength(3);
    expect(projection.attrs[`1,3,${quarter / 4}`].load).toBe(5);
    expect(analyzeConnectivity(projection, committed).groundedMembers.has(3)).toBe(true);
    const input = toTurnEvaluatorInput(committed);
    const segments = input.members.filter(e => e.parentSpan?.memberId === 1);
    expect(segments.map(e => [e.parentSpan!.fromQuarter, e.parentSpan!.toQuarter])).toEqual([[0, quarter], [quarter, 4]]);
    expect(segments[0].b).toBe(port);
    expect(segments[1].a).toBe(port);
    expect(segments.every(e => e.endA === "fixed" && e.endB === "fixed")).toBe(true);
    expect(input.positions![port]).toEqual([1,3,quarter / 4]);
    const reaction = (model: typeof turn) => {
      const result = analyzeTurn(model);
      const context = result.ctx!;
      return result.combos[0].reac![context.aid[context.idx.get("1,3,0")!]][2];
    };
    expect(reaction(loaded) - reaction(attached)).toBeCloseTo(5, 8);
    // The 2 m original column and 8 m attached IPE retain their original weights.
    expect(reaction(attached)).toBeCloseTo(2 * 0.176 + 8 * 0.422, 8);
    expect(publicTurnModel(committed).board.joints).toContainEqual({
      id: port, point: `1,3,${quarter / 4}`, foundationOwner: undefined,
    });
  });
});
