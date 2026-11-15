import type { GridPoint } from "../game/model";
import type { StructureEvaluation } from "../evaluator/results";
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
import type { DeformationField } from "./deformationField";
export interface SceneView {
  /** Kept in the workspace only, so privacy handoff can unmount every private scene resource. */
  cameraMemory?: CameraMemory;
  still?: boolean;
  trueScale?: boolean;
  showInstability?: boolean;
  instabilityMode?: number;
  playInstability?: boolean;
  reactionLabels?: "off" | "small" | "normal" | "large";
  diagrams?: import("./boardDiagrams").BoardDiagram[];
  jointLayer?: JointLayer;
  field?: DeformationField;
  reference?: boolean;
  result: StructureEvaluation | null;
  combo: number;
  baySize?: GridPoint;
  deformed: boolean;
  scale: number;
  utilization: boolean;
  loads: boolean;
  loadPath: boolean;
  /** Draw a translucent deflected ghost from `field` while members stay at their reference position. */
  shadow?: boolean;
  /** In-scene text labels (load, reaction, force, peak and axis values). Undefined means shown. */
  labels?: boolean;
  onToggleLoadPath?: () => void;
  onMessage?: (message: string) => void;
}
export interface CameraMemory {
  pose?: { seed: number; eye: GridPoint; target: GridPoint };
}
