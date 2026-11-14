import type { GameModel, Level } from './model';
import type { VoxelLevel, VoxelModel } from '../solver/voxelInput';
import { analyzeVoxel, autoDesignVoxel } from '../solver/voxel';

/** Translate game state to the prototype-specific analysis input. */
export function toVoxelInput(model: GameModel, level: Level): { model: VoxelModel; level: VoxelLevel } {
  return {
    model: { members: model.members.map(member => ({ ...member })), attrs: Object.fromEntries(Object.entries(model.attrs).map(([key, attrs]) => [key, { ...attrs }])), nextId: model.nextId },
    level: { type: level.type, q0: level.q0, budget: level.budget, inv: level.inv ? { ...level.inv } : null, target: level.target, payload: level.payload, cliffL: level.cliffL, cliffR: level.cliffR, cliffH: level.cliffH, ys: level.ys?.slice(), traffic: level.traffic },
  };
}
export function analyzeGame(model: GameModel, level: Level) {
  const input = toVoxelInput(model, level);
  return analyzeVoxel(input.model, input.level);
}
export function autoDesignGame(model: GameModel, level: Level) {
  const input = toVoxelInput(model, level);
  return autoDesignVoxel(input.model, input.level);
}
