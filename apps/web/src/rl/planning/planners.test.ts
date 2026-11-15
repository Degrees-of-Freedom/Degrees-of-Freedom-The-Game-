import { describe, expect, it } from "vitest";
import { GoalEnv } from "../goalEnv";
import { GOAL_SCENARIOS } from "../scenarios";
import { memberZone, nodeZone } from "../zones";
import { actionsBetween, MinHeap } from "./common";
import { ErosionPlanner } from "./erosionPlanner";
import { GraphPlanner } from "./graphPlanner";
import { PortfolioPlanner } from "./portfolioPlanner";
import { runPlanner } from "./run";

describe("MinHeap", () => {
  it("pops in priority order", () => {
    const heap = new MinHeap<string>();
    [5, 1, 4, 2, 3, 0].forEach((p) => heap.push(`p${p}`, p));
    const order: string[] = [];
    for (let top = heap.pop(); top; top = heap.pop()) order.push(top.v);
    expect(order).toEqual(["p0", "p1", "p2", "p3", "p4", "p5"]);
  });
});

describe("actionsBetween", () => {
  it("orders foundations, then members grown from existing nodes, then joints", () => {
    const base = { members: [], attrs: { "4,4,3": { load: 40, locked: true, target: true } }, nextId: 1 };
    const target = {
      members: [{ id: 1, a: "4,4,0", b: "4,4,3", type: "glulam" as const }],
      attrs: { "4,4,3": base.attrs["4,4,3"], "4,4,0": { found: true, joint: true } },
      nextId: 2,
    };
    expect(actionsBetween(base, target).map((a) => a.kind)).toEqual(["foundation", "member", "joint"]);
  });

  it("refuses a member that touches nothing", () => {
    const base = { members: [], attrs: {}, nextId: 1 };
    const target = { members: [{ id: 1, a: "1,1,1", b: "1,1,2", type: "shs" as const }], attrs: {}, nextId: 2 };
    expect(() => actionsBetween(base, target)).toThrow(/does not touch/);
  });
});

describe.each([
  ["graph", () => new GraphPlanner()],
  ["erosion", () => new ErosionPlanner({ maxLength: 3 })],
] as const)("%s planner", (_name, make) => {
  it("solves the one-weight level at the known optimum cost", () => {
    const run = runPlanner(new GoalEnv(GOAL_SCENARIOS.single), make());
    expect(run).toMatchObject({ solved: true, cost: 660, invalidMoves: 0, steps: 3 });
  });
});

describe("graph planner on multi-part goals", () => {
  it("holds the first weight, waits, then extends for the second", () => {
    const run = runPlanner(new GoalEnv(GOAL_SCENARIOS.staged), new GraphPlanner());
    expect(run.solved).toBe(true);
    expect(run.invalidMoves).toBe(0);
    const kinds = run.actions.map((a) => a.kind);
    expect(kinds).toContain("wait");
    // Everything before the first wait is the first part; the second is built after.
    expect(kinds.indexOf("wait")).toBeLessThan(kinds.lastIndexOf("member"));
  });

  it("solves the staged goal while avoiding the keep-out zone", () => {
    const scenario = GOAL_SCENARIOS.holdAvoid;
    const run = runPlanner(new GoalEnv(scenario), new GraphPlanner());
    expect(run.solved).toBe(true);
    expect(run.invalidMoves).toBe(0);
    for (const a of run.actions) {
      if (a.kind === "member") expect(memberZone(scenario.zones, a.a, a.b)).toBeUndefined();
      if (a.kind === "foundation" || a.kind === "joint") expect(nodeZone(scenario.zones, a.at)).toBeUndefined();
    }
  }, 60_000);
});

describe("erosion planner", () => {
  it("never leaves what it removed holding up: result passes in the real environment", () => {
    const run = runPlanner(new GoalEnv(GOAL_SCENARIOS.staged), new ErosionPlanner());
    expect(run).toMatchObject({ solved: true, invalidMoves: 0 });
  });

  it("finds a cheaper answer than the graph planner when the zone forces a detour", () => {
    const zoned = new GoalEnv(GOAL_SCENARIOS.zoned);
    const erosion = runPlanner(zoned, new ErosionPlanner());
    expect(erosion.solved).toBe(true);
    for (const a of erosion.actions) {
      if (a.kind === "member") expect(memberZone(GOAL_SCENARIOS.zoned.zones, a.a, a.b)).toBeUndefined();
    }
    // The graph planner solves it at 4000 (see docs); erosion reached 3240.
    expect(erosion.cost).toBeLessThan(4000);
  }, 90_000);

  it("reports a structure that exceeds the level's supply as unsolved rather than playing it", () => {
    // holdAvoid has six joints; erosion's local optimum needs seven.
    const run = runPlanner(new GoalEnv(GOAL_SCENARIOS.holdAvoid), new ErosionPlanner());
    expect(run.solved).toBe(false);
  }, 90_000);
});

describe("portfolio planner", () => {
  it("returns the cheaper solved plan, and never an unsolved one over a solved one", async () => {
    const stub = (name: string, solved: boolean, cost: number) => ({
      name,
      plan: (_s: unknown, model: unknown) => ({ actions: [], model: model as never, solved, cost }),
    });
    const scenario = GOAL_SCENARIOS.single;
    const model = { members: [], attrs: {}, nextId: 1 };
    const pick = (...planners: ReturnType<typeof stub>[]) => new PortfolioPlanner(planners as never).plan(scenario, model);
    expect(pick(stub("a", true, 900), stub("b", true, 700)).cost).toBe(700);
    expect(pick(stub("a", true, 900), stub("b", false, 100))).toMatchObject({ solved: true, cost: 900 });
    expect(pick(stub("a", false, 300), stub("b", false, 200)).cost).toBe(200);
    expect(() => new PortfolioPlanner([]).plan(scenario, model)).toThrow(/at least one/);
  });

  it("solves the staged goal in the environment at the best known cost", () => {
    const run = runPlanner(new GoalEnv(GOAL_SCENARIOS.staged), new PortfolioPlanner());
    expect(run).toMatchObject({ solved: true, cost: 1320, invalidMoves: 0 });
  });
});
