import { afterEach, expect, it, vi } from "vitest";
import { readSession } from "./session";
import { SCORED_CATALOGUE } from "./cardCatalogue";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

// This test reloads the application module graph to simulate browser startup.
it("restores the active match across startup and mode changes, then persists a new match", async () => {
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  });
  // As in main.tsx: the Rust turn solver is ready before the store loads.
  const loadStore = async () => {
    await (await import("./turnAnalysis")).prepareTurnSolver();
    return import("./store");
  };
  let { useGameStore } = await loadStore();
  const { unavailableSolver } = await import("../solver/unavailable");
  useGameStore.setState({ turnSolver: unavailableSolver });
  useGameStore.getState().setMode("multiplayer", SCORED_CATALOGUE);
  useGameStore.getState().setStyle("kit");
  expect(useGameStore.getState().newMatch()).toMatch(/Finish/);
  expect(await useGameStore.getState().endTurn()).toBeNull();
  const turnAfterPass = useGameStore.getState().turn;
  expect(turnAfterPass?.turn).toBe(2);
  vi.resetModules();
  ({ useGameStore } = await loadStore());
  useGameStore.setState({ turnSolver: (await import("../solver/unavailable")).unavailableSolver });
  expect(useGameStore.getState()).toMatchObject({
    mode: "multiplayer",
    style: "kit",
    turn: turnAfterPass,
  });
  useGameStore.getState().setMode("creative");
  useGameStore.getState().setMode("multiplayer");
  expect(useGameStore.getState().turn).toEqual(turnAfterPass);
  for (let n = 2; n <= 16; n++)
    expect(await useGameStore.getState().endTurn()).toBeNull();
  expect(useGameStore.getState().turn?.finished).toBe(true);
  expect(useGameStore.getState().newMatch()).toBeNull();
  expect(useGameStore.getState().turn).toMatchObject({
    seed: 2,
    turn: 1,
    finished: false,
    reports: [],
  });
  expect(readSession(localStorage)).toMatchObject({
    status: "found",
    session: {
      mode: "multiplayer",
      style: "kit",
      turn: { seed: 2, turn: 1, finished: false, reports: [] },
    },
  });
}, 60_000);
