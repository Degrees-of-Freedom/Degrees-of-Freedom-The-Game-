/** Input for the experimental voxel analysis. Grid keys contain integer x,y,z coordinates. */
export type VoxelMemberType = 'shs' | 'glulam' | 'ipe' | 'heb' | 'cable';
export interface VoxelMember { id: number; a: string; b: string; type: VoxelMemberType }
export interface VoxelNodeAttributes { found?: boolean; joint?: boolean; load?: number; locked?: boolean }
export interface VoxelModel { members: VoxelMember[]; attrs: Record<string, VoxelNodeAttributes>; nextId: number }
/** Game loading and objective inputs. Distances are grid cells; forces are kN. */
export interface VoxelLevel {
  type: 'tower' | 'bridge' | 'sandbox'; q0: number; budget: number;
  inv: Partial<Record<VoxelMemberType | 'joint' | 'found', number>> | null;
  target?: number; payload?: number; cliffL?: number; cliffR?: number; cliffH?: number;
  ys?: number[]; traffic?: number;
}
