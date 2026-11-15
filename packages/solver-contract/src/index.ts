/**
 * Shared structural model and solver adapter contract.
 *
 * Units are SI base units throughout: metres, newtons, newton-metres and
 * radians. Six-component vectors hold global translations X/Y/Z followed by
 * global rotations X/Y/Z (or the matching forces and moments).
 */

export type Vector3 = readonly [number, number, number];
/** Global X/Y/Z translations (or forces) followed by X/Y/Z rotations (or moments). */
export type Vector6 = readonly [number, number, number, number, number, number];

export interface StructuralNode { id: string; position: Vector3 }

/**
 * How a member end attaches to its node. A `fixed` end transfers moments
 * (rigid connection); a `pinned` end transfers forces only.
 */
export type MemberEndFixity = 'fixed' | 'pinned';

export interface StructuralMember {
  id: string;
  startNodeId: string;
  endNodeId: string;
  /** Connection at the start node. Defaults to `fixed` when omitted. */
  startFixity?: MemberEndFixity;
  /** Connection at the end node. Defaults to `fixed` when omitted. */
  endFixity?: MemberEndFixity;
}

/** Global translations X/Y/Z followed by rotations X/Y/Z. */
export type DegreesOfFreedom = readonly [boolean, boolean, boolean, boolean, boolean, boolean];
export interface StructuralSupport { nodeId: string; restrained: DegreesOfFreedom }
export interface StructuralLoad { nodeId: string; force: Vector3; moment: Vector3 }
export interface StructuralModel { units: 'SI'; nodes: StructuralNode[]; members: StructuralMember[]; supports: StructuralSupport[]; loads: StructuralLoad[] }

/**
 * Internal forces of one member under nodal loading. Only `axial` is signed;
 * the other values are magnitudes, so they do not depend on a local axis
 * convention. With nodal loads only, shear and torsion are constant along the
 * member and the bending moment peaks at one of the two ends.
 */
export interface MemberForces {
  /** Axial force in N. Tension is positive, compression negative. */
  axial: number;
  /** Resultant transverse shear force in N. */
  shear: number;
  /** Torsional moment in N·m. */
  torsion: number;
  /** Resultant bending moment at the start node in N·m. */
  momentStart: number;
  /** Resultant bending moment at the end node in N·m. */
  momentEnd: number;
}

/**
 * One zero-stiffness motion of the structure. `translation` modes move at
 * least one node; `rotation` modes only spin nodes in place (for example a
 * straight run of rigidly joined members turning about its own axis).
 */
export interface MechanismMode {
  kind: 'translation' | 'rotation';
  /**
   * Mode shape per participating node, scaled so the largest translation
   * (or, for rotation modes, the largest rotation) is 1. The basis of a
   * multi-mode mechanism space is not unique.
   */
  displacements: Record<string, Vector6>;
}

/** Kinematic and static determinacy of the analysed model. */
export interface StabilityReport {
  /** True when the model can carry its loads: no translational mechanism and no loaded rotational one. */
  stable: boolean;
  /** Unrestrained degrees of freedom in the analysed system. */
  freeDofs: number;
  /** Total number of independent zero-stiffness mechanisms. */
  mechanisms: number;
  translationalMechanisms: number;
  rotationalMechanisms: number;
  /** Degree of static indeterminacy (redundancy). Zero for a statically determinate, stable model. */
  staticIndeterminacy: number;
  /** Nodes that take part in a mechanism that makes the model unstable. Empty when stable. */
  unstableNodeIds: string[];
  /** Mechanism shapes, possibly truncated; the counts above are always complete. */
  modes: MechanismMode[];
}

export type AnalysisResult =
  | {
      status: 'success';
      /** Displacement of every node in the model. */
      displacements: Record<string, Vector6>;
      warnings: string[];
      /** Support reactions per supported node; unrestrained components are zero. */
      reactions?: Record<string, Vector6>;
      memberForces?: Record<string, MemberForces>;
      stability?: StabilityReport;
    }
  | {
      /** The model is a mechanism, so no displacements exist. */
      status: 'unstable';
      message: string;
      stability: StabilityReport;
      warnings: string[];
    }
  | { status: 'unsupported' | 'error'; message: string };

/** Adapters translate models to their solver and explicitly report unsupported input. */
export interface SolverAdapter { readonly id: string; readonly name: string; analyze(model: StructuralModel, signal?: AbortSignal): Promise<AnalysisResult> }

export * from './analysis.js';
export * from './structural-state.js';
export * from './structural-state-service.js';
