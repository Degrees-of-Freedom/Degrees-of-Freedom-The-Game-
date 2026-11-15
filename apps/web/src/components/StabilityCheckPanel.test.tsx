import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StabilityCheckPanel } from './StabilityCheckPanel';

describe('OpenSees nonlinear controls', () => {
  it('offers the nonlinear check only when a handler is supplied', () => {
    const idle = { phase: 'idle' } as const;
    expect(renderToStaticMarkup(<StabilityCheckPanel check={idle} solverName="OpenSees" onNonlinear={() => {}} />)).toContain('Run nonlinear check');
    expect(renderToStaticMarkup(<StabilityCheckPanel check={idle} solverName="Rust" />)).not.toContain('Run nonlinear check');
  });
  it('retains computed component reactions when overall equilibrium is unresolved', () => {
    // Contract v2: components carry their state; results exist only for valid ones.
    const stability = { stable: true, freeDofs: 6, mechanisms: 0, translationalMechanisms: 0, rotationalMechanisms: 0, staticIndeterminacy: 0, unstableNodeIds: [], modes: [] };
    const html = renderToStaticMarkup(<StabilityCheckPanel solverName="OpenSees" onNonlinear={() => {}} check={{ phase: 'done', notes: [], result: {
      status: 'unresolved', message: 'One component did not converge',
      analysis: { fidelity: 'nonlinear', solver: 'OpenSees', runtimeMs: 1, reasonCodes: ['not_converged'] },
      components: [
        { id: 'a', nodeIds: ['a'], memberIds: ['m'], state: 'stable', reasonCodes: [], resultsValid: true, stability },
        { id: 'b', nodeIds: ['b'], memberIds: [], state: 'unknown', reasonCodes: ['not_converged'], resultsValid: false, stability: { ...stability, stable: false } },
      ],
      displacements: { a: [0, 0, 0, 0, 0, 0] }, reactions: { a: [0, 0, 1000, 0, 0, 0] }, memberForces: {},
      stability, warnings: [],
    } }} />);
    expect(html).toContain('Equilibrium unresolved');
    expect(html).toContain('Rz 1000 N');
    expect(html).toContain('Run nonlinear check');
  });
});
