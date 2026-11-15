import { afterAll, describe, expect, it, vi } from "vitest";
import { analyzeGame } from "./analysis";
import { environmentExample } from "./environmentExamples";
import { exampleModel } from "./examples";
import { LEVELS } from "./levels";
import { modeSetup, type GameMode } from "./modes";
import { useGameStore } from "./store";
import { analyzeTurn } from "./turnAnalysis";
import { createTurnGame } from "./turns";
import { unavailableSolver } from "../solver/unavailable";

// The multiplayer store now waits for a real write acknowledgement.
vi.hoisted(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value) });
});
afterAll(() => vi.unstubAllGlobals());

describe("simulation across game modes", () => {
  it.each(["creative", "challenge", "forensics", "load-space", "multiplayer"] as const)(
    "runs the %s mode through numerical analysis",
    async (mode: GameMode) => {
      const { levelId, model } = modeSetup(mode);
      // The challenge and pickup start without a load-bearing structure.
      const structure = mode === "challenge" || mode === "load-space" ? exampleModel(levelId) : model;
      if (!structure) throw new Error("Expected a solvable reference fixture");
      const result = mode === "multiplayer" ? analyzeTurn(createTurnGame()) : await analyzeGame(structure, LEVELS[levelId]);
      expect(result.error).toBeUndefined();
      expect(result.combos.length).toBeGreaterThan(0);
      expect(result.combos.some((combo) => combo.u && combo.reac)).toBe(true);
      expect(result.floating.length > 0).toBe(mode === "forensics");
    },
  );

  it.each(["tower", "portal"] as const)("balances Grow Dusk %s lateral and gravity loads", async (kind) => {
    const model = environmentExample(kind);
    if (kind === "portal") {
      const pinned = await analyzeGame(model, LEVELS.environment);
      expect(pinned.error).toBeUndefined();
      expect(pinned.mechanism).toBe(true);
      expect(pinned.combos[0].fail).toBe(true);
      // The pinned planar portal can rotate out of plane about its base line.
      // Lock one base to exercise load balance on the repaired portal.
      model.attrs["3,4,0"].restraint = [true, true, true, true, true, true];
    }
    const result = await analyzeGame(model, LEVELS.environment);
    expect(result.error).toBeUndefined();
    expect(result.mechanism).toBe(false);
    expect(result.floating).toEqual([]);
    const combo = result.combos[0];
    if (!combo?.u || !combo.reac || !combo.ef) throw new Error("Expected solved displacements, reactions and member forces");
    expect(combo.vis.some(({ v }) => v[0] > 0)).toBe(true);
    expect(combo.vis.some(({ v }) => v[2] < 0)).toBe(true);
    for (let axis = 0; axis < 3; axis++) {
      let applied = 0;
      for (let i = axis; i < combo.F.length; i += 6) applied += combo.F[i];
      const reaction = Object.values(combo.reac).reduce((sum, value) => sum + value[axis], 0);
      expect(reaction + applied).toBeCloseTo(0, 7);
    }
    expect([...combo.u].every(Number.isFinite)).toBe(true);
  });

  it("records the end-turn simulation result before advancing the active player", async () => {
    const initial = useGameStore.getState();
    try {
      useGameStore.setState({ mode: "multiplayer", turn: createTurnGame(), turnSolver: unavailableSolver });
      expect(await useGameStore.getState().endTurn()).toBeNull();
      expect(useGameStore.getState().turn).toMatchObject({
        turn: 2,
        playerIndex: 1,
        reports: [{
          turn: 1, status: "stable", penalty: 0,
          analysis: {
            purpose: "turn",
            request: { snapshot: { revisionId: "turn-1" } },
            foundations: [
              { reaction: { validity: "unverified" } },
              { reaction: { validity: "unverified" } },
            ],
          },
        }],
      });
    } finally {
      useGameStore.setState(initial);
    }
  });
});
