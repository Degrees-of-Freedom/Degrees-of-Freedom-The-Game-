import type { VoxelAnalysis } from "../solver/voxel";
import { computeLoadPath } from "../solver/loadPath";
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
  const scopes = result?.combos[combo]?.components ?? [];
  const partial = scopes.some(s => s.status === "computed") && scopes.some(s => s.status !== "computed");
  return (
    <div className="analysis preview-analysis">
      <header className="result-header"><span className="result-eyebrow">02 · Scene preview</span><h3>Explore the response</h3><p className="result-source"><span>Source</span><strong>Approximate voxel solver</strong></p></header><p className="result-caption">These values drive the 3D overlays. They are a separate calculation from the selected structural solver.</p>
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
            {partial ? "Partial component results" : result.unresolved ? "Analysis unresolved" : result.mechanism
              ? "Unstable structure"
              : result.floating.length
                ? "Disconnected structure"
                : result.success
                  ? "Preview checks passed"
                  : "Simulation complete · review checks"}{" "}
            {result.stars ? "★".repeat(result.stars) : ""}
          </h3>
          {(result.mechanism || result.unresolved || result.floating.length > 0) && (
            <p role="status">
              {partial || result.unresolved
                ? scopes.filter(s => s.status !== "computed").map(s => `${s.memberIds.length ? "Members " + s.memberIds.join(", ") : "Nodes " + s.nodes.join(", ")} — ${s.reason}`).join(" ")
                : result.mechanism
                ? "The model has a movement that is not resisted. Add a support, brace, or connection before interpreting force results."
                : `${result.floating.length} node(s) have no connection to a support.`}
            </p>
          )}
          <details className="result-details"><summary>Model checks</summary><ul className="objectives">
            {result.objectives.map((o, i) => (
              <li key={i}>
                {o.ok ? "✓" : "✕"} {o.label}
                {o.detail && <small>{o.detail}</small>}
              </li>
            ))}
          </ul></details>
          <div className="stat">
            <span>Mass</span>
            <b>{result.mass?.toFixed(2)} t</b>
          </div>
          <div className="stat">
            <span>{partial ? "Maximum computed displacement" : "Maximum displacement"}</span>
            <b>
              {result.combos[combo]?.maxD === undefined
                ? "—"
                : `${(result.combos[combo].maxD! * 1000).toFixed(2)} mm`}
            </b>
          </div>
          <details>
            <summary>Support reactions</summary>
            <p>X, Y, Z forces in kN for the selected load case.</p>
            {Object.keys(result.found).map((key) => {
              const node = result.ctx?.idx.get(key);
              const active =
                node === undefined ? undefined : result.ctx?.aid[node];
              const reaction =
                active === undefined
                  ? undefined
                  : result.combos[combo]?.reac?.[active];
              return (
                <div className="stat" key={key}>
                  <span>{key}</span>
                  <b>
                    {reaction
                      ? `${reaction[0].toFixed(2)}, ${reaction[1].toFixed(2)}, ${reaction[2].toFixed(2)} kN`
                      : "Unavailable"}
                  </b>
                </div>
              );
            })}
          </details>
          {result.designChecksAvailable !== false && (
            <div className="stat">
              <span>Maximum utilisation</span>
              <b>
                {result.mechanism || result.maxU === undefined
                  ? "—"
                  : `${(result.maxU * 100).toFixed(0)}%`}
              </b>
            </div>
          )}
          <details className="member-forces">
            <summary>
              {result.designChecksAvailable === false
                ? "Member end forces"
                : "Most utilised members"}
            </summary>
            {result.designChecksAvailable === false && (
              <p>
                Maximum absolute axial force (N), shear component (V), and
                bending moment component (M) at either end, in member-local
                axes.
              </p>
            )}
            {Object.entries(result.members)
              .sort((a, b) => b[1].util - a[1].util)
              .slice(0, result.designChecksAvailable === false ? undefined : 8)
              .map(([id, member]) => (
                <button
                  className="member-result"
                  key={id}
                  onClick={() => selectMember(Number(id))}
                >
                  {result.designChecksAvailable === false ? (
                    (() => {
                      const force = result.combos[combo]?.ef?.get(member.e)?.f;
                      return force
                        ? `#${id} · |N| ${Math.max(Math.abs(force[0]), Math.abs(force[6])).toFixed(1)} kN · |V| ${Math.max(...[1, 2, 7, 8].map((i) => Math.abs(force[i]))).toFixed(1)} kN · |M| ${Math.max(...[4, 5, 10, 11].map((i) => Math.abs(force[i]))).toFixed(1)} kNm`
                        : `#${id} · Forces unavailable`;
                    })()
                  ) : (
                    <>
                      #{id} · {member.gov}{" "}
                      {member.gov !== "Not assessed" && <b>{(member.util * 100).toFixed(0)}%</b>}
                    </>
                  )}
                </button>
              ))}
          </details>
          {result.designChecksAvailable === false && (
            <p>
              Applied-load response includes self-weight. Capacity and buckling
              checks require design load combinations.
            </p>
          )}
          <div className="view-options"><h4>Visualize in the scene</h4><p className="result-caption">Choose a load case, then compare the shape, forces and supports.</p>
            <label>
              Load case{" "}
              <select
                value={combo}
                onChange={(e) => setCombo(Number(e.target.value))}
              >
                {result.combos.map(({ combo: loadCase }, i) => (
                  <option value={i} key={loadCase.short}>
                    {loadCase.short}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                disabled={result.mechanism || !result.combos[combo]?.u}
                checked={deformed}
                onChange={(e) => setDeformed(e.target.checked)}
              />{" "}
              Deformed shape (exaggerated)
            </label>
            <label>
              Visual amplification · {scale.toFixed(1)}×{" "}
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
                checked={utilization && result.designChecksAvailable !== false}
                disabled={result.designChecksAvailable === false}
                onChange={(e) => setUtilization(e.target.checked)}
              />{" "}
              Utilisation colours
            </label>
            <label>
              <input
                type="checkbox"
                disabled={result.mechanism}
                checked={loadPath}
                onChange={(e) => setLoadPath(e.target.checked)}
              />{" "}
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
              />{" "}
              Loads and reactions
            </label>
          </div>
          <p className="result-caption">Shape is automatically exaggerated for visibility; the slider multiplies that exaggeration. Read displacement in mm above.</p>
          <p>Approximate prototype results; not for engineering design.</p>
        </>
      )}
    </div>
  );
}
