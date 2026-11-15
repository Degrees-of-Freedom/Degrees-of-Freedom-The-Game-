import { expect, it } from "vitest";
import { SCORED_CATALOGUE } from "./cardCatalogue";
import { awardFinalScore, finalReceipt } from "./finalScore";
import { analyzeTurn } from "./turnAnalysis";
import { createTurnGame } from "./turns";

/** Two identical, perpendicular fixed cantilevers share vertical displacement
 * at the main beam's 75% port. The transverse cantilever carries shear through
 * a ball. The tip overhang makes the main beam's own foundation pull down. */
it("scores signed foundation uplift from calculated quarter-connected members", () => {
  const turn = createTurnGame(1, SCORED_CATALOGUE);
  const first = "1,3,0", second = "4,2,0", tip = "5,3,0", port = "port:1:3";
  const p1 = turn.players[0].id, p2 = turn.players[1].id;
  const load = 5;
  turn.board = {
    joints: [
      { id: first, foundationOwner: p1 }, { id: second, foundationOwner: p2 },
      { id: tip }, { id: port, point: "4,3,0" },
    ],
    members: [
      { id: 1, type: "heb", a: first, b: tip, owner: p1 },
      { id: 2, type: "heb", a: second, b: "4,3,0", owner: p2, endTargets: { b: port } },
    ],
    connections: [
      { memberId: 1, end: "a", jointId: first, profile: "fixed", owner: p1 },
      { memberId: 1, end: "b", jointId: tip, profile: "fixed", owner: p1 },
      { memberId: 2, end: "a", jointId: second, profile: "fixed", owner: p2 },
      { memberId: 2, end: "b", jointId: port, profile: "ball", owner: p2 },
    ],
    loads: [{ cardId: "load-fixture", magnitude: load, owner: p1, jointId: tip }],
  };
  const analysis = analyzeTurn(turn, "card-gravity");
  const receipt = finalReceipt(turn, analysis);
  const score = awardFinalScore(turn, receipt);
  expect(score.partial).toBe(false);
  expect(score.totalGravityKN).toBe(load);
  // P*a²(3L-a)/(6EI) = R*[a³/(3EI) + b³/(3EI)] in metres.
  const length = 8, station = 6, branch = 2;
  const secondaryShare = station**2 * (3*length - station) / (2 * (station**3 + branch**3));
  const reactions = receipt.components.flatMap(component => component.foundations);
  expect(reactions.find(r => r.jointId === first)?.upwardKN).toBeCloseTo(load * (1-secondaryShare), 8);
  expect(reactions.find(r => r.jointId === second)?.upwardKN).toBeCloseTo(load * secondaryShare, 8);
  expect(score.awards[0].awardedShare).toBeCloseTo(100 * (1-secondaryShare), 7);
  expect(score.awards[1].awardedShare).toBeCloseTo(100 * secondaryShare, 7);
});
