import { describe, expect, it } from "vitest";
import { CANTILEVER_CATALOGUE, RELEASE_CATALOGUE, createReleaseDecks } from "./cardCatalogue";
import { placementAnchorTargets, placementCandidates, placementFromTip, type ElementPlacementState } from "./cantileverPlacement";
import { createTurnGame } from "./turns";

function fixture(maxSteps = 5): ElementPlacementState {
  const turn = createTurnGame(0, CANTILEVER_CATALOGUE);
  const card = createReleaseDecks()[0].find(card => card.kind === "element" && card.type === "heb" && card.maxSteps === maxSteps)!;
  turn.players[0].hand = [card];
  return {turn, selectedCardId: card.id, chainStart: "5,7,1", attachmentSite: "a", placementPlane: "horizontal"};
}

describe("Shared table pinned placement", () => {
  it("keeps ordinary end placement fast and positions the whole parent around each original station", () => {
    const state = fixture();
    expect(placementFromTip(state, [9,7,1])).toEqual({a: "5,7,1", b: "9,7,1"});
    expect(placementFromTip({...state, attachmentSite: "b"}, [1,7,1])).toEqual({a: "1,7,1", b: "5,7,1"});
    for (const [site, point, a] of [["q1", [8,7,1], "4,7,1"], ["q2", [7,7,1], "3,7,1"], ["q3", [6,7,1], "2,7,1"]] as const) {
      expect(placementFromTip({...state, attachmentSite: site}, [...point])).toEqual({
        a, b: point.join(","), contact: {quarter: Number(site.slice(1)), target: "5,7,1"},
      });
    }
  });

  it("rejects off-grid tips, whole-span overruns and geometry outside either side of the board", () => {
    const state = {...fixture(), attachmentSite: "q1" as const};
    expect(placementFromTip(state, [7,7,1])).toEqual({issue: expect.stringMatching(/grid/)});
    expect(placementFromTip(state, [11,7,1])).toEqual({issue: expect.any(String)});
    state.turn!.board.joints.push({id: "0,0,1"});
    expect(placementFromTip({...state, chainStart: "0,0,1"}, [3,0,1])).toEqual({issue: expect.any(String)});
  });

  it("offers exact legal free destinations on a stable chosen plane", () => {
    const state = {...fixture(), attachmentSite: "q1" as const};
    const horizontal = placementCandidates(state);
    expect(horizontal.map(c => c.key)).toContain("8,7,1");
    expect(horizontal.every(c => c.point[2] === 1)).toBe(true);
    expect(horizontal.map(c => c.key)).not.toContain("7,7,1");
    expect(placementCandidates(state)).toBe(horizontal);
    const vertical = placementCandidates({...fixture(10), attachmentSite: "q1", placementPlane: "xz"});
    expect(vertical.map(c => c.key)).toContain("11,7,4");
    expect(vertical.every(c => c.point[1] === 7)).toBe(true);
  });

  it("pins an exact off-grid host port without rounding it or creating a new station", () => {
    const state = fixture(10);
    state.turn!.board.members.push({id: 4, a: "6,4,1", b: "8,6,1", type: "heb", owner: "player-2"});
    state.turn!.nextId = 5;
    expect(placementAnchorTargets(state.turn!).find(t => t.id === "port:4:1")?.point).toEqual([6.5,4.5,1]);
    expect(placementFromTip({...state, chainStart: "port:4:1", attachmentSite: "q2"}, [8,3,1])).toEqual({
      a: "5,6,1", b: "8,3,1", contact: {quarter: 2, target: "port:4:1"},
    });
  });

  it("does not offer new interior mechanics to historical matches, axial cards or arbitrary grid anchors", () => {
    const old = {...fixture(), attachmentSite: "q1" as const};
    old.turn!.catalogue = RELEASE_CATALOGUE;
    expect(placementFromTip(old, [8,7,1])).toEqual({issue: expect.stringMatching(/new Shared table/)});
    const free = {...fixture(), attachmentSite: "q1" as const, chainStart: "4,4,1"};
    expect(placementFromTip(free, [7,4,1])).toEqual({issue: expect.stringMatching(/existing joint/)});
    const axial = {...fixture(), attachmentSite: "q1" as const};
    const cable = createReleaseDecks()[0].find(c => c.kind === "element" && c.type === "cable")!;
    axial.turn!.players[0].hand = [cable]; axial.selectedCardId = cable.id;
    expect(placementFromTip(axial, [8,7,1])).toEqual({issue: expect.stringMatching(/frame beams/)});
  });

  it("retains the identity of a unique original port at the derived other tip", () => {
    const state = fixture();
    state.turn!.board.members.push(
      {id: 4, a: "4,6,1", b: "6,10,1", type: "heb", owner: "player-2"},
      {id: 5, a: "6,6,1", b: "8,10,1", type: "heb", owner: "player-2"},
    );
    state.turn!.nextId = 6;
    expect(placementFromTip({...state, attachmentSite: "q1"}, [6.5,7,1], "port:5:1")).toEqual({
      a: "port:4:1", b: "port:5:1", contact: {quarter: 1, target: "5,7,1"},
    });
  });

  it("does not offer analytical load-only endpoint nodes as authoring anchors", () => {
    const state = fixture();
    state.turn!.board.joints.push({id: "endpoint:9:b", point: "8,7,1"});
    expect(placementAnchorTargets(state.turn!).map(target => target.id)).not.toContain("endpoint:9:b");
    expect(placementAnchorTargets(state.turn!).map(target => target.id)).toContain("5,7,1");
  });
});
