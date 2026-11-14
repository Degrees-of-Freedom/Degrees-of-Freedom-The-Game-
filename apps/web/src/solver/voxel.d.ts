import type { GameModel, Level } from '../game/model';

/** Prototype analysis in kN and metres. Results are approximate and not engineering design. */
export interface VoxelAnalysis {
  error?: string;
  mechanism: boolean;
  floating: string[];
  unstable: Set<string>;
  objectives: { ok: boolean; label: string; detail: string; warn?: boolean }[];
  members: Record<number, { util: number; gov: string; slack: boolean; checks: Record<string, number>; demand: Record<string, unknown> }>;
  found: Record<string, { util: number; r: Float64Array | null; locked: boolean }>;
  combos: unknown[];
  success?: boolean;
  cost?: number;
  mass?: number;
  stars?: number;
  maxU?: number;
  alphaMin?: number;
  time?: number;
}
/** Analyse the game model using the original prototype's load combinations and checks. */
export function analyzeVoxel(model: GameModel, level: Level): VoxelAnalysis;
