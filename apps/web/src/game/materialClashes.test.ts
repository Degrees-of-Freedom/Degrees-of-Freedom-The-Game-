import { describe, expect, it } from "vitest";
import type { Member } from "./model";
import { findMaterialClash } from "./materialClashes";
import { SCORED_CATALOGUE } from "./cardCatalogue";
import { activeTurnHand, createTurnGame, endTurn, parseTurnState, stageElement } from "./turns";
import { createReleaseGame, chooseTurnDraw } from './turns';
import { toTurnVoxelInput } from './turnAnalysis';

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

describe('intentional original-port contacts in revised Shared table', () => {
  const parent = piece(1, '0,2,1', '8,2,1', 'heb');
  const check = (candidate: Parameters<typeof findMaterialClash>[0], existing: Parameters<typeof findMaterialClash>[0] = parent) =>
    findMaterialClash(candidate, [existing], undefined, true);

  it('admits perpendicular, diagonal and shallow-angle HEB joints with their real section widths', () => {
    for (const [port, a, b] of [
      ['port:1:1', '2,2,1', '2,4,1'],
      ['port:1:2', '4,2,1', '6,4,1'],
      ['port:1:3', '6,2,1', '8,3,1'],
      ['port:1:2', '4,2,1', '8,3,1'],
      ['port:1:2', '4,2,1', '4,3,2'],
    ]) {
      const candidate = {...piece(2, a, b, 'heb'), endTargets: {a: port}};
      expect(check(candidate), `${a} to ${b}`).toBeNull();
      expect(findMaterialClash(parent, [candidate], undefined, true)).toBeNull();
    }
    const shallow = {...piece(2, '4,2,1', '8,3,1', 'heb'), endTargets: {a: 'port:1:2'}};
    expect(findMaterialClash(shallow, [parent])).toMatch(/intersect material/);
  });

  it('accepts a typed endpoint at a real quarter but rejects incorrect selected identities, full overlap and interior crossings', () => {
    expect(check(piece(2, '4,2,1', '6,4,1', 'heb'))).toBeNull();
    expect(check({...piece(2, '4,2,1', '6,4,1', 'heb'), endTargets: {a: 'port:1:1'}})).toMatch(/member 1/);
    expect(check({...piece(2, '4,2,1', '7,2,1', 'heb'), endTargets: {a: 'port:1:2'}})).toMatch(/member 1/);
    expect(check(piece(2, '4,0,1', '4,4,1', 'heb'))).toMatch(/member 1/);
    expect(check(piece(2, '1,2,1', '1,4,1', 'heb'))).toMatch(/member 1/);
    expect(check(piece(2, '4,2,1', '6,4,1', 'heb'), {...parent, owner: 'neutral'})).toMatch(/member 1/);
  });

  it('stages a deliberate diagonal T contact without spending a connector or inventing connectivity', () => {
    let turn = createReleaseGame(0);
    for (let i = 0; i < 4; i++) {
      const draw = chooseTurnDraw(turn, 'members');
      if (!draw.ok) throw new Error(draw.reason);
      turn = draw.state;
    }
    const cards = activeTurnHand(turn).filter(card => card.kind === 'element');
    const first = stageElement(turn, cards[0].id, '2,2,1', '6,2,1');
    if (!first.ok) throw new Error(first.reason);
    const second = stageElement(first.state, cards[1].id, 'port:3:2', '6,3,1');
    expect(second.ok, second.ok ? '' : second.reason).toBe(true);
    if (!second.ok) throw new Error(second.reason);
    expect(second.state.draft.members[1].endTargets).toEqual({a: 'port:3:2'});
    expect(second.state.draft.connections).toEqual([]);
    const input = toTurnVoxelInput(second.state);
    expect(input.members.find(member => member.id === 4)?.a).toBe('endpoint:4:a');
    const typed = stageElement(first.state, cards[1].id, '4,2,1', '6,3,1');
    if (!typed.ok) throw new Error(typed.reason);
    expect(typed.state.draft.members[1].endTargets).toEqual({a: 'port:3:2'});
    expect(toTurnVoxelInput(typed.state).members.find(member => member.id === 4)?.a).toBe('endpoint:4:a');
    const held = activeTurnHand(first.state).map(card => card.id);
    const rejected = stageElement(first.state, cards[1].id, '4,0,1', '4,4,1');
    expect(rejected).toMatchObject({ok: false, reason: expect.stringMatching(/intersect material/)});
    expect(activeTurnHand(first.state).map(card => card.id)).toEqual(held);
    expect(first.state.draft.members).toHaveLength(1);
  });
});
