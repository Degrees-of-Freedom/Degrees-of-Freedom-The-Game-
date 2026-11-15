import { describe, expect, it } from "vitest";
import { GoalEnv } from "./goalEnv";
import { GOAL_SCENARIOS } from "./scenarios";
import { memberZone, nodeZone } from "./zones";
import type { GoalAction } from "./types";

const column = (x: number, y: number): GoalAction[] => [
  { kind: "foundation", at: [x, y, 0] },
  { kind: "member", a: [x, y, 0], b: [x, y, 3], type: "glulam" },
  { kind: "joint", at: [x, y, 0] },
];

describe("keep-out zones", () => {
  const [dock] = GOAL_SCENARIOS.zoned.zones;

  it("detect nodes and members inside, including a member that only crosses", () => {
    expect(nodeZone([dock], [7, 4, 1])).toBe(dock);
    expect(nodeZone([dock], [7, 4, 3])).toBeUndefined();
    expect(memberZone([dock], [7, 4, 0], [7, 4, 3])).toBe(dock);
    expect(memberZone([dock], [5, 4, 1], [9, 4, 1])).toBe(dock); // passes through
    expect(memberZone([dock], [10, 4, 0], [7, 4, 3])).toBeUndefined();
  });

  it("reject placements in the zone and never offer them as legal actions", () => {
    const env = new GoalEnv(GOAL_SCENARIOS.zoned);
    env.reset();
    expect(env.step({ kind: "foundation", at: [7, 4, 0] }).info.invalid).toMatch(/keep-out zone dock/);
    const blocked = env.step({ kind: "member", a: [7, 4, 0], b: [7, 4, 3], type: "glulam" });
    expect(blocked.info.invalid).toMatch(/keep-out/);
    for (const a of env.legalActions()) {
      if (a.kind === "foundation") expect(nodeZone([dock], a.at)).toBeUndefined();
      if (a.kind === "member") expect(memberZone([dock], a.a, a.b)).toBeUndefined();
    }
  });

  it("make the plain three-column answer fail but leave the level solvable", () => {
    const env = new GoalEnv(GOAL_SCENARIOS.zoned);
    env.reset();
    const results = [...column(4, 4), ...column(7, 4)].map((a) => env.step(a));
    expect(results.filter((r) => r.info.invalid).length).toBeGreaterThan(0);
  });
});

describe("staged goals", () => {
  it("offer wait only while a stage is pending", () => {
    const env = new GoalEnv(GOAL_SCENARIOS.staged);
    const obs = env.reset();
    expect(obs.pendingStages).toBe(1);
    expect(env.legalActions().some((a) => a.kind === "wait")).toBe(true);
    for (let i = 0; i < 5; i++) env.step({ kind: "wait" });
    expect(env.legalActions().some((a) => a.kind === "wait")).toBe(false);
    expect(env.step({ kind: "wait" }).info.invalid).toMatch(/nothing to wait for/);
  });

  it("does not finish when the first part is solved, and pays for holding it", () => {
    const env = new GoalEnv(GOAL_SCENARIOS.staged);
    env.reset();
    const first = column(4, 4).map((a) => env.step(a));
    const held = first.at(-1)!;
    expect(held.info.analysis.success).toBe(false); // second part has not arrived
    expect(held.done).toBe(false);
    env.step({ kind: "wait" });
    const arrival = env.step({ kind: "wait" });
    expect(arrival.observation.pendingStages).toBe(0);
    expect(arrival.observation.targets).toHaveLength(2);
    expect(arrival.info.terminal).toBeCloseTo(0.5, 10); // stageBonus
    // The new weight's drop in progress is not charged to the action.
    expect(arrival.info.shaping).toBe(0);
  });

  it("is solved only after the added weight is also carried", () => {
    const env = new GoalEnv(GOAL_SCENARIOS.staged);
    env.reset();
    [...column(4, 4), { kind: "wait" } as GoalAction, { kind: "wait" } as GoalAction].forEach((a) => env.step(a));
    const last = column(7, 4).map((a) => env.step(a)).at(-1)!;
    expect(last.done).toBe(true);
    expect(last.info.analysis.success).toBe(true);
  });

  it("reports a truncated episode as unsolved even if the first part passes", () => {
    const env = new GoalEnv(GOAL_SCENARIOS.staged);
    env.reset();
    let last = env.step({ kind: "wait" });
    for (const a of column(4, 4)) last = env.step(a);
    while (!last.truncated && !last.done) last = env.step({ kind: "foundation", at: [0, 0, 0] });
    expect(last.info.analysis.success).toBe(false);
  });
});

describe("randomised layouts", () => {
  const layoutOf = (seed: number) => {
    const env = new GoalEnv(GOAL_SCENARIOS.stagedR);
    const obs = env.reset(seed);
    return { env, obs, zones: env.activeScenario.zones };
  };

  it("are reproducible per seed and differ between seeds", () => {
    const a = layoutOf(3);
    expect(layoutOf(3).obs.targets).toEqual(a.obs.targets);
    expect(layoutOf(3).zones).toEqual(a.zones);
    expect(layoutOf(4).obs.targets).not.toEqual(a.obs.targets);
  });

  it("put a zone under the later weight, which then arrives and is reachable around it", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { env, zones } = layoutOf(seed);
      expect(zones).toHaveLength(1);
      for (let i = 0; i < 5; i++) env.step({ kind: "wait" });
      const second = env.step({ kind: "wait" }).observation;
      expect(second.targets).toHaveLength(2);
      const later = second.targets.find((t) => t.key !== second.targets[0].key)!;
      // The direct column under the new weight is blocked, but not the weight's own node.
      expect(memberZone(zones, [later.at[0], later.at[1], 0], later.at)).toBeDefined();
      expect(nodeZone(zones, later.at)).toBeUndefined();
    }
  });

  it("do not leak the previous episode's zones or stages into the next", () => {
    const env = new GoalEnv(GOAL_SCENARIOS.stagedR);
    env.reset(1);
    const first = env.activeScenario.zones;
    env.reset(2);
    expect(env.activeScenario.zones).not.toEqual(first);
    expect(env.reset(2).pendingStages).toBe(1);
  });
});
