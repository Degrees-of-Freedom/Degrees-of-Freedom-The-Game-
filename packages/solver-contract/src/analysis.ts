/**
 * Analytical model, options and result of the reference solver.
 *
 * This is the detailed contract proposed by the solver criteria. It sits
 * beside the original `StructuralModel` contract in `index.ts`, which stays
 * for the adapters and panels that use it. The Rust solver in
 * `crates/dof-solver` implements this contract; its `model.rs` and
 * `report.rs` are the authoritative description of every convention.
 *
 * Conventions:
 * - SI base units: metres, newtons, newton-metres, radians, pascals, kg/m³.
 * - Right-handed global axes. The solver has no built-in "up": gravity is a
 *   vector in the options.
 * - Member local axes: `x` from start node to end node; `z` is the part of
 *   `orientation` perpendicular to `x` (default reference: global Z, or
 *   global X for a member parallel to Z); `y = z × x`.
 * - Connectivity is by node id only. Nodes at the same coordinates are not
 *   connected unless a member names both.
 * - In results, `null` means unavailable or unverified. It never means zero.
 */

import type { Vector3, Vector6 } from './index.js';

/** Behaviour of one local degree of freedom of a connection. */
export type ConnectionLaw =
  /** The member end moves with the node. */
  | 'rigid'
  /** Nothing is transmitted. */
  | 'free'
  /** Linear spring: N/m for translations, N·m/rad for rotations. */
  | { elastic: number };

/** Laws for local translation x, y, z then rotation about x, y, z. */
export type ConnectionLaws = readonly [
  ConnectionLaw, ConnectionLaw, ConnectionLaw, ConnectionLaw, ConnectionLaw, ConnectionLaw,
];

export interface ConnectionCapacity {
  /** Force along the member axis, N. */
  axial?: number;
  /** Resultant transverse force, N. */
  shear?: number;
  /** Resultant moment, N·m. */
  moment?: number;
}

/** How one member end joins its node. Omitted laws are rigid. */
export interface MemberConnection {
  /** Undeformed connector X/Y/Z unit directions in global axes. They turn
   * with the node. Omission uses the member's local reference directions. */
  axes?: readonly [Vector3, Vector3, Vector3];
  laws?: ConnectionLaws;
  capacity?: ConnectionCapacity;
}

/** Strength limits of a section; an omitted limit is not checked. */
export interface SectionCapacity {
  tension?: number;
  compression?: number;
  shear?: number;
  torsion?: number;
  momentY?: number;
  momentZ?: number;
}

/** Card-defined member properties. */
export interface AnalysisSection {
  id: string;
  /** Young's modulus, Pa. */
  E: number;
  /** Shear modulus, Pa. Required for beams. */
  G?: number;
  /** Area, m². */
  A: number;
  /** Second moments of area about local y and z, m⁴. Required for beams. */
  Iy?: number;
  Iz?: number;
  /** Torsion constant, m⁴. Required for beams. */
  J?: number;
  /** Shear areas for deflection along local y and z; omitted means none. */
  shearAreaY?: number;
  shearAreaZ?: number;
  /** Density, kg/m³, used when gravity is given. */
  density?: number;
  capacity?: SectionCapacity;
}

export type AnalysisMemberKind = 'beam' | 'brace' | 'cable';

export interface AnalysisMember {
  id: string;
  /** Defaults to `beam`. Braces and cables are pinned axial members. */
  kind?: AnalysisMemberKind;
  startNodeId: string;
  endNodeId: string;
  sectionId: string;
  orientation?: Vector3;
  start?: MemberConnection;
  end?: MemberConnection;
  /** Unstressed length of a brace or cable, m. */
  restLength?: number;
  /** Strain at the undeformed geometry; positive is pretension. */
  initialStrain?: number;
  /** Card this member is a part of, echoed in the result. */
  parentId?: string;
  /** Beam elements used for this member. */
  subdivisions?: number;
}

export interface AnalysisFoundation {
  id: string;
  nodeId: string;
  /** Restrained global translations X/Y/Z then rotations X/Y/Z. */
  restrained: readonly [boolean, boolean, boolean, boolean, boolean, boolean];
}

export interface AnalysisLoad {
  id: string;
  nodeId: string;
  force?: Vector3;
  moment?: Vector3;
}

export interface AnalysisModel {
  /** Identifier of this model state, echoed as `analysis.modelVersion`. */
  version?: string;
  nodes: { id: string; position: Vector3 }[];
  sections: AnalysisSection[];
  members: AnalysisMember[];
  foundations: AnalysisFoundation[];
  loads: AnalysisLoad[];
}

export interface AnalysisOptions {
  /** `linear` is the fast preview; `nonlinear` (default) is authoritative. */
  fidelity?: 'linear' | 'nonlinear';
  /** Gravity vector, m/s². Present switches member self-weight on. */
  gravity?: Vector3;
  /** Multiplier on all external loads. */
  loadFactor?: number;
  /** Beam elements per beam member (default 2). */
  subdivisions?: number;
  tolerance?: number;
  residualGate?: number;
  maxIterations?: number;
  /** Deterministic work limit; exceeding it gives an `unknown` component. */
  maxTotalIterations?: number;
  excessiveDisplacementRatio?: number;
  criticalLoadSearch?: boolean;
  /** Load multiplier a stable state must survive not to be `marginal`. */
  stabilityMargin?: number;
  /** `remove` fails the most overloaded object and reanalyses. */
  failure?: 'report' | 'remove';
  maxFailureEvents?: number;
  maxModes?: number;
}

export type ComponentStatus = 'stable' | 'marginal' | 'unstable' | 'unknown';

/** A displacement pattern: a mechanism, a spin, or a buckling shape. */
export interface AnalysisMode {
  kind: 'mechanism' | 'spin' | 'buckling';
  /** Participating nodes, scaled so the largest translation is one. */
  displacements: Record<string, Vector6>;
}

/** One connected part of the structure, analysed on its own. */
export interface AnalysisComponent {
  id: string;
  status: ComponentStatus;
  /** Whether displacements, forces and reactions of this part are verified. */
  resultsValid: boolean;
  reasonCodes: string[];
  nodeIds: string[];
  memberIds: string[];
  flags: {
    unsupported: boolean;
    mechanism: boolean;
    loadInducedInstability: boolean;
    nearMechanism: boolean;
    excessiveDeformation: boolean;
    strengthExceeded: boolean;
  };
  counts: {
    freeDofs: number;
    unusedDofs: number;
    mechanisms: number;
    rigidBodyModes: number;
    internalMechanisms: number;
    spinModes: number;
    staticIndeterminacy: number;
  };
  convergence: {
    converged: boolean;
    iterations: number;
    loadFractionReached: number;
    residual: number | null;
    forceImbalance: number | null;
    momentImbalance: number | null;
  };
  /** Load multiplier at which a load-induced instability first occurs. */
  criticalLoadFactor: number | null;
  minPivot: number | null;
  maxDisplacement: number | null;
  /** Sum of the external forces on this part, N. */
  appliedForce: Vector3;
  /** Sum of its foundation reaction forces, N. */
  reactionForce: Vector3 | null;
  unstableNodeIds: string[];
  modes: AnalysisMode[];
}

export interface ConnectionResult {
  /** Relative motion across the connection in its local axes. */
  relativeMotion: Vector6;
  utilization: number | null;
  governingLimitState: string | null;
}

export interface MemberResult {
  componentId: string | null;
  parentId?: string | null;
  state: 'active' | 'slack' | 'failed' | null;
  /**
   * Section forces `[N, Vy, Vz, T, My, Mz]` in the member's local axes at
   * each end, as resultants on the face whose normal is local +x. `N` is
   * positive in tension.
   */
  forces: { start: Vector6; end: Vector6 } | null;
  /** End cuts of internal beam elements, including both sides of a mesh node. */
  stations?: readonly { fraction: number; forces: Vector6 }[];
  utilization: number | null;
  governingLimitState?: string | null;
  connections?: { start: ConnectionResult; end: ConnectionResult } | null;
}

export interface FoundationResult {
  nodeId: string;
  componentId: string | null;
  valid: boolean;
  /** Force and moment the foundation applies to the structure, global axes. */
  reaction: Vector6 | null;
}

export interface FailureEvent {
  sequence: number;
  object: 'member' | 'connection';
  memberId: string;
  end: 'start' | 'end' | null;
  limitState: string;
  utilization: number;
  action: 'memberRemoved' | 'connectionReleased';
}

export interface DetailedAnalysisResult {
  analysis: {
    solverVersion: string;
    modelVersion: string | null;
    units: 'SI';
    /** `invalid` means the input was rejected; see `diagnostics`. */
    status: 'ok' | 'invalid';
    fidelity?: 'linear' | 'nonlinear';
    loadFactor?: number;
    iterations?: number;
    reasonCodes: string[];
    diagnostics: { code: string; message: string; ids: string[] }[];
    /** Wall-clock time of the call, added by the adapter. */
    runtimeMs?: number;
  };
  components: AnalysisComponent[];
  nodes: Record<string, { componentId: string | null; displacement: Vector6 | null }>;
  members: Record<string, MemberResult>;
  foundations: Record<string, FoundationResult>;
  failureEvents: FailureEvent[];
}

/**
 * A solver for the detailed contract. Every outcome, including rejected
 * input and solver failure, is a result; `analyzeDetailed` only rejects when
 * the caller aborts.
 */
export interface DetailedSolver {
  readonly id: string;
  readonly name: string;
  analyzeDetailed(model: AnalysisModel, options?: AnalysisOptions, signal?: AbortSignal): Promise<DetailedAnalysisResult>;
}
