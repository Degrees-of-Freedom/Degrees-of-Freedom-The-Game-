import type { GridPoint } from "../game/model";
import type { VoxelAnalysis } from "../solver/voxel";
/** What the pointer is over, published by the picker for scene labels and guides. */
export interface SceneHover {
  p: GridPoint;
  issue: string | null;
  /** Set when the point is a reachable growth target from the armed start. */
  role: "column" | "beam" | "brace" | null;
  /** For example "2 of 3 overlapping" when several targets share a pixel. */
  stack: string;
}
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
