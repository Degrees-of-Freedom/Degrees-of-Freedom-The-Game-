/** Gameplay contexts share the same structural model. */
export type GameMode = 'challenge' | 'creative' | 'multiplayer' | 'forensics' | 'load-space';
/** Presentation selection does not change the structural model. */
export type PresentationStyle = 'engineering' | 'grow' | 'grow-dusk' | 'levels' | 'blocks' | 'kit';

import { initialModel } from './layout';
import { LEVELS } from './levels';
import type { GameModel, LevelId } from './model';
import type { VoxelAnalysis } from '../solver/voxel';

/** Starting layouts are experiments, not verified engineering exercises. */
export function modeSetup(mode: GameMode): { levelId: LevelId; model: GameModel } {
  const levelId: LevelId = mode === 'load-space' ? 'pickup1' : mode === 'challenge' ? 'tower1' : 'sandbox';
  if (mode === 'forensics') {
    // The isolated member is a visible connectivity fault. A rigid joint at
    // each end lets a new member connect it to the supported column.
    const model: GameModel = {
      members: [
        { id: 1, a: '4,4,0', b: '4,4,3', type: 'shs' },
        { id: 2, a: '2,4,3', b: '2,4,4', type: 'shs' },
      ],
      attrs: { '4,4,0': { found: true, joint: true }, '4,4,3': { joint: true }, '2,4,3': { joint: true }, '2,4,4': { joint: true } },
      nextId: 3,
    };
    return { levelId, model };
  }
  return { levelId, model: initialModel(LEVELS[levelId]) };
}

/** Interpret only available prototype results; never treat an error as success. */
export function modeProgress(mode: GameMode, analysis: VoxelAnalysis): 'complete' | 'incomplete' | 'unavailable' {
  if (mode !== 'forensics' && mode !== 'load-space' && mode !== 'challenge') return 'unavailable';
  if (analysis.error) return 'unavailable';
  if (mode === 'forensics') return !analysis.mechanism && analysis.floating.length === 0 ? 'complete' : 'incomplete';
  return analysis.success ? 'complete' : 'incomplete';
}
