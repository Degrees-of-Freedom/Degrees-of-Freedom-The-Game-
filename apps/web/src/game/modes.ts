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
    // Remove the first diagonal to give the player a repair exercise.
    const diagonal = model.members.findIndex((m) => {
      const a = m.a.split(',').map(Number), b = m.b.split(',').map(Number);
      return a[2] !== b[2] && (a[0] !== b[0] || a[1] !== b[1]);
    });
    if (diagonal >= 0) model.members.splice(diagonal, 1);
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
