import type { ComponentState, ReasonCode } from '@dof/solver-contract';

const REASON_TEXT: Record<ReasonCode, string> = {
  unsupported_component: 'not attached to any foundation',
  rigid_body_mechanism: 'foundations cannot stop it moving as a whole',
  internal_mechanism: 'parts can move relative to each other without straining',
  near_mechanism: 'almost a mechanism, so stiffness is marginal',
  load_induced_instability: 'buckles or loses stability before the full load',
  geometrically_stiffened: 'only stable once it deforms and the geometry stiffens it',
  excessive_deformation: 'moves more than the allowed limit',
  cable_slack: 'at least one cable goes slack',
  not_converged: 'the solver did not converge',
  timeout: 'the solver ran out of time',
  equilibrium_not_verified: 'a solution was found but failed the equilibrium check',
  non_finite_result: 'the solver produced an invalid number',
};

const STATE_TEXT: Record<ComponentState, string> = {
  stable: 'Stable',
  marginal: 'Marginal',
  unstable: 'Unstable',
  unknown: 'Unknown',
};

/** Plain-language description of a solver reason code. */
export const describeReasonCode = (code: ReasonCode): string => REASON_TEXT[code];

/** Plain-language label of a component state. */
export const describeComponentState = (state: ComponentState): string => STATE_TEXT[state];
