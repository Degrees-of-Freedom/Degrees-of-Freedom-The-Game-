/**
 * Contracts of the checkpoint service (session 2).
 *
 * The service owns scheduled structural analysis, replay of pending turns,
 * penalty attribution and minimum local correction. It owns no deck, turn or
 * UI state: the domain supplies models and ordered turns through the adapters
 * below, and stores what the service returns.
 *
 * Units are SI throughout (metres, newtons, newton-metres), as in
 * `@dof/solver-contract`. Every record here is plain JSON and deterministic
 * for a given request, so it can be persisted and compared.
 */

import type { AnalysisOptions, AnalysisSection, ComponentStatus, DetailedSolver, Vector3 } from '@dof/solver-contract';

export const CHECKPOINT_SERVICE_VERSION = '1';
/** MR02: analysis every three globally completed player turns unless changed. */
export const DEFAULT_SOLVE_EVERY_TURNS = 3;
/**
 * Supported range of `solveEveryTurns`. The criteria leave the bounds open;
 * this range is this session's proposal and is the only place it is defined.
 */
export const SOLVE_EVERY_TURNS_RANGE = { min: 1, max: 12 } as const;

// ---------------------------------------------------------------------------
// Model supplied by the domain
// ---------------------------------------------------------------------------

/**
 * Restrained rotations of one member end, about the member's local x, y, z
 * axes (the solver-contract convention: x runs start to end, z is the part of
 * `orientation` perpendicular to x, y = z × x). `true` is restrained. This is
 * the ORIGINAL player mask; the service never changes it. Translations are
 * always compatible (MR07) and are not part of the mask.
 */
export type RotationMask = readonly [boolean, boolean, boolean];

export interface CheckpointMemberEnd {
  nodeId: string;
  mask: RotationMask;
}

interface MemberBase {
  id: string;
  ownerId: string;
  /** Turn that placed the member; `null` for setup objects. */
  originTurnId: string | null;
  start: CheckpointMemberEnd;
  end: CheckpointMemberEnd;
  orientation?: Vector3;
}

export type CheckpointMember =
  /** Beam-column, or a tension-only cable. Cable masks carry no moment. */
  | (MemberBase & { kind: 'beam' | 'cable'; sectionId: string })
  /** Axial spring with an authored stiffness in N/m (0.25 k₀ or 0.5 k₀). */
  | (MemberBase & { kind: 'spring'; stiffness: number; capacity?: { tension?: number; compression?: number } });

/** A player's default foundation: always fully fixed and immutable (MR09). */
export interface CheckpointFoundation {
  id: string;
  nodeId: string;
  ownerId: string;
}

export interface CheckpointLoad {
  id: string;
  nodeId: string;
  /** Global force, N. */
  force: Vector3;
  ownerId: string;
  originTurnId: string | null;
}

/** The ORIGINAL live structure at one revision, without system corrections. */
export interface CheckpointModel {
  /** Identifier of this committed state; equal revisions mean equal models. */
  revision: string;
  nodes: readonly { id: string; position: Vector3 }[];
  sections: readonly AnalysisSection[];
  members: readonly CheckpointMember[];
  foundations: readonly CheckpointFoundation[];
  loads: readonly CheckpointLoad[];
}

// ---------------------------------------------------------------------------
// Adapters injected by the integrator
// ---------------------------------------------------------------------------

/** One successfully committed player turn. A pass is a turn. */
export interface OrderedTurn {
  turnId: string;
  /** Global count of committed turns, starting at 1. */
  turnNumber: number;
  playerId: string;
  /** Revision of the live model after this turn; unchanged by a pass. */
  revision: string;
}

export interface OrderedTurnAdapter {
  /** Turns with `afterTurn < turnNumber <= throughTurn`, in order. */
  turnsInWindow(afterTurn: number, throughTurn: number, signal: AbortSignal): Promise<readonly OrderedTurn[]> | readonly OrderedTurn[];
}

export interface ModelAdapter {
  /** The original live model at a revision. Must not include corrections. */
  modelAt(revision: string, signal: AbortSignal): Promise<CheckpointModel> | CheckpointModel;
}

export interface CheckpointServiceConfig {
  solver: DetailedSolver;
  /**
   * Whether `solver` is production physics. A test double or a diagnostic
   * backend must pass `false`: its results are then never marked verified and
   * the schedule will not record them as a verified checkpoint.
   */
  authoritative: boolean;
  turns: OrderedTurnAdapter;
  models: ModelAdapter;
  /** Solver options for every solve of a checkpoint. Gravity enables self-weight. */
  options?: AnalysisOptions;
  /** Unit vector of "down" for gravity totals and shares. Default `[0, 0, -1]`. */
  down?: Vector3;
  limits?: Partial<CheckpointLimits>;
  tolerances?: Partial<CheckpointTolerances>;
}

export interface CheckpointLimits {
  /** Most solver calls in one checkpoint; the rest of the window stays pending. */
  maxSolves: number;
  /** Most safety restraints added for one replayed turn. */
  maxRestraintsPerTurn: number;
}

export interface CheckpointTolerances {
  /** A utilisation above `1 + overload` is an overload. */
  overload: number;
  /** Relative rise of an existing overload that counts as worsened. */
  worsened: number;
  /** Allowed force imbalance of a component, relative to its applied force. */
  equilibrium: number;
}

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

export type Axis = 0 | 1 | 2;

/**
 * The only corrections the service can express. There is deliberately no
 * variant for a member, a foundation, a load change or a section change.
 */
export type SafetyRestraintTarget =
  /** Lock a released rotation of a beam end, about a member-local axis. */
  | { kind: 'rotation-end'; memberId: string; end: 'start' | 'end'; axis: Axis }
  /** Hold a joint's rotation about a global axis. */
  | { kind: 'rotation-joint'; nodeId: string; axis: Axis }
  /** Hold a joint's translation along a global axis. Only when required (MR11). */
  | { kind: 'translation-joint'; nodeId: string; axis: Axis };

/** A system correction. Stored as its own layer, never merged into a player mask. */
export interface SafetyRestraint {
  /** Permanent and derived from the target, so one target is restrained once. */
  id: string;
  eventId: string;
  target: SafetyRestraintTarget;
  frame: 'member-local' | 'global';
  reason: 'instability' | 'overload';
  originTurnId: string;
  originPlayerId: string;
  checkpointId: string;
  /** Model revision the restraint was verified against. */
  revision: string;
  permanent: true;
}

/**
 * What a safety restraint carries in the corrected model. For a joint
 * restraint this is the reaction it applies to the structure; for a locked
 * member end it is the moment the end transmits about the locked axis. It is
 * part of the corrected model's equilibrium and is never a player's score.
 */
export interface SafetyRestraintReaction {
  restraintId: string;
  value: number | null;
  unit: 'N' | 'N·m';
  validity: 'verified' | 'unavailable';
  scored: false;
}

// ---------------------------------------------------------------------------
// Request and result
// ---------------------------------------------------------------------------

export interface CheckpointWindow {
  /** Turn number of the baseline: the last verified checkpoint, or 0. */
  afterTurn: number;
  throughTurn: number;
  /** Revision of the live model at `afterTurn`. */
  baselineRevision: string;
  /** Interval and setting version in force when the checkpoint became due. */
  solveEveryTurns: number;
  settingVersion: number;
}

export interface CheckpointRequest {
  requestId: string;
  matchId: string;
  /** Stable for one `throughTurn`, so a due and a final checkpoint coincide. */
  checkpointId: string;
  reason: 'interval' | 'final';
  /** True when the interval was also due; a final checkpoint then covers both. */
  dueByInterval: boolean;
  window: CheckpointWindow;
  rulesVersion: string;
  /** Corrections of earlier checkpoints; they stay in force. */
  corrections: readonly SafetyRestraint[];
  /** Penalties already recorded; a turn that has one is never charged again. */
  penalties: readonly PenaltyRecord[];
  /** All players, for the final score. */
  playerIds: readonly string[];
}

export interface IssueRecord {
  kind: 'instability' | 'overload';
  change: 'new' | 'worsened';
  /** `member:<id>`, `connection:<id>:<end>` or `component:<first member or node>`. */
  key: string;
  memberIds: string[];
  nodeIds: string[];
  /** Mechanism count or utilisation, before (null when absent) and after. */
  before: number | null;
  after: number;
}

export interface PenaltyRecord {
  eventId: string;
  checkpointId: string;
  /** The responsible ORIGINAL turn and its player, not the checkpoint player. */
  turnId: string;
  turnNumber: number;
  playerId: string;
  points: 1;
  issues: IssueRecord[];
  /** Revision judged, and the corrected model it was compared in. */
  revision: string;
  modelId: string;
}

export interface UnresolvedScope {
  eventId: string;
  turnId: string | null;
  code:
    | 'unknown-component'
    | 'instability-not-corrected'
    | 'overload-not-corrected'
    | 'correction-target-missing'
    | 'equilibrium-not-verified'
    | 'solver-failed'
    | 'work-limit'
    | 'turn-window-mismatch';
  memberIds: string[];
  nodeIds: string[];
  detail: string;
}

export interface ReplayStep {
  turnId: string;
  turnNumber: number;
  playerId: string;
  revision: string;
  /** Corrected replay model judged for this turn; null when nothing was solved. */
  modelId: string | null;
  /**
   * `verified`: compared against a known baseline. `unchanged-model`: a pass,
   * nothing to solve. `unknown`: evidence was missing, so no blame is possible.
   */
  evidence: 'verified' | 'unchanged-model' | 'unknown';
  issues: IssueRecord[];
  penaltyEventId: string | null;
  /** True when a penalty for this turn was already on record. */
  penaltyAlreadyRecorded: boolean;
  addedRestraintIds: string[];
}

export interface ComponentSummary {
  id: string;
  status: ComponentStatus;
  /** Stable or marginal, with valid results and checked equilibrium. */
  verified: boolean;
  reasonCodes: string[];
  memberIds: string[];
  nodeIds: string[];
  /** Applied force along `down`, N: this component's part of W. */
  gravity: number;
}

export interface PlayerScore {
  playerId: string;
  /** Upward reaction of the player's foundation in verified components, N. */
  attraction: number | null;
  sharePercent: number | null;
  penaltyPoints: number;
  /** `sharePercent - penaltyPoints`; null when the share is unavailable. */
  score: number | null;
}

export interface FinalScore {
  eventId: string;
  /**
   * `verified`: every component verified. `verified-components-only`: the
   * fallback, with unverified parts contributing nothing to any player while
   * W stays the total. `unavailable`: no verified component or no gravity.
   */
  validity: 'verified' | 'verified-components-only' | 'unavailable';
  /** W in newtons; null when the final model could not be analysed. */
  totalGravity: number | null;
  players: PlayerScore[];
}

export interface CurrentState {
  /** Live revision the state describes, and the corrected model analysed. */
  revision: string;
  turnNumber: number;
  modelId: string;
  /** The analysed model is the corrected replay branch, not the live model. */
  lineage: 'retrospectively-corrected';
  components: ComponentSummary[];
  foundations: { foundationId: string; ownerId: string; componentId: string | null; reaction: readonly number[] | null; verified: boolean }[];
  safetyReactions: SafetyRestraintReaction[];
  /** W: total applied gravity over all components, verified or not. */
  totalGravity: number;
}

export interface CheckpointEvent {
  eventId: string;
  type: 'checkpoint.penalty' | 'checkpoint.correction' | 'checkpoint.unresolved' | 'checkpoint.completed' | 'match.finalized';
  checkpointId: string;
  requestId: string;
  turnId: string | null;
  actorId: string | null;
  revision: string | null;
}

export interface CheckpointResult {
  format: 'dof-checkpoint-result';
  schemaVersion: 1;
  requestId: string;
  matchId: string;
  checkpointId: string;
  reason: 'interval' | 'final';
  dueByInterval: boolean;
  window: CheckpointWindow;
  /**
   * `completed`: the whole window was replayed. `partial`: replay stopped
   * early and later turns stay pending. `failed`: nothing was established.
   * `cancelled`: aborted; nothing in it is authoritative and a retry starts over.
   */
  status: 'completed' | 'partial' | 'failed' | 'cancelled';
  /** Copied from the service configuration. */
  authoritative: boolean;
  /** `completed` and `authoritative`. Only this marks a verified checkpoint. */
  verified: boolean;
  provenance: { serviceVersion: string; rulesVersion: string; solverId: string; solverVersion: string | null; options: AnalysisOptions };
  settledThroughTurn: number;
  unsettledTurnIds: string[];
  steps: ReplayStep[];
  /** New in this checkpoint. */
  penalties: PenaltyRecord[];
  corrections: SafetyRestraint[];
  /** Earlier and new corrections in force for `current`. */
  activeCorrections: SafetyRestraint[];
  unresolved: UnresolvedScope[];
  /** Null when no model could be analysed. */
  current: CurrentState | null;
  /** Present for a final checkpoint. */
  final: FinalScore | null;
  events: CheckpointEvent[];
  solverCalls: number;
}

export interface CheckpointService {
  /**
   * Run one checkpoint. Resolves with a result for every outcome, including
   * cancellation. Repeating a request returns the same result: a run in
   * flight is shared and a completed one is remembered.
   */
  run(request: CheckpointRequest, init?: { signal?: AbortSignal }): Promise<CheckpointResult>;
  /** Abort the run of one checkpoint, or every run. Late results are discarded. */
  cancel(checkpointId?: string): void;
}
