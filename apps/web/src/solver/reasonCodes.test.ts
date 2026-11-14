import { describe, expect, it } from 'vitest';
import type { ReasonCode } from '@dof/solver-contract';
import { describeComponentState, describeReasonCode } from './reasonCodes';

describe('reason code wording', () => {
  it('describes every reason code in words rather than echoing the code', () => {
    const codes: ReasonCode[] = [
      'unsupported_component', 'rigid_body_mechanism', 'internal_mechanism', 'near_mechanism',
      'load_induced_instability', 'geometrically_stiffened', 'excessive_deformation', 'cable_slack',
      'not_converged', 'timeout', 'equilibrium_not_verified', 'non_finite_result',
    ];
    const texts = codes.map(describeReasonCode);
    expect(new Set(texts).size).toBe(codes.length);
    for (const text of texts) expect(text).not.toContain('_');
  });

  it('labels component states', () => {
    expect(describeComponentState('unknown')).toBe('Unknown');
    expect(describeComponentState('unstable')).toBe('Unstable');
  });
});
