import { describe, expect, it } from "vitest";
import { bayEdges } from "./bay";
import { bayBraceCandidates, bayFaces, cycleBayBrace } from "./bayBrace";
import { LEVELS } from "./levels";
import { nodeKey, type GameModel } from "./model";

describe("bay panel diagonals", () => {
  it("finds both diagonals on each completed face", () => {
    const members = bayEdges([0, 0, 0], [2, 2, 2]).map(([a, b], index) => ({
      a: nodeKey(...a),
      b: nodeKey(...b),
      type: "shs" as const,
      id: index + 1,
    }));
    const model: GameModel = { members, attrs: {}, nextId: 13 };
    expect(bayBraceCandidates(model, [2, 2, 2])).toHaveLength(12);
    const incomplete = { ...model, members: members.slice(1) };
    expect(bayBraceCandidates(incomplete, [2, 2, 2])).toHaveLength(8);
    const braced = {
      ...model,
      members: [
        ...members,
        { a: "0,0,0", b: "2,2,0", id: 13, type: "shs" as const },
      ],
    };
    expect(bayBraceCandidates(braced, [2, 2, 2])).toHaveLength(11);
  });
  it("cycles a face through both orientations, the cross and empty", () => {
    const members = bayEdges([0, 0, 0], [2, 2, 2]).map(([a, b], index) => ({
      a: nodeKey(...a), b: nodeKey(...b), type: "shs" as const, id: index + 1,
    }));
    let model: GameModel = { members, attrs: {}, nextId: 13 };
    const face = bayFaces(model, [2, 2, 2]).find(({ normalAxis }) => normalAxis === 2)!;
    for (const expected of [
      ["0,0,0:2,2,0"], ["2,0,0:0,2,0"],
      ["2,0,0:0,2,0", "0,0,0:2,2,0"], [],
    ]) {
      const step = cycleBayBrace(LEVELS.environment, model, face);
      if (!step.ok) throw new Error(step.reason);
      model = step.model;
      expect(model.members.slice(0, 12)).toEqual(members);
      expect(model.members.slice(12).map(({ a, b }) => a + ":" + b)).toEqual(expected);
    }
  });
});
