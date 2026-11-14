import { afterEach, describe, expect, it, vi } from "vitest";
import { planStart, runStart, type StartActions } from "./startPlan";

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
    // A match in progress cannot be replaced; the store says so.
    expect(runStart({ mode: "multiplayer", begin: "new" }, store.getState())).toMatch(
      /Finish/,
    );
  });
});
