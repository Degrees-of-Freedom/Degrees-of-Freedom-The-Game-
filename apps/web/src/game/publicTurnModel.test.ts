import { describe, expect, it } from "vitest";
import { publicTurnModel } from "./publicTurnModel";
import { activeTurnHand, createTurnGame, endTurn, stageConnection, stageElement, stageLoad } from "./turns";

function accepted(transition: ReturnType<typeof endTurn>) {
  if (!transition.ok) throw new Error(transition.reason);
  return transition.state;
}

describe("public Shared table model", () => {
  it("shows played geometry and turn reports while both hands, draws and the current plan stay private", () => {
    const first = createTurnGame(23);
    const hand = activeTurnHand(first);
    const element = hand.find(card => card.kind === "element")!;
    const connector = hand.find(card => card.kind === "connection")!;
    const placed = accepted(stageElement(first, element.id, "2,2,1", "2,2,2"));
    const memberId = placed.draft.members[0].id;
    const attached = accepted(stageConnection(placed, connector.id, memberId, "a"));
    const second = accepted(endTurn(attached));
    const load = activeTurnHand(second).find(card => card.kind === "load")!;
    const planned = accepted(stageLoad(second, load.id, "1,3,1"));
    const view = publicTurnModel(planned);

    expect(view).toEqual(publicTurnModel(second));
    expect(view).toMatchObject({
      turn: 2,
      activePlayerId: "player-2",
      reports: [{ turn: 1, playerId: "player-1" }],
    });
    expect(view.board.joints).toContainEqual({ id: "1,3,0", foundationOwner: "player-1" });
    expect(view.board.members).toContainEqual({
      id: memberId, a: "2,2,1", b: "2,2,2", type: element.type, owner: "player-1",
    });
    expect(view.board.connections).toContainEqual({
      memberId, end: "a", jointId: "2,2,1", profile: connector.profile, owner: "player-1",
    });
    const json = JSON.stringify(view);
    expect(json).not.toMatch(/"(seed|players|decks|hand|cardId|draft|events|nextId)":/);
    for (const card of [...planned.players.flatMap(player => player.hand), ...planned.decks.flat(), element, connector]) {
      expect(json).not.toContain(JSON.stringify(card.id));
    }

    const committed = publicTurnModel(accepted(endTurn(planned)));
    expect(committed.board.loads).toEqual([{ jointId: "1,3,1", magnitude: load.magnitude, owner: "player-2" }]);
  });
});
