/** Verification evidence attached to each analysed component, and the
 * formulation identifiers recorded with it. Only a verified response is
 * eligible for game decisions such as scoring and capacity checks. */
/** Evidence for the small-displacement, linear-elastic Euler–Bernoulli frame only.
 * This does not certify capacity, nonlinear stability, or post-buckling response.
 * Force, length, moment and rotation units are kN, m, kN·m and radians.
 */
export interface ResponseVerification {
  formulation: 'voxel-linear-frame-v1' | 'voxel-cable-frame-v1' | ReleaseSolver | typeof DESIGN_FORMULATION;
  status: 'verified-linear' | 'verified-cable' | 'verified-nonlinear' | 'unverified';
  nonlinear?: { force: number; moment: number; residual: number };
  reason?: string;
  residuals?: {
    force: number;
    moment: number;
    nodalBalance: number;
    memberLaw: number;
    compatibility: number;
    releasedAction: number;
  };
}

export const LINEAR_FORMULATION = 'voxel-linear-frame-v1';
export const CABLE_FORMULATION = 'voxel-cable-frame-v1';
/** Rust solver versions whose nonlinear results the release accepts. 0.3.0
 * adds a sparse factorisation for large structures and keeps 0.2.0's
 * skyline below about 4e6 multiply-adds of factor work, which covers every
 * release structure: there its result documents are byte-identical to
 * 0.2.0's (scripts/physics/compare-solver-revisions.mjs, docs/kb/rust-solver.md). */
export const RELEASE_SOLVER_VERSIONS = ['0.2.0', '0.3.0'] as const;
/** Formulation id written by this build into new evidence and saves. */
export const RELEASE_SOLVER = 'dof-rust-0.3.0-nonlinear-1';
/** Formulation ids a saved release or Rust playtest match may carry. A
 * record keeps the id of the solver that produced it. */
export const RELEASE_SOLVERS = ['dof-rust-0.2.0-nonlinear-1', RELEASE_SOLVER] as const;
export type ReleaseSolver = (typeof RELEASE_SOLVERS)[number];
export function isReleaseSolver(id: unknown): id is ReleaseSolver {
  return (RELEASE_SOLVERS as readonly unknown[]).includes(id);
}
/** Identity of the release numerics inside a stored instability comparison.
 * Turns compare witnesses only under the same identity, so it changes only
 * when release-sized results change, not with the solver's version number:
 * matches saved under 0.2.0 keep comparing with turns played under 0.3.0. */
export const RELEASE_COMPARISON = 'dof-rust-0.2.0-nonlinear-1';
/** Editor and level evaluation: nonlinear Rust load combinations with the
 * stability reserve search (see `engine/rustDesign.ts`). */
export const DESIGN_FORMULATION = 'dof-rust-design-1';
export function verifiedResponse(v?: ResponseVerification) {
  return v?.status === 'verified-linear' || v?.status === 'verified-cable' || v?.status === 'verified-nonlinear';
}
/** Smallest global buckling factor at which a linear response is accepted
 * as verified without a second-order analysis. */
export const minimumBucklingFactor = 10;
