import type { AnalysisResult, ComponentResult, DetailedAnalysisResult } from '@dof/solver-contract';
import { describeComponentState, describeReasonCode } from '../solver/reasonCodes';
import { summarizeAnalysis, type Verdict } from '../game/structuralSummary';
import type { StabilityCheck } from '../game/useStabilityCheck';

const pad = (count: number) => String(count);
/** Components listed individually before the rest are summarised. */
const MAX_LISTED_COMPONENTS = 5;

function Stat({ name, value }: { name: string; value: string }) {
  return (
    <div className="result-metric">
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
      return { className: 'verdict unknown', text: `Equilibrium unresolved. ${result.message}` };
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

/** Consistent provenance for completed, pending and unavailable checks. */
function ResultHeader({ solverName }: { solverName: string }) {
  return <header className="result-header">
    <span className="result-eyebrow">01 · Structural analysis</span>
    <h3>Structure response</h3>
    <p className="result-source"><span>Active solver</span><strong>{solverName}</strong></p>
  </header>;
}

const VERDICT_TEXT: Record<Verdict, string> = {
  stable: 'Stable',
  marginal: 'Marginal',
  unstable: 'Unstable',
  unknown: 'Unresolved',
  invalid: 'Not analysed',
  empty: 'Nothing to analyse',
};

/** Foundations listed before the rest are summarised in one line. */
const MAX_REACTIONS = 8;

/** Each connected part, with the verified support reactions of the valid ones. */
function ComponentResponses({ result }: { result: Completed }) {
  const solved = result.components.filter((component) => component.resultsValid).length;
  return <section aria-label="OpenSees component results">
    <p>{solved} of {result.components.length} connected components returned a verified response.</p>
    <ul>{result.components.map((component) =>
      <li key={component.id}>
        <b>{component.memberIds.length ? 'Members ' + component.memberIds.join(', ') : 'Node ' + component.nodeIds[0]}</b>
        {component.resultsValid ? <>
          <span> · {result.analysis.fidelity === 'nonlinear' ? 'Nonlinear equilibrium' : 'Linear equilibrium'}</span>
          {component.nodeIds.filter((id) => result.reactions[id]).map((id) =>
            <div key={id}>Support {id} · Rz {Number(result.reactions[id][2].toPrecision(6))} N</div>)}
        </> : <span> · {describeComponentState(component.state)}. Physical response unavailable.</span>}
      </li>
    )}</ul>
  </section>;
}

/**
 * Result of the detailed contract: card sections, tension-only cables,
 * self-weight and nonlinear analysis, with a status per connected part.
 * Unverified values are shown as unavailable, never as zero.
 */
function DetailedCheck({ result, notes, solverName }: { result: DetailedAnalysisResult; notes: string[]; solverName: string }) {
  const summary = summarizeAnalysis(result);
  // Strength does not change the solver's stability status, but a structure
  // with an overloaded member must not be presented as a pass.
  const good = summary.verdict === 'stable' && !summary.strengthExceeded;
  const shown = summary.reactions.slice(0, MAX_REACTIONS);
  return (
    <div className="analysis stability-check">
      <ResultHeader solverName={solverName} />
      <p className={good ? 'verdict good' : summary.verdict === 'unstable' || summary.strengthExceeded ? 'verdict bad' : 'verdict unknown'} role="status">
        {VERDICT_TEXT[summary.verdict]}
        {summary.verdict === 'stable' && summary.strengthExceeded && ', but overstressed'}
        {summary.message && `. ${summary.message}`}
        {summary.components > 1 && summary.failingComponents > 0 &&
          ` (${summary.failingComponents} of ${summary.components} separate parts)`}
      </p>
      {summary.reasons.map((text) => (
        <p className="warning" key={text}>
          {text}
        </p>
      ))}
      {summary.components > 0 && (
        <>
          <div className="result-metrics"><Stat name="Separate parts" value={pad(summary.components)} />
          <Stat name="Free DOFs" value={pad(summary.freeDofs)} />
          <Stat name="Mechanisms" value={pad(summary.mechanisms)} />
          <Stat name="Redundancy" value={pad(summary.staticIndeterminacy)} />
          <Stat
            name="Peak movement"
            value={summary.maxDisplacement === null ? 'unavailable' : `${(summary.maxDisplacement * 1e3).toFixed(1)} mm`}
          />
          <Stat
            name="Capacity use"
            value={
              summary.governing
                ? `${Math.round(summary.governing.utilization * 100)}%`
                : 'unavailable'
            }
          />
          {summary.slackCables > 0 && <Stat name="Slack cables" value={pad(summary.slackCables)} />}
          </div>
          {summary.governing && <p className="result-caption">Governing member {summary.governing.memberId} · {summary.governing.limitState.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}</p>}
          <p className="result-caption">Free DOFs are movements to solve; mechanisms have no resisting stiffness. Redundancy counts extra restraints.</p>
          <p className="result-caption">Capacity use: 100% is the reported limit. Unavailable means no verified value, not zero.</p>
          <details className="result-details" open><summary>Support reactions · {summary.reactions.length}</summary>
          <p>Vertical force at each foundation. Upward reactions resist gravity; uplift indicates a hold-down demand.</p>
          {shown.map((reaction) => (
            <Stat
              key={reaction.foundationId}
              name={`Foundation ${reaction.nodeId}`}
              value={
                reaction.vertical === null
                  ? 'unavailable'
                  : `${Math.abs(reaction.vertical).toFixed(1)} kN ${reaction.vertical < 0 ? 'uplift' : 'up'}`
              }
            />
          ))}
          {summary.reactions.length > shown.length && (
            <p>{summary.reactions.length - shown.length} more foundations not listed.</p>
          )}
          {shown.length === 0 && <p>No foundation reactions reported.</p>}
          </details>
        </>
      )}
      {notes.map((text) => (
        <p key={text}>{text}</p>
      ))}
      <p>
        {result.analysis.fidelity === 'linear' ? 'Linear' : result.analysis.fidelity === 'nonlinear' ? 'Nonlinear' : 'Structural'} analysis · computed by {solverName}
        {summary.runtimeMs !== null && ` in ${Math.round(summary.runtimeMs)} ms`}.
      </p>
    </div>
  );
}

/**
 * The contract-solver check, beside the voxel analysis and independent of it.
 *
 * A solver for the detailed contract gives the structural check above. Any
 * other solver gives kinematic stability and determinacy only: whether the
 * structure can move without deforming and how many redundant load paths it
 * has, from geometry, connections and supports.
 */
export function StabilityCheckPanel({
  check,
  solverName,
  onNonlinear,
}: {
  check: StabilityCheck;
  solverName: string;
  onNonlinear?: () => void;
}) {
  const nonlinearControl = onNonlinear && <button className="btn" onClick={onNonlinear}>Run nonlinear check</button>;
  if (check.phase === 'idle') return <section className="analysis stability-check"><ResultHeader solverName={solverName} /><p className="result-empty">Run simulation to check this structure. Editing the model or changing solver clears the previous check.</p>{nonlinearControl}</section>;
  if (check.phase === 'running')
    return (
      <div className="analysis stability-check">
        <ResultHeader solverName={solverName} />
        <p role="status">Checking the structure with {solverName}…</p>
      </div>
    );
  if (check.phase === 'detailed')
    return <DetailedCheck result={check.result} notes={check.notes} solverName={solverName} />;

  const { result, notes } = check;
  if (result.status !== 'success' && result.status !== 'unstable' && result.status !== 'unresolved')
    return (
      <div className="analysis stability-check">
        <ResultHeader solverName={solverName} />
        <p>
          {solverName} check unavailable: {result.message}
        </p>
        {notes.map(note => <p key={note}>{note}</p>)}
        {nonlinearControl}
      </div>
    );

  const { className, text } = verdict(result);
  const { stability, analysis } = result;
  return (
    <div className="analysis stability-check">
      <ResultHeader solverName={solverName} />
      <p className={className}>{text}</p>
      <p>
        {analysis.fidelity === 'nonlinear' ? 'Nonlinear' : 'Linear'} analysis · {analysis.solver}
      </p>
      <div className="result-metrics">
        <Stat name="Free DOFs" value={pad(stability.freeDofs)} />
        <Stat name="Mechanisms" value={pad(stability.mechanisms)} />
        <Stat name="Redundancy" value={pad(stability.staticIndeterminacy)} />
        {result.status !== 'success' && (
          <Stat name="Moving nodes" value={pad(stability.unstableNodeIds.length)} />
        )}
      </div>
      {result.nonlinear && (
        <p>Normalized force residual {result.nonlinear.forceResidual.toExponential(2)} · moment residual {result.nonlinear.momentResidual.toExponential(2)}.</p>
      )}
      <ComponentList components={result.components} />
      {result.components.length > 1 || result.status === 'unresolved' ? <ComponentResponses result={result} /> : null}
      {[...result.warnings, ...notes].map((line) => (
        <p className="warning" key={line}>
          {line}
        </p>
      ))}
      <p>{result.status === 'success' && result.nonlinear ? 'Nonlinear equilibrium' : 'Geometry, connections and supports only'}. Computed by {solverName}.</p>
      {nonlinearControl}
    </div>
  );
}
