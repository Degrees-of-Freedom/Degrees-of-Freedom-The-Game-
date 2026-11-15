import type { EvaluatorMember } from './model';
import type { Section } from './sections';
import type { ResponseVerification } from './evidence';
/** One analysed member: its axes and end fixity, in the active-node
 * numbering of its `Context`. Engines attach responses to these objects. */
export type Element = {
  m: EvaluatorMember;
  it: Section;
  /** Undeformed length, m. */
  L: number;
  /** Rows are the local x, y and z axes in global coordinates. */
  R: number[][];
  ex: number[];
  a: number;
  b: number;
  cable: boolean;
  rigidA: boolean;
  rigidB: boolean;
};
/** Shared analytical numbering (see `geometry.ts`). `act` lists the node
 * index of each active (supported) node; `aid` is the inverse. */
export type Context = {
  keys: string[];
  pos: number[][];
  act: number[];
  NA: number;
  els: Element[];
  isF: boolean[];
  idx: Map<string, number>;
  aid: Int32Array;
};
export interface ComponentResponse {
  /** Analytical identities. Coincident loose ends can belong to different components. */
  nodes: string[];
  memberIds: number[];
  /** Computed identifies an experimental response. A physical verification policy
   * must independently accept this scope before it is eligible for game scoring. */
  status: 'computed' | 'unsupported' | 'mechanism' | 'unresolved' | 'excessive-displacement';
  reason?: string;
  /** Absence means there is no verified response. This evidence only covers the declared linear formulation. */
  verification?: ResponseVerification;
  instabilityWitness?: { memberIds: number[]; nodes: string[]; reason: string;
    comparison?: {topology: string; negativePivots: number; mechanisms: number} };
  /** Normalized vectors reported by the kernel. Diagnostic motion is separate
   * from an equilibrium displacement, including when no equilibrium exists. */
  diagnosticModes?: { kind: 'mechanism' | 'spin' | 'buckling'; displacements: Record<string, readonly number[]> }[];
  /** A converged large displacement is independent of tangent instability. */
  excessiveDeformation?: boolean;
}
export type Demand = {
  Nt: number;
  Nc: number;
  Vy: number;
  Vz: number;
  My: number;
  Mz: number;
  endF: number[];
  endM: number[];
  dEIy: number;
  dEIz: number;
  dmax: number;
};
export type ElementForce = {
  f: Float64Array;
  ul: Float64Array;
  slack?: boolean;
  /** Magnitude along the actual deformed chord, in kN. End vectors remain in the reference frame. */
  cableTension?: number;
  /** Positive-face section cuts from the nonlinear beam mesh, kN and kN m. */
  stations?: { fraction: number; forces: number[] }[];
  /** Global translations and rotation vectors at the physical mesh ends. */
  motionSamples?: { fraction: number; motion: readonly number[] }[];
  /** Signed vertical transfer toward the segment end, under joint gravity. */
  verticalTransferKN?: number;
  /** Section-force envelope over the member's stations from an engine that
   * reports cut forces (kN, kN m): it already includes member loads and
   * second-order effects, so design demand uses it without corrections.
   * `Nt` is the largest tension and `Nc` the largest compression, both >= 0. */
  envelope?: { Nt: number; Nc: number; Vy: number; Vz: number; My: number; Mz: number };
  /** Largest deflection of a beam from the chord through its deformed ends, m. */
  sag?: number;
};
export type LoadCombo = {
  name: string;
  short: string;
  type: 'ULS' | 'SLS';
  dir: number[];
};
export type Combo = {
  combo: LoadCombo;
  F: Float64Array;
  vis: { a: number; v: number[]; kind: string }[];
  fail?: boolean;
  u?: Float64Array;
  /** Populated only for partial solutions. An absent node has no computed displacement. */
  partialDisplacements?: Map<number, Float64Array>;
  components?: ComponentResponse[];
  ef?: Map<Element, ElementForce>;
  active?: Map<Element, boolean>;
  reac?: Record<number, Float64Array>;
  maxD?: number;
};
/** Six global components (m, rad) in the active-node numbering of the analysis. */
export function displacementAt(combo: Combo | undefined, active: number): Float64Array | undefined {
  if (!combo || active < 0) return undefined;
  if (combo.u && 6 * active < combo.u.length) return combo.u.subarray(6 * active, 6 * active + 6);
  return combo.partialDisplacements?.get(active);
}
/** Evaluation of a structure under a level, in kN and metres: the engine's
 * response per load combination, plus design checks, objectives and score.
 * Game-level checks only; not engineering design. */
export interface StructureEvaluation {
  /** Complete SI topology sent to the kernel, including unsupported/floating
   * pieces omitted from the separate equilibrium-assembly context. */
  diagnosticGeometry?: {
    positions: Record<string, readonly [number, number, number]>;
    segments: {memberId: number; a: string; b: string}[];
  };
  reference?: {modelVersion: string; solverVersion: string; fidelity: 'nonlinear'};
  /** Total physical card gravity, including unavailable components, kN. */
  appliedGravityKN?: number;
  /** Turn projection of analytical submembers onto their playable card, including unsolved regions. */
  physicalParents?: ReadonlyMap<number, number>;
  error?: string;
  mechanism: boolean;
  /** A supported component exceeded the numerical solver's available scope. */
  unresolved?: boolean;
  /** Strength and stability checks require the factored design combinations. */
  designChecksAvailable?: boolean;
  floating: string[];
  unstable: Set<string>;
  objectives: { ok: boolean; label: string; detail: string; warn?: boolean }[];
  members: Record<
    number,
    {
      e: Element;
      util: number;
      gov: string;
      slack: boolean;
      checks: Record<string, number>;
      demand: Demand;
    }
  >;
  found: Record<
    string,
    { util: number; r: Float64Array | null; locked: boolean }
  >;
  combos: Combo[];
  nodes: Record<string, never>;
  ctx?: Context;
  alpha?: (number | null)[];
  amp?: number;
  avgU?: number;
  failing?: number;
  connMax?: number;
  foundMax?: number;
  topZ?: number;
  success?: boolean;
  cost?: number;
  mass?: number;
  stars?: number;
  maxU?: number;
  alphaMin?: number;
  /** Load factor below 1 at which a design combination buckles: a
   * load-induced instability with no verified response at full load. */
  bucklingFactor?: number;
  /** Why `unresolved` is set, when the engine can say more than "unresolved". */
  unresolvedReason?: string;
  /** Forces come from a geometrically nonlinear analysis (P-Δ included). */
  secondOrder?: boolean;
  time?: number;
}

/** Which engine produced an evaluation, in words for the results panel. */
export function evaluationSource(result: StructureEvaluation | null | undefined): string {
  if (result?.secondOrder) return 'Structure evaluator · Rust solver';
  if (result?.reference?.fidelity === 'nonlinear') return 'Rust solver (scored release)';
  return 'Approximate voxel solver';
}
