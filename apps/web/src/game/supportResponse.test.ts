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
  expect(combo.components![0].verification?.status).toBe("verified-linear");
  expect(Array.from(ctx.eq.slice(6 * node(base), 6 * node(base) + 6))).toEqual(Array(6).fill(-1));
  expect(combo.reac![node(tip)]).toBeUndefined();
  // One kN downward, two metres from the support in both horizontal axes.
  const expected = [0, 0, 1, 2, -2, 0];
  Array.from(combo.reac![node(base)]).forEach((value, i) => expect(value).toBeCloseTo(expected[i], 9));
  expect(combo.reac![node(base)].length).toBe(6);
  const score = awardFinalScore(turn, finalReceipt(turn, analysis));
  expect(score.neutralShare).toBeCloseTo(owner === "neutral" ? 100 : 0, 8);
  expect(score.awards[0].awardedShare).toBeCloseTo(owner === "player-1" ? 100 : 0, 8);
});

it("distinguishes inactive end spins from a genuine unloaded sway mechanism", () => {
  const { turn, tip } = cantilever("player-1");
  turn.board.loads = [];
  const response = (state: TurnState) => analyzeTurn(state, "card-gravity");
  const stable = response(turn);
  const ctx = stable.ctx!;
  const start = 6 * ctx.aid[ctx.idx.get(tip)!];
  expect(Array.from(ctx.eq.slice(start, start + 3)).every(i => i >= 0)).toBe(true);
  expect(Array.from(ctx.eq.slice(start + 3, start + 6))).toEqual([-1, -1, -1]);
  expect(stable.combos[0].components![0].verification?.status).toBe("verified-linear");
  turn.board.connections[0].profile = "ball";
  const mechanism = response(turn).combos[0];
  expect(mechanism.components![0].status).toBe("mechanism");
  expect(mechanism.reac).toBeUndefined();
});
