import { describe, expect, it } from "vitest";
import { analyzeTurn } from "./turnAnalysis";
import { createTurnGame } from "./turns";
import { displacementAt } from "../evaluator/results";
import { ITEMS } from "../evaluator/sections";

describe.each(["shs", "chs", "ipe", "heb", "glulam"] as const)("continuous %s frame quarter-port force transfer", type => {
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
    // Timoshenko beam: bending plus shear over the loaded length (the Rust
    // solver uses the card's shear area). Beyond the load the section only
    // rotates, so the shear part is a constant offset at the tip. The
    // analysis is geometrically nonlinear: it departs from the linear closed
    // form by a fraction of order (δ/x)², which reaches about 2 % for the
    // slender hollow sections loaded 6 m out (δ ≈ 0.5 m).
    const shear = 5 * x / (ITEMS[type].G * ITEMS[type].Avz);
    const linearPort = 5 * x ** 3 / (3 * EI) + shear;
    const tolerance = 1e-4 + 3 * (linearPort / x) ** 2;
    const atPort = displacementAt(combo, active(port))!;
    const atTip = displacementAt(combo, active("endpoint:1:b"))!;
    const near = (actual: number, expected: number) => expect(Math.abs(actual / expected - 1)).toBeLessThan(tolerance);
    near(atPort[2], -linearPort);
    near(atTip[2], -(5 * x ** 2 * (3 * span - x) / (6 * EI) + shear));
    expect(combo.reac![active("0,0,0")][2]).toBeCloseTo(5, 8);
    near(Math.abs(combo.reac![active("0,0,0")][4]), 5 * x);
  });
});
