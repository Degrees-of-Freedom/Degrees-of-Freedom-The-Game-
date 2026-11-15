/** Verification evidence attached to each analysed component, and the
 * formulation identifiers recorded with it. Only a verified response is
 * eligible for game decisions such as scoring and capacity checks. */
/** Evidence for the small-displacement, linear-elastic Euler–Bernoulli frame only.
 * This does not certify capacity, nonlinear stability, or post-buckling response.
 * Force, length, moment and rotation units are kN, m, kN·m and radians.
 */
export interface ResponseVerification {
  formulation: 'voxel-linear-frame-v1' | 'voxel-cable-frame-v1' | typeof RELEASE_SOLVER;
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
export const RELEASE_SOLVER = 'dof-rust-0.2.0-nonlinear-1';
export function verifiedResponse(v?: ResponseVerification) {
  return v?.status === 'verified-linear' || v?.status === 'verified-cable' || v?.status === 'verified-nonlinear';
}
/** Smallest global buckling factor at which a linear response is accepted
 * as verified without a second-order analysis. */
export const minimumBucklingFactor = 10;
