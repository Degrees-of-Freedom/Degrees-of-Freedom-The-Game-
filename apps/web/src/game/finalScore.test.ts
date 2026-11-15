import { describe, expect, it } from "vitest";
import { SCORED_CATALOGUE } from "./cardCatalogue";
import { awardFinalScore, finalReceipt, recoverFinalScore } from "./finalScore";
import { analyzeTurn } from "./turnAnalysis";
import { createTurnGame, endTurn, parseTurnState, stageLoad, type TurnState } from "./turns";

function accepted(action: ReturnType<typeof endTurn>) {
  if (!action.ok) throw Error(action.reason);
  return action.state;
}

function finalState(weights: number[], third?: "neutral" | "floating") {
  const t = createTurnGame(23, SCORED_CATALOGUE);
  t.turn = 16;
  if (third) t.board.joints.push({id: "3,5,0", foundationOwner: third === "neutral" ? "neutral" : undefined});
  // Direct support loads have known exact vertical reactions; the floating
  // third joint has no reaction field but carries part of the applied load.
  t.board.loads = weights.map((magnitude, i) => ({ magnitude, cardId: "fixture-" + i,
    jointId: ["1,3,0","5,3,0","3,5,0"][i], owner: "player-1" }));
  return t;
}

function score(t: TurnState) {
  const result = analyzeTurn(t, "card-gravity");
  return awardFinalScore(t, finalReceipt(t, result));
}

describe("final signed foundation share", () => {
  it("subtracts historical events once and never accumulates preview share", () => {
    const t = finalState([60,40]);
    t.reports = [1,3].map(turn => ({turn, playerId:"player-1", status:"stable", reason:"Recovered", penalty:-1}));
    const s = score(t);
    expect(s.awards.map(a => [a.awardedShare,a.penaltyPoints,a.finalScore])).toEqual([[60,2,58],[40,0,40]]);
    expect(t.players.map(p => p.score)).toEqual([0,0]);
    expect(recoverFinalScore(t,s)).toEqual(s);
    expect(recoverFinalScore(t,{ ...s, winners:["player-2"] })).toBeNull();
  });

  it.each(["neutral", "floating"] as const)("distinguishes %s scope while retaining W=100", third => {
    const t = finalState([30,20,50], third);
    const s = score(t);
    expect(s.totalGravityKN).toBe(100);
    expect(s.awards.map(a => a.finalScore)).toEqual([30,20]);
    expect(s.unknownGravityKN).toBe(third === "floating" ? 50 : 0);
    expect(s.neutralShare).toBe(third === "neutral" ? 50 : 0);
    expect(s.partial).toBe(third === "floating");
    expect(s.receipt.components.flatMap(c => c.foundations).find(f => f.jointId === "3,5,0")?.upwardKN)
      .toBe(third === "neutral" ? 50 : undefined);
    expect(recoverFinalScore(t,s)).toEqual(s);
  });

  it("withholds a finite reaction from an unverified component and records unavailable support forces", () => {
    const t = finalState([30,20,50], "neutral");
    const result = analyzeTurn(t, "card-gravity");
    const scope = result.combos[0].components!.find(c => c.nodes.includes("3,5,0"))!;
    scope.verification = { formulation:"voxel-linear-frame-v1", status:"unverified", reason:"Nonlinear check pending." };
    const s = awardFinalScore(t, finalReceipt(t, result));
    expect(s.awards.map(a => a.finalScore)).toEqual([30,20]);
    expect(s.receipt.components.flatMap(c => c.foundations)).toContainEqual({jointId:"3,5,0",upwardKN:null});
    expect(s).toMatchObject({neutralShare:0,unknownGravityKN:50,partial:true});
    const unavailable = awardFinalScore(t, finalReceipt(t, null));
    expect(unavailable).toMatchObject({totalGravityKN:100,unknownGravityKN:100,partial:true});
    expect(unavailable.receipt.components[0].foundations.every(f => f.upwardKN === null)).toBe(true);
  });

  it("keeps signed uplift and chooses joint winners by unrounded score", () => {
    const t = finalState([100]);
    const receipt = finalReceipt(t, analyzeTurn(t,"card-gravity"));
    // Physical equilibrium of a single combined support group with an overhang.
    receipt.components = [{nodes:t.board.joints.map(j=>j.id), memberIds:[1,2], verified:true,
      reason:"Verified linear frame response.", foundations:[
        { jointId:"1,3,0",upwardKN:-15 },{ jointId:"5,3,0",upwardKN:115 },
      ]}];
    expect(awardFinalScore(t,receipt).awards.map(a=>a.finalScore)).toEqual([-15,115]);
    for (const [first,expected] of [[50.005,2],[50.0051,1]] as const) {
      const foundations = receipt.components[0].foundations;
      foundations[0].upwardKN = first;
      foundations[1].upwardKN = 100-first;
      expect(awardFinalScore(t,receipt).winners).toHaveLength(expected);
    }
    const noLoads = score(finalState([]));
    expect(noLoads.awards.map(a=>a.finalScore)).toEqual([0,0]);
    expect(noLoads.winners).toEqual(["player-1","player-2"]);
  });

  it("records one finalized result after the sixteenth turn and validates replay", () => {
    let t = createTurnGame(23, SCORED_CATALOGUE);
    t = accepted(endTurn(t));
    t = accepted(stageLoad(t, "load-20", "1,3,1"));
    for (let i = 2; i < 16; i++) {
      t = accepted(endTurn(t));
      expect(t.finalScore).toBeUndefined();
      expect(t.players.map(p => p.score)).toEqual([0,0]);
    }
    t = accepted(endTurn(t));
    expect(t.players.map(p => p.score)).toEqual([100,0]);
    expect(t.finalScore?.totalGravityKN).toBe(5);
    expect(t.events.filter(e => e.kind === "end" && e.final)).toHaveLength(1);
    expect(endTurn(t).ok).toBe(false);
    const saved = { version:1, seed:t.seed, catalogue:t.catalogue, events:JSON.parse(JSON.stringify(t.events)) };
    expect(parseTurnState(saved)).toEqual(t);
    saved.events.at(-1).final.awards[0].finalScore = 999;
    expect(parseTurnState(saved)).toBeNull();
    delete saved.events.at(-1).final;
    expect(parseTurnState(saved)).toBeNull();
    // A historical game has no claimed award even with a recoverable load.
    expect(parseTurnState({...saved, catalogue:undefined})?.finalScore).toBeUndefined();
  });
});
