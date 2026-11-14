import type { RunState } from '../game/useSolverRuns';
import type { SolverDescriptor, SolverId, SolverVerdict } from '../game/solvers';

const VERDICT_TEXT: Record<SolverVerdict, string> = {
  stable: 'Stable',
  unstable: 'Unstable',
  unresolved: 'Not resolved',
  unavailable: 'Unavailable',
};

const formatMs = (value: number | null) => (value === null ? '—' : value >= 100 ? value.toFixed(0) : value.toFixed(1));

/**
 * Side-by-side record of the solvers that have run on the current model.
 * Timings are single runs on this machine: compute is the solver's own
 * measurement, wall includes the network round trip for remote solvers.
 */
export function SolverRunsPanel({
  solvers,
  runs,
  reasons,
}: {
  solvers: readonly SolverDescriptor[];
  runs: Readonly<Record<SolverId, RunState>>;
  /** Why each unavailable solver cannot run on the current model. */
  reasons: Readonly<Record<SolverId, string | null>>;
}) {
  if (Object.keys(runs).length === 0) return null;
  return (
    <div className="analysis solver-runs">
      <h3>Solver comparison</h3>
      <table>
        <thead>
          <tr>
            <th>Solver</th>
            <th>Verdict</th>
            <th>Compute ms</th>
            <th>Wall ms</th>
          </tr>
        </thead>
        <tbody>
          {solvers.map((solver) => {
            const state = runs[solver.id];
            const reason = reasons[solver.id];
            if (!state)
              return (
                <tr key={solver.id}>
                  <td>{solver.label}</td>
                  <td colSpan={3}>{reason ? `Unavailable · ${reason}` : 'Not run'}</td>
                </tr>
              );
            if (state.phase === 'running')
              return (
                <tr key={solver.id}>
                  <td>{solver.label}</td>
                  <td colSpan={3} role="status">Running…</td>
                </tr>
              );
            const { run } = state;
            return (
              <tr key={solver.id}>
                <td>{solver.label}</td>
                <td className={`verdict-${run.verdict}`} title={run.message}>
                  {VERDICT_TEXT[run.verdict]}
                  {run.verdict !== 'stable' && <small>{run.message}</small>}
                </td>
                <td>{formatMs(run.computeMs)}</td>
                <td>{run.wallMs === 0 ? '—' : formatMs(run.wallMs)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p>
        Single runs on this machine, not benchmarks. Compute is the solver's own time; wall time also
        includes the network round trip for remote solvers.
      </p>
    </div>
  );
}
