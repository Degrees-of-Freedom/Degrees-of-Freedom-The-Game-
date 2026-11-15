import type { StabilityCheck } from '../game/useStabilityCheck';
import type { ComponentAnalysis } from '@dof/solver-contract';

const pad = (count: number) => String(count).padStart(2, '0');

function Stat({ name, value }: { name: string; value: string }) {
  return (
    <div className="stat">
      <span>{name}</span>
      <b>{value}</b>
    </div>
  );
}

function ComponentResponses({ scopes }: { scopes: ComponentAnalysis[] }) {
  const solved = scopes.filter(s => s.result.status === 'success').length;
  return <section aria-label="OpenSees component results">
    <p>{solved} of {scopes.length} connected components returned a response.</p>
    <ul>{scopes.map(({nodeIds, memberIds, result}) =>
      <li key={nodeIds[0]}>
        <b>{memberIds.length ? 'Members ' + memberIds.join(', ') : 'Node ' + nodeIds[0]}</b>
        {result.status === 'success' ? <>
          <span> · {result.nonlinear ? 'Nonlinear equilibrium' : 'Linear equilibrium'}</span>
          {Object.entries(result.reactions ?? {}).map(([id, force]) =>
            <div key={id}>Support {id} · Rz {Number(force[2].toPrecision(6))} N</div>)}
          <span>Peak translation {Math.max(...Object.values(result.displacements)
            .map(d => Math.hypot(d[0], d[1], d[2]))).toPrecision(3)} m</span>
        </> : <span> · {result.status}. {result.message} Physical response unavailable.</span>}
      </li>
    )}</ul>
  </section>;
}

/**
 * Kinematic stability and determinacy from the OpenSees service.
 *
 * This is independent of the voxel analysis above it: it looks only at
 * geometry, connections and supports, and answers whether the structure can
 * move without deforming and how many redundant load paths it has.
 */
export function StabilityCheckPanel({ check, onNonlinear }: { check: StabilityCheck; onNonlinear: () => void }) {
  if (check.phase === 'idle') return null;
  if (check.phase === 'running')
    return (
      <div className="analysis stability-check">
        <h3>Degrees of freedom</h3>
        <p role="status">Checking stability with OpenSees…</p>
      </div>
    );

  const { result, notes } = check;
  if (result.status !== 'success' && result.status !== 'unstable')
    return (
      <div className="analysis stability-check">
        <h3>Degrees of freedom</h3>
        <p>{result.status === 'unresolved' ? 'Equilibrium unresolved' : 'OpenSees check unavailable'}. {result.message}</p>
        {result.components && <ComponentResponses scopes={result.components} />}
        <button className="btn" onClick={onNonlinear}>Run nonlinear check</button>
      </div>
    );

  const stability = result.stability;
  return (
    <div className="analysis stability-check">
      <h3>{result.status === 'success' && result.nonlinear ? 'Nonlinear response' : 'Degrees of freedom'}</h3>
      <p className={result.status === 'unstable' ? 'verdict bad' : 'verdict good'}>
        {result.status === 'unstable' ? `Unstable. ${result.message}` : 'Stable'}
      </p>
      {stability && (
        <>
          <Stat name="Free DOFs" value={pad(stability.freeDofs)} />
          <Stat name="Mechanisms" value={pad(stability.mechanisms)} />
          <Stat name="Redundancy" value={pad(stability.staticIndeterminacy)} />
          {result.status === 'unstable' && (
            <Stat name="Moving nodes" value={pad(stability.unstableNodeIds.length)} />
          )}
        </>
      )}
      {result.status === 'success' && result.nonlinear && (
        <p>Normalized force residual {result.nonlinear.forceResidual.toExponential(2)} · moment residual {result.nonlinear.momentResidual.toExponential(2)}.</p>
      )}
      {result.components && <ComponentResponses scopes={result.components} />}
      {[...result.warnings, ...notes].map((text) => (
        <p className="warning" key={text}>
          {text}
        </p>
      ))}
      <p>Computed by OpenSees.</p>
      <button className="btn" onClick={onNonlinear}>Run nonlinear check</button>
    </div>
  );
}
