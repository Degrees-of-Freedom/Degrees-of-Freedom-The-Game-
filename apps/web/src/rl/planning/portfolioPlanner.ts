import type { GameModel } from "../../game/model";
import type { GoalScenario } from "../types";
import type { PlanResult, Planner } from "./common";
import { ErosionPlanner } from "./erosionPlanner";
import { GraphPlanner } from "./graphPlanner";

/**
 * Proposal-level choice: ask several planners for a whole plan and keep the
 * best one, judged on the plan as a whole (solved, then cheapest) rather than
 * move by move. Solving is verified by the game's analysis inside each planner,
 * so a plan that fails is never preferred over one that passes.
 *
 * The planners are complementary: graph search is fast and respects the level's
 * supply while it builds; erosion often finds a cheaper structure but can
 * overrun the supply or stall. On 16 random staged-and-zoned layouts the graph
 * planner alone solved 16 (mean cost 3,303), erosion 13, and the better of the
 * two solved 16 at a mean cost of 3,005.
 */
export class PortfolioPlanner implements Planner {
  readonly name = "portfolio";

  constructor(private readonly planners: readonly Planner[] = [new GraphPlanner(), new ErosionPlanner()]) {}

  plan(scenario: GoalScenario, model: GameModel): PlanResult {
    let best: PlanResult | null = null;
    for (const planner of this.planners) {
      const result = planner.plan(scenario, model);
      if (!best || (result.solved && !best.solved) || (result.solved === best.solved && result.cost < best.cost))
        best = result;
    }
    if (!best) throw new Error("A portfolio needs at least one planner");
    return best;
  }
}
