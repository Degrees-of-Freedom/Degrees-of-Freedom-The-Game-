import type { VoxelAnalysis } from '../solver/voxel';
export interface SceneView {
  result: VoxelAnalysis | null;
  combo: number;
  deformed: boolean;
  scale: number;
  utilization: boolean;
  loads: boolean;
  loadPath: boolean;
  onToggleLoadPath?: () => void;
  onMessage?: (message: string) => void;
}
