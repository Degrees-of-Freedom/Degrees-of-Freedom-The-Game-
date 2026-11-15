import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { CANTILEVER_CATALOGUE, RELEASE_CATALOGUE } from "./cardCatalogue";
import { decodePrivateMatch, matchRecord } from "./releaseSave";
import { prepareReleaseSolver } from "./turnAnalysis";
import {
  activeTurnHand, createTurnGame, endTurn, parseTurnState, stageConnection,
  stageElement, stageLoad, type TurnState,
} from "./turns";
import { RELEASE_SOLVER } from "../solver/voxelVerification";

beforeAll(() => prepareReleaseSolver(() => readFile(new URL("../solver/wasm/dof_solver.wasm", import.meta.url))));

function accepted(next: ReturnType<typeof stageElement>): TurnState {
  if (!next.ok) throw new Error(next.reason);
  return next.state;
}

function quarterDeal() {
  for (let seed = 0; seed < 1000; seed++) {
    const turn = createTurnGame(seed, CANTILEVER_CATALOGUE);
    const hand = activeTurnHand(turn);
    const frame = hand.find(card => card.kind === "element" && card.type === "heb" && card.maxSteps >= 4);
    const fixed = hand.find(card => card.kind === "connection" && card.profile === "fixed");
    const load = hand.find(card => card.kind === "load" && card.magnitude === 5);
    if (frame && fixed && load) return { turn, frame, fixed, load };
  }
  throw new Error("No genuine opening deal supplies the quarter-cantilever fixture.");
}

describe("versioned cantilever release integration", () => {
  it("retains the original release's printings and replays old saves under their original rules", () => {
    const old = createTurnGame(1, RELEASE_CATALOGUE);
    const current = createTurnGame(1, CANTILEVER_CATALOGUE);
    expect(current.players).toEqual(old.players);
    expect(current.decks).toEqual(old.decks);
    expect(current.board).toEqual(old.board);
    expect(current.catalogue).not.toBe(old.catalogue);
    const restored = decodePrivateMatch(JSON.stringify(matchRecord(old, null, "planning")));
    expect(restored.rules).toBe(RELEASE_CATALOGUE);
    expect(restored.turn).toEqual(old);
  });

  it("finishes and privately reloads a scored match with a quarter-supported continuous beam", () => {
    const { turn, frame, fixed, load } = quarterDeal();
    const originalFittings = structuredClone(turn.board.connections);
    let current = accepted(stageElement(turn, frame.id, "4,7,1", "8,7,1", { quarter: 1, target: "5,7,1" }));
    current = accepted(stageConnection(current, fixed.id, 3, "q1", "5,7,1"));
    current = accepted(stageLoad(current, load.id, "endpoint:3:b"));
    const planning = matchRecord(current, null, "planning");
    expect(decodePrivateMatch(JSON.stringify(planning)).turn).toEqual(current);
    while (!current.finished) current = accepted(endTurn(current));

    expect(current.board.connections.filter(connection => connection.memberId < 3)).toEqual(originalFittings);
    expect(current.board.members.filter(member => member.cardId === frame.id)).toHaveLength(1);
    expect(current.board.connections.filter(connection => connection.cardId === fixed.id)).toHaveLength(1);
    expect(current.finalScore).toMatchObject({ partial: false, totalGravityKN: 5 });
    expect(current.finalScore!.receipt.solver).toBe(RELEASE_SOLVER);
    expect(current.finalScore!.awards[0].awardedShare).toBeCloseTo(100, 6);
    expect(current.finalScore!.awards[1].awardedShare).toBeCloseTo(0, 6);
    expect(parseTurnState(JSON.parse(JSON.stringify(current)))).toEqual(current);

    const record = matchRecord(current, planning, "final");
    const restored = decodePrivateMatch(JSON.stringify(record));
    expect(restored.rules).toBe(CANTILEVER_CATALOGUE);
    expect(restored.turn).toEqual(current);
  });
});
