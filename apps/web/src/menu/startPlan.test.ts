import { afterEach, describe, expect, it, vi } from "vitest";
import { planStart, runStart, type StartActions } from "./startPlan";
import { CANTILEVER_CATALOGUE, SCORED_CATALOGUE } from "../game/cardCatalogue";

function recorder(overrides: Partial<StartActions> = {}) {
  const calls: string[] = [];
  const actions: StartActions = {
    setStyle: (style) => void calls.push(`setStyle:${style}`),
    setMode: (mode) => void calls.push(`setMode:${mode}`),
    setLevel: (id) => void calls.push(`setLevel:${id}`),
    reset: () => void calls.push("reset"),
    newMatch: () => {
      calls.push("newMatch");
      return null;
    },
    importModel: () => {
      calls.push("importModel");
      return null;
    },
    ...overrides,
  };
  return { calls, actions };
}

describe("setup to store-call mapping", () => {
  it("always sets the Grow Dusk style before the mode", () => {
    const { calls, actions } = recorder();
    expect(runStart({ mode: "forensics", begin: "continue" }, actions)).toBeNull();
    expect(calls).toEqual(["setStyle:grow-dusk", "setMode:forensics"]);
  });

  it("applies the challenge level after the mode so it sticks", () => {
    expect(
      planStart({ mode: "challenge", levelId: "bridge1", begin: "continue" }).map(
        (step) => step.do,
      ),
    ).toEqual(["setStyle", "setMode", "setLevel"]);
    const { calls, actions } = recorder();
    runStart({ mode: "challenge", levelId: "bridge1", begin: "fresh" }, actions);
    expect(calls.slice(-3)).toEqual(["setMode:challenge", "setLevel:bridge1", "reset"]);
  });

  it("maps creative starting points", () => {
    const run = (begin: "continue" | "example" | "empty") => {
      const { calls, actions } = recorder();
      runStart({ mode: "creative", begin }, actions);
      return calls.slice(2);
    };
    expect(run("continue")).toEqual([]);
    expect(run("example")).toEqual(["importModel"]);
    expect(run("empty")).toEqual(["reset"]);
  });

  it("starts a new Shared table match only when asked", () => {
    expect(planStart({ mode: "multiplayer", begin: "continue" })).toHaveLength(2);
    const { calls, actions } = recorder();
    runStart({ mode: "multiplayer", begin: "new" }, actions);
    expect(calls).toEqual(["setStyle:grow-dusk", "setMode:multiplayer", "newMatch"]);
  });

  it("stops and reports the first store error", () => {
    const { calls, actions } = recorder({ newMatch: () => "Finish the match first" });
    expect(runStart({ mode: "multiplayer", begin: "new" }, actions)).toBe(
      "Finish the match first",
    );
    expect(calls).toHaveLength(2);
  });
});

describe("against the real store", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });
  async function freshStore() {
    const entries = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
    });
    vi.resetModules();
    const { useGameStore } = await import("../game/store");
    const start = await import("./startPlan");
    return { store: useGameStore, ...start };
  }

  it("keeps the chosen challenge level and the Grow Dusk style", async () => {
    const { store, runStart } = await freshStore();
    expect(
      runStart(
        { mode: "challenge", levelId: "bridge2", begin: "continue" },
        store.getState(),
      ),
    ).toBeNull();
    expect(store.getState()).toMatchObject({
      mode: "challenge",
      levelId: "bridge2",
      style: "grow-dusk",
    });
  });

  it("opens creative empty or with the example, and multiplayer with two players", async () => {
    const { store, runStart } = await freshStore();
    runStart({ mode: "creative", begin: "empty" }, store.getState());
    expect(store.getState()).toMatchObject({ mode: "creative", style: "grow-dusk" });
    expect(store.getState().model.members).toHaveLength(0);
    expect(
      runStart({ mode: "creative", begin: "example" }, store.getState()),
    ).toBeNull();
    expect(store.getState().model.members.length).toBeGreaterThan(0);
    runStart({ mode: "multiplayer", begin: "continue" }, store.getState());
    expect(store.getState().mode).toBe("multiplayer");
    expect(store.getState().turn?.players).toHaveLength(2);
    // Current Shared table uses the same explicit restart as normal Play.
    expect(runStart({ mode: "multiplayer", begin: "new" }, store.getState())).toBeNull();
  });

  it("starts the cantilever preset with release board dimensions", async () => {
    const { store, runStart } = await freshStore();
    expect(runStart({ mode: "multiplayer", begin: "continue", catalogue: CANTILEVER_CATALOGUE }, store.getState())).toBeNull();
    const turn = store.getState().turn!;
    const { boardLimits } = await import("../game/turns");
    expect(turn.catalogue).toBe(CANTILEVER_CATALOGUE);
    expect(turn.rulesRevision).toBe("grow-dusk-play-2");
    expect(turn.decks).toHaveLength(3);
    expect(turn.players[0].hand).toHaveLength(0);
    const {remainingTurnDraws} = await import("../game/turns");
    expect(remainingTurnDraws(turn)).toBe(4);
    expect(boardLimits(turn)).toEqual([15, 15, 12]);
    expect(turn.board.members.map(member => [member.a, member.b])).toEqual([
      ["5,7,0", "5,7,1"], ["10,7,0", "10,7,1"],
    ]);
  });

  it("keeps four independent deck choices at each turn and after restart", async () => {
    const {store, runStart} = await freshStore();
    expect(runStart({mode:"multiplayer", begin:"continue", catalogue:CANTILEVER_CATALOGUE}, store.getState())).toBeNull();
    const {remainingTurnDraws} = await import("../game/turns");
    for (const source of ["members", "loads", "connections", "members"] as const)
      expect(store.getState().drawCard(source)).toBeNull();
    expect(remainingTurnDraws(store.getState().turn!)).toBe(0);
    expect(store.getState().turn!.players[0].hand).toHaveLength(4);
    expect(await store.getState().endTurn()).toBeNull();
    expect(store.getState().turn!.turn).toBe(2);
    expect(store.getState().turn!.reports[0].status).toBe("pending");
    expect(remainingTurnDraws(store.getState().turn!)).toBe(4);
    expect(store.getState().newMatch()).toBeNull();
    expect(store.getState().turn!.rulesRevision).toBe("grow-dusk-play-2");
    expect(remainingTurnDraws(store.getState().turn!)).toBe(4);
    expect(store.getState().turn!.players[0].hand).toHaveLength(0);
  });

  it("preserves an existing historical match when setup continues it", async () => {
    const { store, runStart } = await freshStore();
    store.getState().setMode("multiplayer", SCORED_CATALOGUE);
    const saved = structuredClone(store.getState().turn);
    store.getState().setMode("creative");
    expect(runStart({ mode: "multiplayer", begin: "continue", catalogue: CANTILEVER_CATALOGUE }, store.getState())).toBeNull();
    expect(store.getState().turn).toEqual(saved);
    expect(store.getState().turn?.catalogue).toBe(SCORED_CATALOGUE);
  });
});
