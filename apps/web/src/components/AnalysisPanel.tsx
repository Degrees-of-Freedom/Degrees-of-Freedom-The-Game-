import type { VoxelAnalysis } from '../solver/voxel';
import { computeLoadPath } from '../solver/loadPath';
interface AnalysisPanelProps {
  result: VoxelAnalysis | null;
  message: string;
  combo: number;
  setCombo: (value: number) => void;
  deformed: boolean;
  setDeformed: (value: boolean) => void;
  scale: number;
  setScale: (value: number) => void;
  utilization: boolean;
  setUtilization: (value: boolean) => void;
  loads: boolean;
  setLoads: (value: boolean) => void;
  loadPath: boolean;
  setLoadPath: (value: boolean) => void;
  selectMember: (id: number) => void;
}
export function AnalysisPanel({
  result,
  message,
  combo,
  setCombo,
  deformed,
  setDeformed,
  scale,
  setScale,
  utilization,
  setUtilization,
  loads,
  setLoads,
  loadPath,
  setLoadPath,
  selectMember,
}: AnalysisPanelProps) {
  const path = result && loadPath ? computeLoadPath(result, combo) : null;
  return (
    <div className="analysis">
      <div className="panel-title">03 &nbsp; ANALYSIS</div>
      {message && <p role="status">{message}</p>}
      {!result ? (
        <p>
          Run the experimental analysis to see checks. Results clear when the
          model changes.
        </p>
      ) : result.error ? (
        <p role="alert">Cannot analyse: {result.error}</p>
      ) : (
        <>
          <h3>
            {result.success ? 'Checks passed' : 'Not yet passing'}{' '}
            {result.stars ? '★'.repeat(result.stars) : ''}
          </h3>
          <ul className="objectives">
            {result.objectives.map((o, i) => (
              <li key={i}>
                {o.ok ? '✓' : '✕'} {o.label}
                {o.detail && <small>{o.detail}</small>}
              </li>
            ))}
          </ul>
          <div className="stat">
            <span>Mass</span>
            <b>{result.mass?.toFixed(2)} t</b>
          </div>
          <div className="stat">
            <span>Maximum utilisation</span>
            <b>
              {result.mechanism || result.maxU === undefined
                ? '—'
                : `${(result.maxU * 100).toFixed(0)}%`}
            </b>
          </div>
          <h3>Most utilised members</h3>
          {Object.entries(result.members)
            .sort((a, b) => b[1].util - a[1].util)
            .slice(0, 8)
            .map(([id, member]) => (
              <button
                className="member-result"
                key={id}
                onClick={() => selectMember(Number(id))}
              >
                #{id} · {member.gov} <b>{(member.util * 100).toFixed(0)}%</b>
              </button>
            ))}
          <div className="view-options">
            <label>
              Load case{' '}
              <select
                value={combo}
                onChange={(e) => setCombo(Number(e.target.value))}
              >
                {['ULS wind X', 'ULS wind Y', 'SLS wind X', 'SLS wind Y'].map(
                  (name, i) => (
                    <option value={i} key={name}>
                      {name}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={deformed}
                onChange={(e) => setDeformed(e.target.checked)}
              />{' '}
              Deformed shape
            </label>
            <label>
              Scale{' '}
              <input
                type="range"
                min="0.1"
                max="3"
                step="0.1"
                value={scale}
                onChange={(e) => setScale(Number(e.target.value))}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={utilization}
                onChange={(e) => setUtilization(e.target.checked)}
              />{' '}
              Utilisation colours
            </label>
            <label>
              <input
                type="checkbox"
                checked={loadPath}
                onChange={(e) => setLoadPath(e.target.checked)}
              />{' '}
              Load path (L)
            </label>
            {path && (
              <div>
                <p>Force-weighted routes are illustrative.</p>
                {path.shares.map((share) => (
                  <div className="stat" key={share.key}>
                    <span>Support {share.key}</span>
                    <b>{(share.fraction * 100).toFixed(0)}%</b>
                  </div>
                ))}
              </div>
            )}
            <label>
              <input
                type="checkbox"
                checked={loads}
                onChange={(e) => setLoads(e.target.checked)}
              />{' '}
              Loads and reactions
            </label>
          </div>
          <p>Approximate prototype results; not for engineering design.</p>
        </>
      )}
    </div>
  );
}
