import type { GridPoint } from "../game/model";
import type { VoxelAnalysis } from "../solver/voxel";
import type { JointLayer } from "./jointGlyphs";
export interface SceneView {
  jointLayer?: JointLayer;
  result: VoxelAnalysis | null;
  combo: number;
  baySize?: GridPoint;
  deformed: boolean;
  scale: number;
  utilization: boolean;
  loads: boolean;
  loadPath: boolean;
  onToggleLoadPath?: () => void;
  onMessage?: (message: string) => void;
}
