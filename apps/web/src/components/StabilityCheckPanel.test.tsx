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
    const html = renderToStaticMarkup(<StabilityCheckPanel solverName="OpenSees" onNonlinear={() => {}} check={{ phase: 'done', notes: [], result: {
      status: 'unresolved', message: 'One component did not converge', components: [
        { nodeIds: ['a'], memberIds: ['m'], result: { status: 'success', displacements: { a: [0,0,0,0,0,0] }, reactions: { a: [0,0,1000,0,0,0] }, warnings: [] } },
        { nodeIds: ['b'], memberIds: [], result: { status: 'unresolved', message: 'No equilibrium' } },
      ],
    } }} />);
    expect(html).toContain('Equilibrium unresolved');
    expect(html).toContain('Rz 1000 N');
    expect(html).toContain('Run nonlinear check');
  });
});
