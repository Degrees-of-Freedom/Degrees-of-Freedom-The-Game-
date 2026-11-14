import { groundK } from './terrain';
import { parseNodeKey, type GameModel, type Level } from './model';
import type { VoxelLevel, VoxelModel } from '../solver/voxelInput';
import { analyzeVoxel } from '../solver/voxel';
import { autoDesignVoxel } from '../solver/voxelSizing';
import { createVoxelAnalysisSnapshot, recomposeVoxelAnalysis } from './structuralState';

/** Translate game state to the prototype-specific analysis input. */
export function toVoxelInput(
  model: GameModel,
  level: Level,
): { model: VoxelModel; level: VoxelLevel } {
  return {
    model: {
      members: model.members.map((member) => ({ ...member })),
      attrs: Object.fromEntries(
        Object.entries(model.attrs).map(([key, attrs]) => [key, { ...attrs }]),
      ),
      nextId: model.nextId,
    },
    level: {
      type: level.type,
      q0: level.q0,
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
export function analyzeGame(model: GameModel, level: Level) {
  const source = toVoxelInput(model, level);
  const input = recomposeVoxelAnalysis(createVoxelAnalysisSnapshot(source.model, source.level));
  return analyzeVoxel(input.model, input.level);
}
export function autoDesignGame(model: GameModel, level: Level) {
  const source = toVoxelInput(model, level);
  const input = recomposeVoxelAnalysis(createVoxelAnalysisSnapshot(source.model, source.level));
  return autoDesignVoxel(input.model, input.level);
}
