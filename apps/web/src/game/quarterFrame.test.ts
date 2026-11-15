import { describe, expect, it } from "vitest";
import { analyzeTurn } from "./turnAnalysis";
import { createTurnGame } from "./turns";
import { displacementAt } from "../solver/voxelResults";
import { ITEMS } from "../solver/voxelSections";

describe.each(["shs", "ipe", "heb", "glulam"] as const)("continuous %s frame quarter-port force transfer", type => {
  it.each([1, 2, 3])("matches cantilever bending and reactions at original quarter %i", q => {
    // The unloaded free-ended branch follows the port without adding a support.
    // For the 8 m cantilever on global X the point-load solution is closed form.
    const state = createTurnGame(5);
    const port = `port:1:${q}`, parentTip = "4,0,0", at = `${q},0,0`;
    state.board = {
      members: [
        { id: 1, type, a: "0,0,0", b: parentTip, owner: "player-1" },
        { id: 2, type: "shs", a: at, b: `${q},1,0`, owner: "player-2" },
      ],
      joints: [{ id: "0,0,0", foundationOwner: "player-1" }, { id: port, point: at }],
      connections: [
        { memberId: 1, end: "a", profile: "fixed", owner: "player-1", jointId: "0,0,0" },
        { memberId: 2, end: "a", profile: "fixed", owner: "player-2", jointId: port },
      ],
      loads: [{ owner: "player-2", cardId: "load-fixture", jointId: port, magnitude: 5 }],
    };
    const result = analyzeTurn(state, "card-gravity");
    const ctx = result.ctx!, combo = result.combos[0];
    const active = (key: string) => ctx.aid[ctx.idx.get(key)!];
    const span = 8, x = 2 * q, EI = ITEMS[type].E * ITEMS[type].Iy;
    const atPort = displacementAt(combo, active(port))!;
    const atTip = displacementAt(combo, active("endpoint:1:b"))!;
    expect(atPort[2]).toBeCloseTo(-5 * x ** 3 / (3 * EI), 8);
    expect(atTip[2]).toBeCloseTo(-5 * x ** 2 * (3 * span - x) / (6 * EI), 8);
    expect(combo.reac![active("0,0,0")][2]).toBeCloseTo(5, 8);
    expect(Math.abs(combo.reac![active("0,0,0")][4])).toBeCloseTo(5 * x, 8);
  });
});
