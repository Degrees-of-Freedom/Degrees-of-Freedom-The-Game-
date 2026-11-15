import { afterEach, expect, it, vi } from "vitest";
import { readSession } from "./session";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("replaces a match in progress only on explicit confirmation, and saves the new one", async () => {
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  });
  const { useGameStore } = await import("./store");
  useGameStore.getState().setMode("multiplayer");
  expect(useGameStore.getState().endTurn()).toBeNull();
  const inProgress = useGameStore.getState().turn;
  expect(inProgress).toMatchObject({ seed: 1, turn: 2, finished: false });
  // Without the confirmation flag the match is kept untouched.
  expect(useGameStore.getState().newMatch()).toMatch(/Finish/);
  expect(useGameStore.getState().turn).toBe(inProgress);
  expect(useGameStore.getState().newMatch(undefined, { replaceUnfinished: true })).toBeNull();
  const fresh = { seed: 2, turn: 1, finished: false, reports: [] };
  expect(useGameStore.getState().turn).toMatchObject(fresh);
  // The old match is gone from the save as well.
  expect(readSession(localStorage)).toMatchObject({ status: "found", session: { mode: "multiplayer", turn: fresh } });
});

it("places foundations in Load in space within the level supply, and not in the other fixed modes", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  const { useGameStore } = await import("./store");
  const { LEVELS } = await import("./levels");
  const game = () => useGameStore.getState();
  game().setMode("load-space");
  expect(game().levelId).toBe("pickup1");
  // The level starts with weights only: without this the mode cannot be completed.
  expect(Object.values(game().model.attrs).some((attrs) => attrs.found)).toBe(false);
  const supply = LEVELS.pickup1.inv?.found ?? 0;
  for (let i = 0; i < supply; i++) expect(game().placeFoundation([1 + i, 1, 0])).toBeNull();
  expect(Object.values(game().model.attrs).filter((attrs) => attrs.found)).toHaveLength(supply);
  expect(game().placeFoundation([1, 3, 0])).toBe("No foundations left in supply");
  expect(game().placeFoundation([2, 2, 3])).toBe("Foundations need solid ground");
  const { placesFoundations } = await import("./modes");
  expect((["challenge", "forensics", "multiplayer"] as const).map(placesFoundations)).toEqual([false, false, false]);
});

// This test reloads the application module graph to simulate browser startup.
it("restores the active match across startup and mode changes, then persists a new match", async () => {
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  });
  let { useGameStore } = await import("./store");
  useGameStore.getState().setMode("multiplayer");
  useGameStore.getState().setStyle("kit");
  expect(useGameStore.getState().newMatch()).toMatch(/Finish/);
  expect(useGameStore.getState().endTurn()).toBeNull();
  const turnAfterPass = useGameStore.getState().turn;
  expect(turnAfterPass?.turn).toBe(2);
  vi.resetModules();
  ({ useGameStore } = await import("./store"));
  expect(useGameStore.getState()).toMatchObject({
    mode: "multiplayer",
    style: "kit",
    turn: turnAfterPass,
  });
  useGameStore.getState().setMode("creative");
  useGameStore.getState().setMode("multiplayer");
  expect(useGameStore.getState().turn).toEqual(turnAfterPass);
  for (let n = 2; n <= 16; n++)
    expect(useGameStore.getState().endTurn()).toBeNull();
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
