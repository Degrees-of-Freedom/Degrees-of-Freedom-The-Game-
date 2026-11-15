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
  /** Full proposed parent geometry for Shared table's pinned-point preview. */
  span?: {a: GridPoint; b: GridPoint};
}
import type { JointLayer } from "./jointGlyphs";
import type { DeformationField } from "./deformationField";
export interface SceneView {
  /** Kept in the workspace only, so privacy handoff can unmount every private scene resource. */
  cameraMemory?: CameraMemory;
  still?: boolean;
  trueScale?: boolean;
  showInstability?: boolean;
  diagrams?: import("./boardDiagrams").BoardDiagram[];
  jointLayer?: JointLayer;
  field?: DeformationField;
  reference?: boolean;
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
export interface CameraMemory {
  pose?: { seed: number; eye: GridPoint; target: GridPoint };
}
