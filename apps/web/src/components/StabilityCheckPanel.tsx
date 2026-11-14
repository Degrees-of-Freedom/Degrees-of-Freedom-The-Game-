import type { AnalysisResult, ComponentResult } from '@dof/solver-contract';
import type { StabilityCheck } from '../game/useSolverRuns';
import { describeComponentState, describeReasonCode } from '../solver/reasonCodes';

const pad = (count: number) => String(count).padStart(2, '0');
/** Components listed individually before the rest are summarised. */
const MAX_LISTED_COMPONENTS = 5;

function Stat({ name, value }: { name: string; value: string }) {
  return (
    <div className="stat">
      <span>{name}</span>
      <b>{value}</b>
    </div>
  );
}

type Completed = Extract<AnalysisResult, { status: 'success' | 'unstable' | 'unresolved' }>;

function verdict(result: Completed): { className: string; text: string } {
  switch (result.status) {
    case 'success':
      return { className: 'verdict good', text: 'Stable' };
    case 'unstable':
      return { className: 'verdict bad', text: `Unstable. ${result.message}` };
    case 'unresolved':
      return { className: 'verdict unknown', text: `Not resolved. ${result.message}` };
  }
}

function ComponentList({ components }: { components: ComponentResult[] }) {
  // Components that are fully stable need no line; unknown counts as a problem.
  const problems = components.filter((component) => component.state !== 'stable');
  if (problems.length === 0) return null;
  return (
    <ul className="component-list">
      {problems.slice(0, MAX_LISTED_COMPONENTS).map((component) => (
        <li key={component.id}>
          <b>{describeComponentState(component.state)}</b>
          {` · ${component.nodeIds.length} nodes, ${component.memberIds.length} members`}
          {!component.resultsValid && ' · no valid results'}
          {component.reasonCodes.length > 0 && (
            <small>{component.reasonCodes.map(describeReasonCode).join('; ')}</small>
          )}
        </li>
      ))}
      {problems.length > MAX_LISTED_COMPONENTS && (
        <li>{`and ${problems.length - MAX_LISTED_COMPONENTS} more`}</li>
      )}
    </ul>
  );
}

/**
 * Stability and determinacy from the OpenSees service.
 *
 * This is independent of the voxel analysis above it: it answers whether the
 * structure can move without deforming and how many redundant load paths it
 * has, under the placed point loads. An unresolved analysis is shown as
 * unresolved, never as a pass.
 */
export function StabilityCheckPanel({ check }: { check: StabilityCheck }) {
  if (check.phase === 'idle') return null;
  if (check.phase === 'running')
    return (
      <div className="analysis stability-check">
        <h3>Degrees of freedom</h3>
        <p role="status">Checking stability with OpenSees…</p>
      </div>
    );

  const { result, notes } = check;
  if (result.status !== 'success' && result.status !== 'unstable' && result.status !== 'unresolved')
    return (
      <div className="analysis stability-check">
        <h3>Degrees of freedom</h3>
        <p>OpenSees check unavailable: {result.message}</p>
      </div>
    );

  const { className, text } = verdict(result);
  const { stability, analysis } = result;
  return (
    <div className="analysis stability-check">
      <h3>Degrees of freedom</h3>
      <p className={className}>{text}</p>
      <p>
        {analysis.fidelity === 'nonlinear' ? 'Nonlinear' : 'Linear'} analysis · {analysis.solver}
      </p>
      <Stat name="Free DOFs" value={pad(stability.freeDofs)} />
      <Stat name="Mechanisms" value={pad(stability.mechanisms)} />
      <Stat name="Redundancy" value={pad(stability.staticIndeterminacy)} />
      {result.status !== 'success' && (
        <Stat name="Moving nodes" value={pad(stability.unstableNodeIds.length)} />
      )}
      <ComponentList components={result.components} />
      {[...result.warnings, ...notes].map((line) => (
        <p className="warning" key={line}>
          {line}
        </p>
      ))}
      <p>Geometry, connections, supports and placed loads. Computed by OpenSees.</p>
    </div>
  );
}
