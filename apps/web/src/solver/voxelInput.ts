/** Input for the experimental voxel analysis. Grid keys contain integer x,y,z coordinates. */
export type VoxelMemberType = 'shs' | 'glulam' | 'ipe' | 'heb' | 'cable' | 'spring';
export interface VoxelMember {
  id: number; a: string; b: string; type: VoxelMemberType;
  endA?: 'fixed' | 'ball'; endB?: 'fixed' | 'ball';
  /** Internal continuous piece of a dealt frame, with stations measured in original quarters. */
  parentSpan?: { memberId: number; fromQuarter: number; toQuarter: number; assemblyPart?: string; unbracedLengthM?: number };
}
export interface VoxelNodeAttributes { found?: boolean; joint?: boolean; load?: number; locked?: boolean; target?: boolean; restraint?: [boolean, boolean, boolean, boolean, boolean, boolean]; loadDirection?: '-Z' | '+Z' | '+X' | '-X' | '+Y' | '-Y' }
export interface VoxelModel {
  members: VoxelMember[]; attrs: Record<string, VoxelNodeAttributes>; nextId: number;
  /** Grid-index positions for analysis nodes with IDs independent of location. */
  positions?: Record<string, [number, number, number]>;
  /** Uncoupled joint rotations omitted from the equation system, not supports. */
  inactiveRotations?: ReadonlySet<string>;
}
/** Game loading and objective inputs. Distances are grid cells; forces are kN. */
export interface VoxelLevel {
  type: 'tower' | 'bridge' | 'pickup' | 'sandbox'; q0: number; budget: number; loadCase?: 'applied' | 'design';
  /** Applied sandbox loads only. Legacy applied analyses include lumped self-weight. */
  appliedSelfWeight?: boolean;
  inv: Partial<Record<VoxelMemberType | 'joint' | 'found', number>> | null;
  target?: number; payload?: number; cliffL?: number; cliffR?: number; cliffH?: number;
  ys?: number[]; traffic?: number; groundHeights?: Record<string, number>;
}
