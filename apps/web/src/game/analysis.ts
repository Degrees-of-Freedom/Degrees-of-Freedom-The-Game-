import { groundK } from "./terrain";
import { parseNodeKey, type GameModel, type Level } from "./model";
import type { EvaluatorLevel, EvaluatorModel } from "../evaluator/model";
import { autoDesign } from "../evaluator/sizing";
import { evaluateStructure } from "../evaluator/engine/rustDesign";
import type { LoadCaseSolver } from "@dof/solver-contract";
import { wasmSolver } from "../solver";
import {
  createVoxelAnalysisSnapshot,
  recomposeVoxelAnalysis,
} from "./structuralState";

/** Translate game state to the prototype-specific analysis input. */
export function toEvaluatorInput(
  model: GameModel,
  level: Level,
): { model: EvaluatorModel; level: EvaluatorLevel } {
  return {
    model: {
      members: model.members.map((member) => ({ ...member })),
      attrs: Object.fromEntries(
        Object.entries(model.attrs).map(([key, attrs]) => [key, { ...attrs, ...(attrs.restraint ? { restraint: [...attrs.restraint] as typeof attrs.restraint } : {}) }]),
      ),
      nextId: model.nextId,
    },
    level: {
      type: level.type,
      q0: level.q0,
      loadCase: level.loadCase,
      budget: level.budget,
      inv: level.inv ? { ...level.inv } : null,
      target: level.target,
      payload: level.payload,
      cliffL: level.cliffL,
      cliffR: level.cliffR,
      cliffH: level.cliffH,
      ys: level.ys?.slice(),
      traffic: level.traffic,
      groundHeights: Object.fromEntries(
        Object.entries(model.attrs)
          .filter(([, attrs]) => attrs.target)
          .map(([key]) => {
            const [i, j] = parseNodeKey(key);
            return [key, groundK(level, i, j)];
          }),
      ),
    },
  };
}
function evaluatorInput(model: GameModel, level: Level) {
  const source = toEvaluatorInput(model, level);
  return recomposeVoxelAnalysis(createVoxelAnalysisSnapshot(source.model, source.level));
}
/** Evaluate an editor or level structure on the Rust solver (see
 * `evaluator/engine/rustDesign.ts`). `solver` defaults to the shared
 * browser solver, which runs off the main thread. */
export function analyzeGame(model: GameModel, level: Level, solver: LoadCaseSolver = wasmSolver, signal?: AbortSignal) {
  const input = evaluatorInput(model, level);
  return evaluateStructure(input.model, input.level, solver, signal);
}
/** Resize sections from the level's inventory with Rust re-evaluation. */
export function autoDesignGame(model: GameModel, level: Level, solver: LoadCaseSolver = wasmSolver) {
  const input = evaluatorInput(model, level);
  return autoDesign(input.model, input.level, (m, l) => evaluateStructure(m, l, solver));
}
