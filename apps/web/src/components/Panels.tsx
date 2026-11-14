import type { AnalysisResult, StructuralModel } from '@dof/solver-contract';
import type { AnalysisState } from '../game/store';
import { EXAMPLES, type ExampleStructure } from '../game/examples';

const TOOLS = [
  ['＋', 'Node', 'Place a point'],
  ['╱', 'Member', 'Connect two nodes'],
  ['△', 'Support', 'Anchor your structure'],
  ['↓', 'Load', 'Apply a force'],
] as const;

export function BuildTools({ onLoadExample }: { onLoadExample: (example: ExampleStructure) => void }) {
  return (
    <aside className="panel">
      <div className="panel-title">01 &nbsp; BUILD TOOLS</div>
      <h2>Your toolkit</h2>
      <p className="muted">Everything you need to shape your structure.</p>
      <div className="tool-list">
        {TOOLS.map(([icon, name, description]) => (
          <button disabled key={name}><b>{icon}</b><span>{name}<small>{description}</small></span>↗</button>
        ))}
      </div>
      <div className="note">
        <strong>✳ &nbsp; Coming soon</strong>
        <p>Building tools are being shaped. For now, load an example and analyse it.</p>
      </div>
      <div className="examples">
        <div className="panel-title">EXAMPLES</div>
        <div className="tool-list">
          {EXAMPLES.map((example) => (
            <button key={example.id} onClick={() => onLoadExample(example)}>
              <span>{example.name}<small>{example.description}</small></span>↗
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

const pad = (count: number) => String(count).padStart(2, '0');
const fixed = (value: number, digits: number) => (Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value).toFixed(digits);

function Stat({ name, value }: { name: string; value: string }) {
  return <div className="stat"><span>{name}</span><b>{value}</b></div>;
}

/** Headline numbers of a result. Forces in kN and displacements in mm for readability. */
function ResultSummary({ result }: { result: AnalysisResult }) {
  if (result.status !== 'success' && result.status !== 'unstable') {
    return <><strong className="verdict bad">No result</strong><p>{result.message}</p></>;
  }
  const stability = result.stability;
  const counts = stability && (
    <>
      <Stat name="Free DOFs" value={pad(stability.freeDofs)} />
      <Stat name="Mechanisms" value={pad(stability.mechanisms)} />
      <Stat name="Redundancy" value={pad(stability.staticIndeterminacy)} />
    </>
  );
  if (result.status === 'unstable') {
    return (
      <>
        <strong className="verdict bad">Unstable</strong>
        <p>{result.message}</p>
        {counts}
        <Stat name="Moving nodes" value={pad(result.stability.unstableNodeIds.length)} />
        {result.warnings.map((warning) => <p className="warning" key={warning}>{warning}</p>)}
      </>
    );
  }
  const displacement = Math.max(0, ...Object.values(result.displacements).map(([x, y, z]) => Math.hypot(x, y, z)));
  const forces = Object.values(result.memberForces ?? {});
  const tension = Math.max(0, ...forces.map((force) => force.axial));
  const compression = Math.max(0, ...forces.map((force) => -force.axial));
  const moment = Math.max(0, ...forces.map((force) => Math.max(force.momentStart, force.momentEnd)));
  return (
    <>
      <strong className="verdict good">Stable</strong>
      {counts}
      <Stat name="Max movement" value={`${fixed(displacement * 1e3, 2)} mm`} />
      <Stat name="Max tension" value={`${fixed(tension / 1e3, 1)} kN`} />
      <Stat name="Max compression" value={`${fixed(compression / 1e3, 1)} kN`} />
      <Stat name="Max moment" value={`${fixed(moment / 1e3, 1)} kN·m`} />
      {result.warnings.map((warning) => <p className="warning" key={warning}>{warning}</p>)}
    </>
  );
}

export function Inspector({ model, analysis, onRun }: { model: StructuralModel; analysis: AnalysisState; onRun: () => void }) {
  const counts = [['Nodes', model.nodes.length], ['Members', model.members.length], ['Supports', model.supports.length], ['Loads', model.loads.length]] as const;
  const running = analysis.phase === 'running';
  return (
    <aside className="panel inspector">
      <div className="panel-title">02 &nbsp; STRUCTURE</div>
      <h2>The details</h2>
      <p className="muted">A closer look at your creation.</p>
      {counts.map(([name, count]) => <Stat key={name} name={name} value={pad(count)} />)}
      <div className="analysis" aria-live="polite">
        <div className="panel-title">03 &nbsp; ANALYSIS</div>
        {analysis.phase === 'done' ? <ResultSummary result={analysis.result} /> : (
          <>
            <div className="analysis-icon">⌁</div>
            <strong>{running ? 'Analysing…' : 'Ready when you are.'}</strong>
            <p>Stability, degrees of freedom and member forces will appear here.</p>
          </>
        )}
        <button disabled={running || model.nodes.length === 0} onClick={onRun}>
          {running ? 'Analysing…' : 'Run analysis'} &nbsp; ↗
        </button>
      </div>
    </aside>
  );
}
