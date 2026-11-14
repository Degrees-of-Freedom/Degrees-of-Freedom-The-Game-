/**
 * Shared structural model and solver adapter contract.
 *
 * Conventions, all of which a solver adapter must honour or reject:
 *
 * - Units are SI base units: metres, newtons, newton-metres and radians.
 * - Global Z is up. Self-weight, when requested, acts along -Z.
 * - Six-component vectors hold global translations X/Y/Z followed by global
 *   rotations X/Y/Z, or the matching forces and moments.
 * - Member local axes: X runs from the start node to the end node. Local Y is
 *   the component of the member's `orientation` vector perpendicular to X,
 *   and Z = X x Y. When `orientation` is omitted the reference is global Z,
 *   or global X for a member parallel to global Z.
 * - Nodes are joints. Two nodes at the same position are different joints,
 *   and a member end only transfers force to its node through the connection
 *   declared for that end. Geometry alone never connects anything.
 */

export type Vector3 = readonly [number, number, number];
/** Global X/Y/Z translations (or forces) followed by X/Y/Z rotations (or moments). */
export type Vector6 = readonly [number, number, number, number, number, number];

export interface StructuralNode { id: string; position: Vector3 }

/**
 * Shorthand for a member-end connection. `fixed` locks all six local axes
 * (moment connection). `pinned` locks translations and frees all rotations
 * (ball joint). `free` leaves the end unattached: it transfers nothing.
 */
export type MemberEndFixity = 'fixed' | 'pinned' | 'free';

/** Behaviour of one local axis of a connection. */
export type ConnectionLaw = 'locked' | 'free' | 'elastic';

/**
 * Six-axis connection of one member end to its node, in member local axes
 * ordered UX, UY, UZ, RX, RY, RZ.
 *
 * `locked` is an exact constraint on relative motion, not a stiff spring.
 * `free` transfers no force on that axis. `elastic` is a linear spring whose
 * stiffness must be given: N/m for translations, N·m/rad for rotations.
 */
export interface MemberEndConnection {
  laws: readonly [ConnectionLaw, ConnectionLaw, ConnectionLaw, ConnectionLaw, ConnectionLaw, ConnectionLaw];
  /** Per-axis spring stiffness. Required for every `elastic` axis; ignored on the others. */
  stiffness?: Vector6;
}

/**
 * What a member can carry. A `beam` is a beam-column: axial force, shear,
 * biaxial bending and torsion. A `brace` carries axial force only, in tension
 * and compression. A `cable` carries axial tension only and goes slack rather
 * than compress. Rotational connection laws mean nothing to braces and cables.
 */
export type MemberKind = 'beam' | 'brace' | 'cable';

/** Resolved elastic section and material properties of one member. */
export interface MemberProperties {
  /** Young's modulus E, Pa. */
  elasticModulus: number;
  /** Shear modulus G, Pa. Used by beams only. */
  shearModulus: number;
  /** Cross-section area A, m^2. */
  area: number;
  /** Second moment of area about local Y, m^4. Used by beams only. */
  inertiaY: number;
  /** Second moment of area about local Z, m^4. Used by beams only. */
  inertiaZ: number;
  /** Torsion constant J, m^4. Used by beams only. */
  torsionConstant: number;
  /** Self-weight per unit length, N/m. Used only when self-weight is requested. */
  weightPerLength?: number;
}

export interface StructuralMember {
  id: string;
  startNodeId: string;
  endNodeId: string;
  /** Defaults to `beam`. */
  kind?: MemberKind;
  /** Defaults to the solver's documented standard section when omitted. */
  properties?: MemberProperties;
  /** Reference direction for local Y; see the conventions at the top of this file. */
  orientation?: Vector3;
  /**
   * Axial strain already in the member at the reference geometry. Positive is
   * tension: the member is shorter than the distance between its nodes. This
   * is how cable pretension is expressed. Defaults to 0.
   */
  initialStrain?: number;
  /** Shorthand connection at the start node. Defaults to `fixed`. Do not combine with `startConnection`. */
  startFixity?: MemberEndFixity;
  /** Shorthand connection at the end node. Defaults to `fixed`. Do not combine with `endConnection`. */
  endFixity?: MemberEndFixity;
  /** Full six-axis connection at the start node. */
  startConnection?: MemberEndConnection;
  /** Full six-axis connection at the end node. */
  endConnection?: MemberEndConnection;
}

/** Global translations X/Y/Z followed by rotations X/Y/Z. */
export type DegreesOfFreedom = readonly [boolean, boolean, boolean, boolean, boolean, boolean];
/** A foundation: restraint of a node to ground. At most one per node. */
export interface StructuralSupport { nodeId: string; restrained: DegreesOfFreedom }
/** A persistent nodal load in global axes. */
export interface StructuralLoad { nodeId: string; force: Vector3; moment: Vector3 }

export type AnalysisFidelity = 'linear' | 'nonlinear';

export interface AnalysisOptions {
  /**
   * `linear` is a small-displacement solve for fast preview. `nonlinear` is
   * the authoritative geometrically nonlinear solve: large displacements and
   * rotations, P-Delta and member buckling, and cable slackening. Defaults to
   * `nonlinear`. Cables are tension-only at both fidelities.
   */
  fidelity?: AnalysisFidelity;
  /** Apply each member's `weightPerLength` along -Z. Defaults to false. */
  selfWeight?: boolean;
  /** Wall-clock budget in milliseconds. Work left unfinished is reported as `unknown`, never guessed. */
  timeoutMs?: number;
  /** Displacement, in metres, above which a component is flagged `excessive_deformation`. No limit when omitted. */
  displacementLimit?: number;
}

export interface StructuralModel {
  units: 'SI';
  /** Opaque model revision supplied by the caller and echoed in the result. */
  version?: string;
  nodes: StructuralNode[];
  members: StructuralMember[];
  supports: StructuralSupport[];
  loads: StructuralLoad[];
  analysis?: AnalysisOptions;
}

/**
 * Internal forces of one member. Only `axial` is signed; the other values are
 * magnitudes, so they do not depend on a local axis sign convention. Values
 * are the largest along the member.
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
  /** Cables only: whether the cable carries tension or has gone slack. */
  state?: 'active' | 'slack';
}

/**
 * One motion of the structure that meets no stiffness. `translation` modes
 * move at least one node; `rotation` modes only spin nodes in place.
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

/** Kinematic and static determinacy of a component, or of the whole model when aggregated. */
export interface StabilityReport {
  /** True when there is no mechanism and the tangent stiffness is positive definite. */
  stable: boolean;
  /** Unrestrained degrees of freedom in the analysed system. */
  freeDofs: number;
  /** Total number of independent zero-stiffness mechanisms. */
  mechanisms: number;
  translationalMechanisms: number;
  rotationalMechanisms: number;
  /** Degree of static indeterminacy (redundancy). Zero for a statically determinate, stable model. */
  staticIndeterminacy: number;
  /** Nodes that take part in a mechanism or instability mode. Empty when stable. */
  unstableNodeIds: string[];
  /** Mechanism and buckling shapes, possibly truncated; the counts above are always complete. */
  modes: MechanismMode[];
}

/**
 * Verdict on one structurally independent component.
 *
 * - `stable`: equilibrium was found and verified, and the tangent stiffness is positive definite.
 * - `marginal`: as `stable`, but stiffness is close to singular or a flagged limit was exceeded.
 * - `unstable`: verified mechanism, or verified loss of stability below the full load.
 * - `unknown`: no verified physical conclusion was reached.
 */
export type ComponentState = 'stable' | 'marginal' | 'unstable' | 'unknown';

export type ReasonCode =
  /** The component has no support restraint at all. */
  | 'unsupported_component'
  /** Supports cannot stop the whole component moving as a rigid body. */
  | 'rigid_body_mechanism'
  /** Parts of the component can move relative to each other without strain. */
  | 'internal_mechanism'
  /** Stiffness is non-zero but numerically marginal. */
  | 'near_mechanism'
  /** Tangent stiffness stopped being positive definite below the full load: buckling or a limit point. */
  | 'load_induced_instability'
  /** Singular at the reference geometry, but a verified equilibrium was found by nonlinear recovery. */
  | 'geometrically_stiffened'
  /** Displacement exceeded the requested limit. */
  | 'excessive_deformation'
  /** At least one cable is slack. A reported state, not a fault. */
  | 'cable_slack'
  /** Equilibrium iterations did not converge within the bounded attempts. */
  | 'not_converged'
  /** The time budget ran out. */
  | 'timeout'
  /** A solution was found but failed the equilibrium check. */
  | 'equilibrium_not_verified'
  /** The solver produced a non-finite number. */
  | 'non_finite_result'
  /** The solver failed unexpectedly while analysing this component. */
  | 'solver_error';

export interface ComponentResult {
  /** Stable identifier: the lexicographically smallest node id in the component. */
  id: string;
  nodeIds: string[];
  memberIds: string[];
  state: ComponentState;
  reasonCodes: ReasonCode[];
  /** True when the node, member and reaction results for this component are verified and present. */
  resultsValid: boolean;
  stability: StabilityReport;
  /** Fraction of the applied load reached, 0 to 1. For `load_induced_instability` this estimates the critical load factor. */
  loadFactor?: number;
  /** Equilibrium residual normalised by the applied load and reaction scale. Present when a solution was found. */
  residual?: number;
}

/** How the analysis was run. */
export interface AnalysisSummary {
  /** `version` of the model that was analysed, echoed back. */
  modelVersion?: string;
  fidelity: AnalysisFidelity;
  /** Solver name and version. */
  solver: string;
  runtimeMs: number;
  /** Union of the reason codes of all components. */
  reasonCodes: ReasonCode[];
}

/**
 * Result body shared by every completed analysis.
 *
 * Node, member and reaction entries exist only for components whose
 * `resultsValid` is true. An absent entry means the value is unavailable; it
 * never means zero.
 */
export interface AnalysisBody {
  analysis: AnalysisSummary;
  components: ComponentResult[];
  displacements: Record<string, Vector6>;
  /** Support reactions per supported node; unrestrained components are zero. */
  reactions: Record<string, Vector6>;
  memberForces: Record<string, MemberForces>;
  /** Stability of the whole model: counts summed over components. */
  stability: StabilityReport;
  warnings: string[];
}

export type AnalysisResult =
  /** Every component is `stable` or `marginal`. */
  | ({ status: 'success' } & AnalysisBody)
  /** At least one component is `unstable`. Other components may still hold valid results. */
  | ({ status: 'unstable'; message: string } & AnalysisBody)
  /** No component is `unstable`, but at least one is `unknown`. */
  | ({ status: 'unresolved'; message: string } & AnalysisBody)
  /** The model asks for something this solver cannot represent, or is invalid. */
  | { status: 'unsupported' | 'error'; message: string };

/** Adapters translate models to their solver and explicitly report unsupported input. */
export interface SolverAdapter { readonly id: string; readonly name: string; analyze(model: StructuralModel, signal?: AbortSignal): Promise<AnalysisResult> }
