import { describe, expect, it } from "vitest";
import { conflictingJointAxes, CONNECTION_PROFILES } from "./jointFreedom";
import { readSession, writeSession } from "./session";
import {
  activeTurnHand,
  cancelTurnDraft,
  createTurnGame,
  endTurn,
  parseTurnState,
  projectTurnModel,
  stageConnection,
  stageElement,
  stageLoad,
  type TurnState,
} from "./turns";

function apply(result: ReturnType<typeof endTurn>): TurnState {
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

describe("Kit turns", () => {
  it("retains a ball card attempted at another player's established fixed joint", () => {
    const placed = apply(stageElement(createTurnGame(0), "element-19", "5,3,1", "5,2,1"));
    const before = structuredClone(placed);
    const attempt = stageConnection(placed, "connection-13", 3, "a", "5,3,1");
    expect(attempt).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/5,3,1.*Member 2 end B.*Member 3 end A.*RX, RY, RZ/),
    });
    expect(placed).toEqual(before);
    expect(activeTurnHand(placed).some(({ id }) => id === "connection-13")).toBe(true);
    expect(stageConnection(placed, "connection-13", 3, "b").ok).toBe(true);
  });

  it("checks the first staged attachment at a new joint in either play order", () => {
    const first = apply(stageElement(createTurnGame(5), "element-7", "2,2,2", "2,2,3"));
    const second = apply(stageElement(apply(endTurn(first)), "element-18", "2,2,2", "3,2,2"));
    for (const [origin, next] of [["connection-2", "connection-21"], ["connection-21", "connection-2"]]) {
      const withOne = apply(stageConnection(second, origin, 3, "a"));
      expect(stageConnection(withOne, next, 4, "a")).toMatchObject({
        ok: false,
        reason: expect.stringContaining("Incompatible joint profiles at 2,2,2"),
      });
      expect(parseTurnState(apply(endTurn(withOne)))).toEqual(apply(endTurn(withOne)));
    }
  });

  it("compares axes in physical space while preserving individual elastic stiffness", () => {
    const axialSpring = [{ kind: "elastic", stiffness: 20 }, "locked", "locked", "free", "free", "free"] as const;
    const stiffer = [{ kind: "elastic", stiffness: 80 }, "locked", "locked", "free", "free", "free"] as const;
    const turn90 = [[0, 1, 0], [-1, 0, 0], [0, 0, 1]] as const;
    const reversed = [[-1, 0, 0], [0, -1, 0], [0, 0, 1]] as const;
    expect(conflictingJointAxes(axialSpring, stiffer, undefined, reversed)).toEqual([]);
    expect(conflictingJointAxes(axialSpring, stiffer, undefined, turn90)).toEqual(["UX", "UY"]);
    expect(conflictingJointAxes(CONNECTION_PROFILES.ball, CONNECTION_PROFILES.ball, undefined, turn90)).toEqual([]);
    expect(axialSpring[0].stiffness).toBe(20);
    expect(stiffer[0].stiffness).toBe(80);
  });

  it("reports both ends in a legacy mixed-joint save and preserves its original bytes", () => {
    const legacy = {
      version: 1, mode: "multiplayer", style: "kit",
      turn: { version: 1, seed: 0, events: [
        { kind: "element", cardId: "element-19", a: "5,3,1", b: "5,2,1" },
        { kind: "connection", cardId: "connection-13", memberId: 3, end: "a", jointId: "5,3,1" },
      ] },
    };
    const original = JSON.stringify(legacy);
    const values = new Map([["dof-runtime:session", original]]);
    const storage: Storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size; },
    };
    expect(readSession(storage)).toMatchObject({
      status: "invalid", reason: expect.stringMatching(/5,3,1.*Member 2 end B.*Member 3 end A/),
    });
    expect(writeSession(storage, { mode: "multiplayer", style: "kit", turn: createTurnGame(0) })).toBe(false);
    expect(values.get("dof-runtime:session")).toBe(original);
  });

  it("draws two cards from each deck exactly once per turn and preserves passes in replay", () => {
    const first = createTurnGame(23);
    expect(first.players[0].hand).toHaveLength(4);
    expect(
      activeTurnHand(first).filter((card) => card.kind === "connection"),
    ).toHaveLength(2);
    const second = apply(endTurn(first, 1));
    expect(endTurn(second, 1).ok).toBe(false);
    expect(second.players.map(({ hand }) => hand.length)).toEqual([4, 4]);
    expect(second.reports[0]).toMatchObject({
      status: "unresolved",
      penalty: 0,
    });
    expect(parseTurnState(JSON.parse(JSON.stringify(second)))).toEqual(second);
    expect(
      parseTurnState({
        version: second.version,
        seed: second.seed,
        events: [{ kind: "end", turn: 2 }],
      }),
    ).toBeNull();
  });

  it("separates coincident ends from attached joints and retains placements across turns", () => {
    let first = createTurnGame();
    for (
      let seed = 1;
      !activeTurnHand(first).some((card) => card.kind === "element");
      seed++
    ) {
      first = createTurnGame(seed);
    }
    const hand = activeTurnHand(first);
    const element = hand.find((card) => card.kind === "element")!;
    const connectors = hand.filter((card) => card.kind === "connection");
    const withMember = apply(stageElement(first, element.id, "5,3,1", "5,2,1"));
    const id = withMember.draft.members[0].id;
    expect(withMember.draft.connections).toEqual([]);
    const attached = apply(
      stageConnection(withMember, connectors[0].id, id, "a", "5,3,1"),
    );
    expect(stageConnection(attached, connectors[1].id, id, "a").ok).toBe(false);
    const both = apply(stageConnection(attached, connectors[1].id, id, "b"));
    expect(cancelTurnDraft(both)).toMatchObject({
      ok: true,
      state: { draft: { members: [], connections: [] } },
    });
    const committed = apply(endTurn(both));
    expect(
      committed.board.connections.filter(
        (connection) => connection.memberId === id,
      ),
    ).toHaveLength(2);
    expect(
      projectTurnModel(committed).members.map((member) => member.id),
    ).toContain(id);
    expect(parseTurnState(committed)).toEqual(committed);
  });

  it("allows a persistent downward load on the other player’s shared structure", () => {
    let first = createTurnGame();
    for (
      let seed = 1;
      !activeTurnHand(first).some((card) => card.kind === "load");
      seed++
    ) {
      first = createTurnGame(seed);
    }
    const load = activeTurnHand(first).find((card) => card.kind === "load")!;
    if (load.kind !== "load") throw new Error("Expected a load card");
    expect(stageLoad(first, load.id, "6,6,6").ok).toBe(false);
    const committed = apply(endTurn(apply(stageLoad(first, load.id, "5,3,1"))));
    expect(projectTurnModel(committed).attrs["5,3,1"].load).toBe(
      load.magnitude,
    );
    expect(committed.players[0].hand.some((card) => card.id === load.id)).toBe(
      false,
    );
  });

  it("restores active cards without drawing again and rejects excess placements", () => {
    let state = createTurnGame(17);
    while (
      activeTurnHand(state).filter((card) => card.kind === "connection")
        .length < 4 ||
      activeTurnHand(state).filter((card) => card.kind === "element").length <
        2 ||
      activeTurnHand(state).filter((card) => card.kind === "load").length < 2
    ) {
      state = apply(endTurn(state));
    }
    const hand = activeTurnHand(state);
    const [element, extraElement] = hand.filter(
      (card) => card.kind === "element",
    );
    const [load, extraLoad] = hand.filter((card) => card.kind === "load");
    const [first, second, extra] = hand.filter(
      (card) => card.kind === "connection",
    );
    let planned = apply(stageElement(state, element.id, "3,3,0", "3,3,1"));
    expect(stageElement(planned, extraElement.id, "2,3,0", "2,3,1").ok).toBe(
      false,
    );
    expect(stageLoad(planned, load.id, "3,3,1").ok).toBe(false);
    const id = planned.draft.members[0].id;
    planned = apply(stageConnection(planned, first.id, id, "a"));
    planned = apply(stageConnection(planned, second.id, id, "b"));
    expect(stageConnection(planned, extra.id, id, "b")).toMatchObject({
      ok: false,
      reason: "Two connections may be played per turn.",
    });
    planned = apply(stageLoad(planned, load.id, "3,3,1"));
    expect(stageLoad(planned, extraLoad.id, "3,3,1").ok).toBe(false);
    expect(parseTurnState(JSON.parse(JSON.stringify(planned)))).toEqual(
      planned,
    );
    expect(apply(cancelTurnDraft(planned))).toEqual(state);
  });

  it("ends at the configured round boundary and rejects oversized replay logs", () => {
    let state = createTurnGame();
    for (let turn = 1; turn <= 16; turn++) state = apply(endTurn(state, turn));
    expect(state).toMatchObject({ turn: 16, finished: true });
    expect(state.reports).toHaveLength(16);
    expect(activeTurnHand(state)).toEqual([]);
    expect(endTurn(state).ok).toBe(false);
    expect(parseTurnState(state)).toEqual(state);
    expect(
      parseTurnState({
        ...state,
        events: Array(81).fill({ kind: "end", turn: 1 }),
      }),
    ).toBeNull();
  });
});
