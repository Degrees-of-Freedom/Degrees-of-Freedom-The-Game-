import { readFile } from "node:fs/promises";
import { beforeAll, expect, it } from "vitest";
import { CANTILEVER_CATALOGUE, createReleaseDecks } from "./cardCatalogue";
import { decodePrivateMatch, matchRecord } from "./releaseSave";
import { prepareReleaseSolver } from "./turnAnalysis";
import { activeTurnHand, createTurnGame, endTurn, stageConnection, stageElement, stageLoad } from "./turns";

beforeAll(() => prepareReleaseSolver(() => readFile(new URL("../solver/wasm/dof_solver.wasm", import.meta.url))));

function accept(result: ReturnType<typeof stageElement>) {
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

it("keeps a saved loaded tip private until explicitly fitted to an authorable shared joint", () => {
  let state = createTurnGame(0,CANTILEVER_CATALOGUE);
  for (let attempts = 0; ; attempts++) {
    if (attempts >= 1000) throw new Error("No genuine opening deal supplies the loaded-tip fixture.");
    const hand = activeTurnHand(state);
    if (hand.some(c => c.kind === "element" && c.type === "heb") &&
        hand.some(c => c.kind === "connection" && c.profile === "fixed") &&
        hand.some(c => c.kind === "load" && c.magnitude === 5)) break;
    state = createTurnGame(state.seed+1,CANTILEVER_CATALOGUE);
  }
  const hand = activeTurnHand(state);
  const frame = hand.find(c => c.kind === "element" && c.type === "heb")!;
  const fixed = hand.find(c => c.kind === "connection" && c.profile === "fixed")!;
  const load = hand.find(c => c.kind === "load" && c.magnitude === 5)!;
  state = accept(stageElement(state,frame.id,"4,7,1","8,7,1",{quarter:1,target:"5,7,1"}));
  state = accept(stageConnection(state,fixed.id,3,"q1"));
  state = accept(stageLoad(state,load.id,"endpoint:3:b"));
  state = accept(endTurn(state));
  state = decodePrivateMatch(JSON.stringify(matchRecord(state,null,"planning"))).turn;
  expect(state.board.joints).toContainEqual({id:"endpoint:3:b",point:"8,7,1"});

  // Exact printing fixtures isolate authoring rules from the next player's deal.
  const cards = createReleaseDecks().flat();
  const nextFrame = cards.find(c => c.kind === "element" && c.type === "heb" && c.maxSteps === 5)!;
  const nextFixed = cards.find(c => c.kind === "connection" && c.profile === "fixed")!;
  state.players[state.playerIndex].hand = [nextFrame,nextFixed];
  expect(stageElement(state,nextFrame.id,"8,5,1","8,9,1",{quarter:2,target:"endpoint:3:b"})).toMatchObject({
    ok:false,reason:expect.stringMatching(/existing shared joint/),
  });
  expect(stageElement(state,nextFrame.id,"8,5,1","8,9,1",{quarter:2,target:"8,7,1"}).ok).toBe(false);

  const fabricated = structuredClone(state);
  fabricated.draft.members.push({id:4,a:"8,5,1",b:"8,9,1",type:"heb",owner:"player-2",cardId:nextFrame.id,
    interiorTargets:{q2:"endpoint:3:b"}});
  expect(stageConnection(fabricated,nextFixed.id,4,"q2")).toMatchObject({
    ok:false,reason:expect.stringMatching(/shared joint or original quarter port/),
  });
  // Fitting the host's actual end remains a separate permitted card action.
  expect(stageConnection(state,nextFixed.id,3,"b","8,7,1").ok).toBe(true);
});
