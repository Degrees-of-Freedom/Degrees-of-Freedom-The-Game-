import type { DetailedAnalysisResult } from '@dof/solver-contract';
import { summarizeAnalysis, type Verdict } from '../game/structuralSummary';
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

/**
 * Result of the detailed contract: card sections, tension-only cables,
 * self-weight and nonlinear analysis, with a status per connected part.
 * Unverified values are shown as unavailable, never as zero.
 */
function DetailedCheck({ result, notes, solverName }: { result: DetailedAnalysisResult; notes: string[]; solverName: string }) {
  const summary = summarizeAnalysis(result);
  const good = summary.verdict === 'stable';
  const shown = summary.reactions.slice(0, MAX_REACTIONS);
  return (
    <div className="analysis stability-check">
      <h3>Structural check</h3>
      <p className={good ? 'verdict good' : 'verdict bad'}>
        {VERDICT_TEXT[summary.verdict]}
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
          <Stat name="Separate parts" value={pad(summary.components)} />
          <Stat name="Free DOFs" value={pad(summary.freeDofs)} />
          <Stat name="Mechanisms" value={pad(summary.mechanisms)} />
          <Stat name="Redundancy" value={pad(summary.staticIndeterminacy)} />
          <Stat
            name="Largest movement"
            value={summary.maxDisplacement === null ? 'unavailable' : `${(summary.maxDisplacement * 1e3).toFixed(1)} mm`}
          />
          <Stat
            name="Highest utilisation"
            value={
              summary.governing
                ? `${Math.round(summary.governing.utilization * 100)}% · member ${summary.governing.memberId} · ${summary.governing.limitState}`
                : 'unavailable'
            }
          />
          {summary.slackCables > 0 && <Stat name="Slack cables" value={pad(summary.slackCables)} />}
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
        </>
      )}
      {notes.map((text) => (
        <p key={text}>{text}</p>
      ))}
      <p>
        Nonlinear analysis with card sections and tension-only cables. Computed by {solverName}
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
}: {
  check: StabilityCheck;
  solverName: string;
}) {
  if (check.phase === 'idle') return null;
  if (check.phase === 'running')
    return (
      <div className="analysis stability-check">
        <h3>Structural check</h3>
        <p role="status">Checking the structure with {solverName}…</p>
      </div>
    );
  if (check.phase === 'detailed')
    return <DetailedCheck result={check.result} notes={check.notes} solverName={solverName} />;

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
