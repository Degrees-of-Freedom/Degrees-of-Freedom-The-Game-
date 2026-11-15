import type { VoxelMember } from './voxelInput';
import type { Section } from './voxelSections';
import type { LinearVerification } from './voxelVerification';
export type Element = {
  m: VoxelMember;
  it: Section;
  L: number;
  R: number[][];
  ex: number[];
  a: number;
  b: number;
  k: Float64Array;
  rel: number[];
  kgl: Float64Array;
  dofs: number[];
  cable: boolean;
  rigidA: boolean;
  rigidB: boolean;
};
export type Context = {
  keys: string[];
  pos: number[][];
  act: number[];
  NA: number;
  eq: Int32Array;
  nf: number;
  els: Element[];
  bw: number;
  isF: boolean[];
  idx: Map<string, number>;
  aid: Int32Array;
};
export type FrameSystem = Pick<Context, 'nf' | 'NA' | 'eq' | 'els' | 'bw'>;
export interface ComponentResponse {
  /** Analytical identities. Coincident loose ends can belong to different components. */
  nodes: string[];
  memberIds: number[];
  /** Computed identifies an experimental response. A physical verification policy
   * must independently accept this scope before it is eligible for game scoring. */
  status: 'computed' | 'unsupported' | 'mechanism' | 'unresolved' | 'excessive-displacement';
  reason?: string;
  /** Absence means there is no verified response. This evidence only covers the declared linear formulation. */
  verification?: LinearVerification;
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
};
export type Solved = {
  u: Float64Array;
  K0: Float64Array;
  activeDofs: number[];
  active: Map<Element, boolean>;
  ef: Map<Element, ElementForce>;
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
/** Prototype analysis in kN and metres. Results are approximate and not engineering design. */
export interface VoxelAnalysis {
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
  time?: number;
}
