/** Gameplay contexts share the same structural model. */
export type GameMode = 'challenge' | 'creative' | 'multiplayer' | 'forensics' | 'load-space';
/** Presentation selection does not change the structural model. */
export type PresentationStyle = 'engineering' | 'grow' | 'grow-dusk' | 'levels' | 'blocks' | 'kit';

import { exampleModel } from './examples';
import { initialModel } from './layout';
import { LEVELS } from './levels';
import type { GameModel, LevelId } from './model';
import type { VoxelAnalysis } from '../solver/voxel';

/** Starting layouts are experiments, not verified engineering exercises. */
export function modeSetup(mode: GameMode): { levelId: LevelId; model: GameModel } {
  const levelId: LevelId = mode === 'load-space' ? 'pickup1' : mode === 'forensics' || mode === 'challenge' ? 'tower1' : 'sandbox';
  if (mode === 'forensics') {
    const model = exampleModel('tower1')!;
    // A deliberately disconnected member gives the experimental connectivity
    // check a visible fault; connect its lower end to the existing frame.
    model.members.push({ id: model.nextId++, a: '2,4,3', b: '2,4,4', type: 'shs' });
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
