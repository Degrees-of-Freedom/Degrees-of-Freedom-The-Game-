import type { FlowSegmentEvidence } from './flow';

export type Vec3 = readonly [number, number, number];
export type RotationMask = readonly [boolean, boolean, boolean];
export type MemberFamily = 'member' | 'cable' | 'spring-025' | 'spring-05';
export type MaximumLength = 5 | 7 | 10;
export type ViewSelection = { readonly kind: 'member' | 'node' | 'target'; readonly id: string } | null;

export interface QuarterPort {
  readonly id: string;
  readonly fraction: 0.25 | 0.5 | 0.75;
  readonly position: Vec3;
  readonly parentId: string;
  /** Explicit attached-joint alias, if a quarter port has become a real joint. */
  readonly nodeId?: string;
}

/** Game-owned safety actions are separate from the original card's rotation mask. */
export interface SafetyOverride {
  readonly id: string;
  readonly kind: 'rotation' | 'translation';
  readonly axes: readonly ('X' | 'Y' | 'Z')[];
  readonly reason: string;
  readonly originatingTurn: number;
  readonly checkpointId: string;
  readonly frame: 'global';
  readonly verified: boolean;
  readonly reaction?: Vec3;
  readonly reactionUnit?: string;
}

export interface JointView {
  readonly id: string;
  readonly position: Vec3;
  /** True = restrained rotation; null = not authored/unknown, never assumed fixed. */
  readonly rotations: RotationMask | null;
  readonly setupLocked?: boolean;
  readonly foundationOwner?: string;
  readonly overrides?: readonly SafetyOverride[];
}

export interface MemberView {
  readonly id: string;
  readonly cardId: string;
  readonly owner: string;
  readonly family: MemberFamily;
  readonly startNode: string;
  readonly endNode: string;
  /** Positions in game units on the original undeformed reference geometry. */
  readonly start: Vec3;
  readonly end: Vec3;
  readonly maxLength: MaximumLength;
  readonly phase: 'draft' | 'committed';
  readonly setupLocked?: boolean;
  readonly rotations: readonly [RotationMask | null, RotationMask | null];
  readonly quarterPorts: readonly QuarterPort[];
  readonly spring?: { readonly k0: number; readonly unit: string };
  readonly section?: { readonly width: number; readonly depth: number; readonly unit: 'game units' };
  readonly rollRadians?: number;
}

export interface CheckpointView {
  readonly id: string;
  readonly modelRevision: string;
  readonly turn: number;
  readonly valid: boolean;
  /** Provenance is visible: fixtures and experimental results are never called verified. */
  readonly provenance: string;
  readonly forceUnit: string;
  readonly segments: readonly FlowSegmentEvidence[];
  readonly sources: readonly string[];
  /** Includes neutral safety-restraint sinks, without assigning their reactions to players. */
  readonly supports: readonly string[];
}

export interface MultiplayerViewData {
  readonly revision: string;
  readonly board: { readonly width: 15; readonly depth: 15; readonly height: number };
  readonly metresPerUnit: number;
  readonly members: readonly MemberView[];
  readonly joints: readonly JointView[];
  readonly checkpoint?: CheckpointView;
}

export interface PlacementView {
  readonly origin: Vec3;
  readonly maxLength: MaximumLength;
  readonly quarterPorts?: readonly QuarterPort[];
  /** Inject canonical clash/card/attachment legality. No structural analysis is run here. */
  readonly isLegal?: (position: Vec3, portId?: string) => boolean;
}

export interface DraftEdit { readonly end: Vec3 }
export interface ViewSafeZone { readonly id: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface SceneHandle { fit(): void; pause(): void; resume(): void; dispose(): void }
