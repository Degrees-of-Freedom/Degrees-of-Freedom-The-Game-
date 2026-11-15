import { describe, expect, it } from "vitest";
import { CANTILEVER_CATALOGUE, RELEASE_CATALOGUE, createReleaseDecks } from "./cardCatalogue";
import { analysisLoadJoint, connectionLocations, loadTargets, turnJoints } from "./turnPorts";
import { attachmentPoint, type InteriorSite } from "./attachmentSites";
import { activeTurnHand, cancelTurnDraft, createTurnGame, parseTurnState, stageConnection, stageElement, stageLoad,
  type TurnCard, type TurnState } from "./turns";

const cards = createReleaseDecks().flat();
const frame = cards.find(c => c.kind === "element" && c.type === "heb" && c.maxSteps === 5)!;
const fixed = cards.filter(c => c.kind === "connection" && c.profile === "fixed");
const load = cards.find(c => c.kind === "load")!;
const partial = cards.find(c => c.kind === "connection" && c.rotationsToLock === 2)!;
const fixture = (...hand: TurnCard[]) => {
  const state = createTurnGame(41, CANTILEVER_CATALOGUE);
  state.players[0].hand = hand;
  return state;
};
function accept(result: ReturnType<typeof stageElement>): TurnState {
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

describe("explicit fixed interior collars", () => {
  it("keeps both release catalogues on their implicit Rust engine", () => {
    expect(createTurnGame(41, RELEASE_CATALOGUE)).not.toHaveProperty("engine");
    expect(createTurnGame(41, CANTILEVER_CATALOGUE)).not.toHaveProperty("engine");
  });
  it.each([1, 2, 3] as const)("supports the whole new member at its original quarter %i", quarter => {
    const state = fixture(frame, fixed[0]);
    const original = structuredClone(state.board);
    const site = `q${quarter}` as InteriorSite;
    const placed = accept(stageElement(state, frame.id, `${5-quarter},7,1`, `${9-quarter},7,1`, {quarter, target:"5,7,1"}));
    expect(placed.draft.members).toHaveLength(1);
    expect(placed.draft.connections).toHaveLength(0);
    expect(placed.draft.members[0].interiorTargets).toEqual({[site]:"5,7,1"});
    expect(attachmentPoint(placed.draft.members[0], site)).toBe("5,7,1");
    expect(connectionLocations(placed.board.members, placed.draft.members[0], site)).toEqual(["5,7,1"]);
    const attached = accept(stageConnection(placed, fixed[0].id, 3, site));
    expect(attached.draft.connections).toMatchObject([{memberId:3, end:site, jointId:"5,7,1", profile:"fixed"}]);
    expect(activeTurnHand(attached)).toEqual([]);
    expect(attached.board).toEqual(original);
    expect(turnJoints(attached)).toContainEqual({id:`port:3:${quarter}`, point:"5,7,1"});
    expect(analysisLoadJoint(attached, `port:3:${quarter}`)).toBe("5,7,1");
    expect(accept(cancelTurnDraft(attached))).toEqual(state);
  });

  it("does not legalize an undeclared crossing or silently move a station off its exact support", () => {
    const state = fixture(frame, fixed[0]);
    expect(stageElement(state, frame.id, "4,7,1", "8,7,1")).toMatchObject({ok:false, reason:expect.stringMatching(/intersect material/)});
    expect(stageElement(state, frame.id, "4,7,1", "8,7,1", {quarter:2, target:"5,7,1"})).toMatchObject({
      ok:false, reason:expect.stringMatching(/coincide exactly/),
    });
    expect(stageElement(state, frame.id, "4,6,1", "8,6,1", {quarter:1, target:"5,6,1"})).toMatchObject({
      ok:false, reason:expect.stringMatching(/existing shared joint/),
    });
    expect(stageElement(state, frame.id, "4,7,1", "10,7,1", {quarter:1, target:"5,7,1"})).toMatchObject({
      ok:false, reason:expect.stringMatching(/at most 5/),
    });
    expect(stageElement(state, frame.id, "-1,7,1", "3,7,1", {quarter:1, target:"5,7,1"}).ok).toBe(false);
    expect(state.draft.members).toEqual([]);
    expect(state.events).toEqual([]);
  });

  it("places a second perpendicular midpoint beam at the same existing support without changing the first collar", () => {
    const first = accept(stageConnection(accept(stageElement(fixture(frame,fixed[0]),frame.id,
      "3,7,1","7,7,1",{quarter:2,target:"5,7,1"})),fixed[0].id,3,"q2"));
    // Physical placement fixture: the first validated beam and collar are now
    // committed objects; replay and full turn assessment have separate coverage.
    const state = fixture(frame,fixed[1]);
    state.nextId = 4;
    state.board = {...first.board,members:[...first.board.members,...first.draft.members],
      connections:[...first.board.connections,...first.draft.connections],joints:turnJoints(first)};
    const before = structuredClone(state.board);
    const second = accept(stageElement(state,frame.id,"5,5,1","5,9,1",{quarter:2,target:"5,7,1"}));
    const joined = accept(stageConnection(second,fixed[1].id,4,"q2"));
    expect(joined.board).toEqual(before);
    expect(joined.draft.connections).toMatchObject([{memberId:4,end:"q2",jointId:"5,7,1"}]);
    expect(stageElement(state,frame.id,"5,5,1","5,9,1").ok).toBe(false);
  });

  it("requires one compatible fixed card and protects each fitted source", () => {
    const placed = accept(stageElement(fixture(frame, fixed[0], fixed[1], partial), frame.id,
      "4,7,1", "8,7,1", {quarter:1,target:"5,7,1"}));
    expect(stageConnection(placed, partial.id, 3, "q1", undefined, "lock-xy")).toMatchObject({
      ok:false, reason:expect.stringMatching(/Fixed connector/),
    });
    expect(stageConnection(placed, fixed[0].id, 3, "q2", "6,7,1")).toMatchObject({
      ok:false, reason:expect.stringMatching(/declared/),
    });
    const attached = accept(stageConnection(placed, fixed[0].id, 3, "q1"));
    expect(stageConnection(attached, fixed[1].id, 3, "q1")).toMatchObject({
      ok:false, reason:expect.stringMatching(/immutable/),
    });
    expect(connectionLocations(attached.board.members, attached.draft.members[0], "q2")).toEqual([]);
  });

  it("does not turn axial elements into moment-carrying cantilevers", () => {
    for (const type of ["cable", "spring"] as const) {
      const card = cards.find(c => c.kind === "element" && c.type === type)!;
      expect(stageElement(fixture(card), card.id, "4,7,1", "8,7,1", {quarter:1,target:"5,7,1"})).toMatchObject({
        ok:false, reason:expect.stringMatching(/continuous frame sections/),
      });
    }
  });

  it("resolves source-port aliases through existing quarters and keeps setup load exclusions", () => {
    let placed = accept(stageElement(fixture(frame, fixed[0], load), frame.id,
      "4,7,1", "8,7,1", {quarter:1,target:"5,7,1"}));
    expect(loadTargets(placed).map(t => t.id)).toContain("port:3:1");
    const loaded = accept(stageLoad(placed, load.id, "port:3:1"));
    expect(stageConnection(loaded, fixed[0].id, 3, "q1")).toMatchObject({
      ok:false, reason:expect.stringMatching(/excluded setup/),
    });
    placed = accept(stageConnection(placed, fixed[0].id, 3, "q1"));
    expect(loadTargets(placed).map(t => t.id)).not.toContain("port:3:1");
    expect(stageLoad(placed, load.id, "port:3:1").ok).toBe(false);
    // Explicit chains resolve by identity; a nearby loose tip remains separate.
    placed.board.connections.push({memberId:9,end:"q2",jointId:"port:3:1",profile:"fixed",owner:"player-2"});
    expect(analysisLoadJoint(placed,"port:9:2")).toBe("5,7,1");
    expect(analysisLoadJoint(placed,"endpoint:9:a")).toBe("endpoint:9:a");
  });

  it("replays real dealt drafts, rejects forged stations and keeps v1 mechanics unchanged", () => {
    let state = createTurnGame(0, CANTILEVER_CATALOGUE);
    while (!activeTurnHand(state).some(c => c.kind === "element" && c.type === "heb"))
      state = createTurnGame(state.seed+1, CANTILEVER_CATALOGUE);
    const card = activeTurnHand(state).find(c => c.kind === "element" && c.type === "heb")!;
    const placed = accept(stageElement(state, card.id, "4,7,1", "8,7,1", {quarter:1,target:"5,7,1"}));
    expect(parseTurnState(JSON.parse(JSON.stringify(placed)))).toEqual(placed);
    const forged = structuredClone(placed);
    forged.draft.members[0].interiorTargets = {q2:"5,7,1"};
    expect(parseTurnState(forged)).toBeNull();
    expect(parseTurnState({...placed, catalogue:RELEASE_CATALOGUE})).toBeNull();
    const old = createTurnGame(state.seed, RELEASE_CATALOGUE);
    expect(parseTurnState(JSON.parse(JSON.stringify(old)))).toEqual(old);
    expect(stageElement(old,card.id,"4,7,1","8,7,1",{quarter:1,target:"5,7,1"})).toMatchObject({
      ok:false,reason:expect.stringMatching(/cantilever-enabled/),
    });
    const invalidEvent = {...placed, events:[{kind:"element",cardId:card.id,a:"4,7,1",b:"8,7,1",contact:{quarter:4,target:"5,7,1"}}]};
    expect(parseTurnState(invalidEvent)).toBeNull();
  });
});
