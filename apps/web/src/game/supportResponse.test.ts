import { displacementAt } from '../evaluator/results';
import { expect, it } from "vitest";
import { SCORED_CATALOGUE } from "./cardCatalogue";
import { awardFinalScore, finalReceipt } from "./finalScore";
import { analyzeTurn } from "./turnAnalysis";
import { createTurnGame, type TurnState } from "./turns";

function cantilever(owner: string) {
  const turn = createTurnGame(1, SCORED_CATALOGUE);
  const base = "1,1,0", tip = "2,2,1";
  turn.board = {
    joints: [{ id: base, foundationOwner: owner }, { id: tip }],
    members: [{ id: 1, type: "heb", a: base, b: tip, owner }],
    loads: [{ cardId: "roof-gravity", jointId: tip, magnitude: 1, owner: "player-1" }],
    connections: [
      { memberId: 1, end: "a", profile: "fixed", jointId: base, owner },
      { memberId: 1, end: "b", profile: "ball", jointId: tip, owner },
    ],
  };
  return { turn, base, tip };
}

it.each(["player-1", "neutral"])("returns six signed ground reactions traced to %s", owner => {
  const { turn, base, tip } = cantilever(owner);
  const analysis = analyzeTurn(turn, "card-gravity");
  const ctx = analysis.ctx!;
  const node = (id: string) => ctx.aid[ctx.idx.get(id)!];
  const combo = analysis.combos[0];
  expect(combo.components![0].verification?.status).toBe("verified-nonlinear");
  // The fully fixed foundation does not move at all.
  expect(Array.from(displacementAt(combo, node(base))!)).toEqual(Array(6).fill(0));
  expect(combo.reac![node(tip)]).toBeUndefined();
  // One kN downward, two metres from the support in both horizontal axes.
  // Nonlinear: the deflected tip (about 0.1 mm) shifts the moment arms.
  const expected = [0, 0, 1, 2, -2, 0];
  Array.from(combo.reac![node(base)]).forEach((value, i) => expect(Math.abs(value - expected[i])).toBeLessThan(1e-3));
  expect(combo.reac![node(base)].length).toBe(6);
  const score = awardFinalScore(turn, finalReceipt(turn, analysis));
  expect(score.neutralShare).toBeCloseTo(owner === "neutral" ? 100 : 0, 8);
  expect(score.awards[0].awardedShare).toBeCloseTo(owner === "player-1" ? 100 : 0, 8);
});

it("distinguishes inactive end spins from a genuine unloaded sway mechanism", () => {
  const { turn, tip } = cantilever("player-1");
  turn.board.loads = [];
  const response = (state: TurnState) => analyzeTurn(state, "card-gravity");
  // The ball tip's rotations are held by nothing, but turning them moves
  // nothing either: an inactive spin, not a mechanism.
  const stable = response(turn);
  expect(stable.combos[0].components![0].status).toBe("computed");
  expect(stable.combos[0].components![0].verification?.status).toBe("verified-nonlinear");
  expect(stable.mechanism).toBe(false);
  void tip;
  turn.board.connections[0].profile = "ball";
  const mechanism = response(turn).combos[0];
  expect(mechanism.components![0].status).toBe("mechanism");
  expect(Object.keys(mechanism.reac ?? {})).toHaveLength(0);
});
