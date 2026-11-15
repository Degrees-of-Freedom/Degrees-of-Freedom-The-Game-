import type { FrameConnection } from './connections';
/** Structure evaluator input. Node keys are grid keys with integer x,y,z
 * coordinates in cells of `S` metres, or, for the Shared table, identities
 * with explicit `positions`. Member loads and capacities are in kN. */
export type EvaluatorMemberType = 'shs' | 'chs' | 'glulam' | 'ipe' | 'heb' | 'cable' | 'spring';
export interface EvaluatorMember {
  id: number; a: string; b: string; type: EvaluatorMemberType;
  /** Unstressed length of this particular versioned cable segment, metres. */
  restLengthM?: number;
  /** Parent cartridge's two-way stiffness, before quarter subdivision. */
  springStiffnessNPerM?: number;
  endA?: 'fixed' | 'ball'; endB?: 'fixed' | 'ball';
  /** Physical six-axis interface, when supplied by a printed frame connector. */
  connectionA?: FrameConnection; connectionB?: FrameConnection;
  /** Internal continuous piece of a dealt frame, with stations measured in original quarters. */
  parentSpan?: { memberId: number; fromQuarter: number; toQuarter: number; assemblyPart?: string; unbracedLengthM?: number };
}
export interface EvaluatorNodeAttributes { found?: boolean; joint?: boolean; load?: number; locked?: boolean; target?: boolean; restraint?: [boolean, boolean, boolean, boolean, boolean, boolean]; loadDirection?: '-Z' | '+Z' | '+X' | '-X' | '+Y' | '-Y' }
export interface EvaluatorModel {
  members: EvaluatorMember[]; attrs: Record<string, EvaluatorNodeAttributes>; nextId: number;
  /** Grid-index positions for analysis nodes with IDs independent of location. */
  positions?: Record<string, [number, number, number]>;
  /** Uncoupled joint rotations omitted from the equation system, not supports. */
  inactiveRotations?: ReadonlySet<string>;
}
/** Game loading and objective inputs. Distances are grid cells; forces are kN. */
export interface EvaluatorLevel {
  type: 'tower' | 'bridge' | 'pickup' | 'sandbox'; q0: number; budget: number; loadCase?: 'applied' | 'design';
  /** Applied sandbox loads only. Legacy applied analyses include lumped self-weight. */
  appliedSelfWeight?: boolean;
  inv: Partial<Record<EvaluatorMemberType | 'joint' | 'found', number>> | null;
  target?: number; payload?: number; cliffL?: number; cliffR?: number; cliffH?: number;
  ys?: number[]; traffic?: number; groundHeights?: Record<string, number>;
}
