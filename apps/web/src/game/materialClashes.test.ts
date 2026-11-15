import { describe, expect, it } from "vitest";
import type { Member } from "./model";
import { findMaterialClash } from "./materialClashes";
import { SCORED_CATALOGUE } from "./cardCatalogue";
import { activeTurnHand, createTurnGame, endTurn, parseTurnState, stageElement } from "./turns";

function piece(id: number, a: string, b: string, type: Member["type"] = "shs"): Member {
  return { id, a, b, type };
}

describe("undeformed section material in the scored frame preset", () => {
  it("separates coplanar material crossings from depth-separated projections and skew spans", () => {
    const a = piece(3, "1,1,1", "3,3,1");
    expect(findMaterialClash(piece(4, "1,3,1", "3,1,1"), [a])).toMatch(/member 3/i);
    expect(findMaterialClash(piece(4, "1,3,2", "3,1,2"), [a])).toBeNull();
    expect(findMaterialClash(piece(4, "1,3,3", "3,1,1"), [a])).toBeNull();
    expect(findMaterialClash(piece(4, "3,1,1", "1,3,1"), [piece(3, a.b, a.a)])).toMatch(/member 3/i);
  });

  it("preserves an SHS bore and wide-flange void while detecting their actual walls and web", () => {
    const reference = piece(1, "0,0,1", "3,0,1");
    const wire = (y: string) => piece(2, `0.2,${y},1`, `2.8,${y},1`, "cable");
    expect(findMaterialClash(wire("0"), [reference])).toBeNull();
    expect(findMaterialClash(wire("0.025"), [reference])).toMatch(/shs/);
    const wide = { ...reference, type: "ipe" as const };
    expect(findMaterialClash(wire("0.02"), [wide])).toBeNull();
    expect(findMaterialClash(wire("0"), [wide])).toMatch(/ipe/);
  });

  it("accepts touching and rejects positive penetration beyond the one-micron tolerance", () => {
    const a = piece(1, "0,0,1", "3,0,1", "glulam");
    const parallel = (y: string) => piece(2, `1,${y},1`, `2,${y},1`, "glulam");
    expect(findMaterialClash(parallel("0.1"), [a])).toBeNull();
    expect(findMaterialClash(parallel("0.0999998"), [a])).toBeNull();
    expect(findMaterialClash(parallel("0.099999"), [a])).toMatch(/member 1/);
  });

  it("only admits local fitting overlap at an end or deliberately named original port", () => {
    const parent = piece(1, "0,1,1", "4,1,1", "glulam");
    const mid = piece(2, "2,1,1", "2,2,1");
    expect(findMaterialClash(mid, [parent])).toMatch(/member 1/);
    expect(findMaterialClash({ ...mid, endTargets: { a: "port:1:2" } }, [parent])).toBeNull();
    expect(findMaterialClash({ ...mid, endTargets: { a: "port:1:1" } }, [parent])).toMatch(/member 1/);
    expect(findMaterialClash(piece(2, "0,1,1", "0,2,1"), [parent])).toBeNull();
    expect(findMaterialClash(piece(2, "0,1,1", "3,1,1"), [parent])).toMatch(/member 1/);
    const overlapping = { ...piece(2, "2,1,1", "3,1,1", "glulam"), endTargets: { a: "port:1:2" } };
    expect(findMaterialClash(parent, [overlapping])).toMatch(/member 2/);
    expect(findMaterialClash(overlapping, [parent])).toMatch(/member 1/);
  });

  it("checks every incoming branch against the parent and earlier branches at the same fitting", () => {
    const parent = piece(1, "0,1,1", "4,1,1");
    const fitting = { a: "port:1:2" };
    const branch = { ...piece(2, "2,1,1", "2,2,1"), endTargets: fitting };
    const other = { ...piece(3, "2,1,1", "2,1,2"), endTargets: fitting };
    expect(findMaterialClash(other, [parent, branch])).toBeNull();
    expect(findMaterialClash({ ...branch, id: 4, b: "2,3,1" }, [parent, other, branch])).toMatch(/member 2/);
  });

  it("allows a declared new quarter collar symmetrically and still rejects material outside its fitting", () => {
    const column = piece(1, "5,7,0", "5,7,1", "heb");
    const beam = { ...piece(3,"4,7,1","8,7,1","heb"), interiorTargets:{q1:"5,7,1"} };
    expect(findMaterialClash(beam,[column])).toBeNull();
    expect(findMaterialClash(column,[beam])).toBeNull();
    expect(findMaterialClash({...beam,interiorTargets:{q2:"5,7,1"}},[column])).toMatch(/intersect/);
    const crossing = piece(2,"5,5,1","5,9,1","heb");
    expect(findMaterialClash(beam,[crossing])).toMatch(/intersect/);
    const declared = {...beam,interiorTargets:{q1:"port:2:2"}};
    expect(findMaterialClash(declared,[crossing])).toBeNull();
    const overlap = {...piece(4,"4,7,1","8,7,1","heb"),interiorTargets:{q1:"5,7,1"}};
    expect(findMaterialClash(overlap,[piece(5,"5,7,1","9,7,1","heb")])).toMatch(/intersect/);
  });

  it("rejects the seed-0 crossing without spending a card or changing replay history", () => {
    const first = createTurnGame(0, SCORED_CATALOGUE);
    const card = activeTurnHand(first).find(c => c.kind === "element" && c.maxSteps >= 2)!;
    const stage = stageElement(first, card.id, "1,1,1", "3,3,1");
    if (!stage.ok) throw Error(stage.reason);
    const advance = endTurn(stage.state);
    if (!advance.ok) throw Error(advance.reason);
    let second = advance.state;
    const longCard = (turn: typeof second) => activeTurnHand(turn).find(c => c.kind === "element" && c.maxSteps >= 2);
    while (!longCard(second) && !second.finished) {
      const passed = endTurn(second);
      if (!passed.ok) throw Error(passed.reason);
      second = passed.state;
    }
    const incoming = longCard(second);
    if (!incoming) throw Error("Fixture exhausted the scored deck");
    const before = structuredClone(second);
    const crossing = new RegExp('member ' + second.nextId + '.*member 3', 'i');
    expect(stageElement(second, incoming.id, "1,3,1", "3,1,1")).toMatchObject({
      ok: false, reason: expect.stringMatching(crossing),
    });
    expect(second).toEqual(before);
    expect(parseTurnState(second)).toEqual(second);
    const clear = stageElement(second, incoming.id, "1,3,2", "3,1,2");
    if (!clear.ok) throw Error(clear.reason);
    const stale = structuredClone(clear.state);
    Object.assign(stale.draft.members[0], { a: "1,3,1", b: "3,1,1" });
    expect(endTurn(stale)).toMatchObject({ ok: false, reason: expect.stringMatching(crossing) });
    expect(endTurn(clear.state).ok).toBe(true);
  });
});
