import type { StabilityCheck } from '../game/useStabilityCheck';

const pad = (count: number) => String(count).padStart(2, '0');

function Stat({ name, value }: { name: string; value: string }) {
  return (
    <div className="stat">
      <span>{name}</span>
      <b>{value}</b>
    </div>
  );
}

/**
 * Kinematic stability and determinacy from the shared-contract solver.
 *
 * This is independent of the voxel analysis above it: it looks only at
 * geometry, connections and supports, and answers whether the structure can
 * move without deforming and how many redundant load paths it has.
 */
export function StabilityCheckPanel({
  check,
  solverName,
}: {
  check: StabilityCheck;
  solverName: string;
}) {
  if (check.phase === 'idle') return null;
  if (check.phase === 'running')
    return (
      <div className="analysis stability-check">
        <h3>Degrees of freedom</h3>
        <p role="status">Checking stability with {solverName}…</p>
      </div>
    );

  const { result, notes } = check;
  if (result.status !== 'success' && result.status !== 'unstable')
    return (
      <div className="analysis stability-check">
        <h3>Degrees of freedom</h3>
        <p>
          {solverName} check unavailable: {result.message}
        </p>
      </div>
    );

  const stability = result.stability;
  return (
    <div className="analysis stability-check">
      <h3>Degrees of freedom</h3>
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
      {[...result.warnings, ...notes].map((text) => (
        <p className="warning" key={text}>
          {text}
        </p>
      ))}
      <p>Geometry, connections and supports only. Computed by {solverName}.</p>
    </div>
  );
}
