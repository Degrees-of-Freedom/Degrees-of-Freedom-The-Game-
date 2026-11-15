import type { Configuration } from "./catalogue";

/** Deterministic integration fixture. All force values and deck sizes are test inputs. */
export function multiplayerFixture(): Configuration {
  return {
    matchId: "test", height: 12, rounds: 3, k0NPerM: null,
    players: [{id: "A", x: 0, y: 0}, {id: "B", x: 15, y: 15}],
    cards: Array.from({length: 32}, (_, i) => [
      {kind: "connection" as const, id: "c"+i, count: ([1,2,3] as const)[i%3]},
      ...(i === 0 ? [{kind: "member" as const, id: "m", variant: "standard" as const, maxLength: 5 as const}] : []),
      {kind: "load" as const, id: "l"+i, downwardN: 1},
    ]).flat(),
  };
}
