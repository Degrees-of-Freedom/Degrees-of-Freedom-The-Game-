import type { ComponentStatus, DetailedAnalysisResult } from '@dof/solver-contract';

/** Overall verdict: the worst component status, or why there is none. */
export type Verdict = ComponentStatus | 'invalid' | 'empty';

export interface StructuralSummary {
  verdict: Verdict;
  /** Message for an input the solver rejected. */
  message?: string;
  components: number;
  /** Components that are unstable or unresolved. */
  failingComponents: number;
  freeDofs: number;
  mechanisms: number;
  staticIndeterminacy: number;
  /** Largest verified displacement, m; `null` when no component has results. */
  maxDisplacement: number | null;
  /** Most utilised member or connection among verified results. */
  governing: { memberId: string; utilization: number; limitState: string } | null;
  slackCables: number;
  /** A member or connection in a verified part is loaded beyond its capacity. */
  strengthExceeded: boolean;
  /** Vertical reaction per foundation in kN, positive upward; `null` when unverified. */
  reactions: { foundationId: string; nodeId: string; vertical: number | null }[];
  /** Plain-language reasons behind the statuses, without repeats. */
  reasons: string[];
  runtimeMs: number | null;
}

/** Worst first. */
const SEVERITY: ComponentStatus[] = ['unstable', 'unknown', 'marginal', 'stable'];

/** Solver reason codes in the words the panel shows. Unknown codes are shown as they are. */
const REASON_TEXT: Record<string, string> = {
  mechanism: 'Part of the structure can move without deforming.',
  unsupported: 'Part of the structure has no foundation.',
  rigidBodyMotion: 'The foundations leave the structure free to move as a whole.',
  internalMechanism: 'Members can move relative to each other.',
  loadedSpinMode: 'A moment acts on a rotation that nothing resists.',
  momentOnUnusedRotation: 'A moment acts on a joint that no member holds.',
  loadInducedInstability: 'The structure buckles under its load.',
  lowStabilityMargin: 'It is close to buckling: less than 25% load reserve.',
  nearMechanism: 'It is very nearly a mechanism.',
  excessiveDeformation: 'It only finds equilibrium after deforming excessively.',
  stabilisedByGeometry: 'It carries load only by changing shape.',
  strengthExceeded: 'A member or connection is loaded beyond its capacity.',
  recoveryFailed: 'No stable deformed shape was found for the mechanism.',
  noConvergence: 'The analysis did not converge.',
  iterationLimit: 'The analysis ran out of iterations.',
  equilibriumNotVerified: 'Equilibrium could not be verified.',
  cableStateUnresolved: 'The slack or taut state of the cables did not settle.',
  nonFinite: 'The analysis broke down numerically.',
  failureEventLimit: 'The failure sequence was cut short.',
};

const NEWTONS_PER_KILONEWTON = 1e3;

/**
 * Reduce a detailed result to what the workspace panel shows. This is
 * presentation only: every number is read from the solver's result, and
 * values the solver did not verify stay `null`.
 */
export function summarizeAnalysis(result: DetailedAnalysisResult): StructuralSummary {
  const summary: StructuralSummary = {
    verdict: 'empty',
    components: result.components.length,
    failingComponents: 0,
    freeDofs: 0,
    mechanisms: 0,
    staticIndeterminacy: 0,
    maxDisplacement: null,
    governing: null,
    slackCables: 0,
    strengthExceeded: false,
    reactions: [],
    reasons: [],
    runtimeMs: result.analysis.runtimeMs ?? null,
  };
  if (result.analysis.status === 'invalid') {
    summary.verdict = 'invalid';
    summary.message = result.analysis.diagnostics[0]?.message ?? 'The model could not be analysed.';
    return summary;
  }

  const codes = new Set<string>(result.analysis.reasonCodes);
  for (const component of result.components) {
    if (summary.verdict === 'empty' || SEVERITY.indexOf(component.status) < SEVERITY.indexOf(summary.verdict as ComponentStatus))
      summary.verdict = component.status;
    if (component.status === 'unstable' || component.status === 'unknown') summary.failingComponents += 1;
    summary.freeDofs += component.counts.freeDofs;
    summary.mechanisms += component.counts.mechanisms;
    summary.staticIndeterminacy += component.counts.staticIndeterminacy;
    summary.strengthExceeded ||= component.flags.strengthExceeded;
    if (component.maxDisplacement !== null)
      summary.maxDisplacement = Math.max(summary.maxDisplacement ?? 0, component.maxDisplacement);
    for (const code of component.reasonCodes) codes.add(code);
  }
  summary.reasons = [...codes].map((code) => REASON_TEXT[code] ?? code);

  const consider = (memberId: string, utilization: number | null | undefined, limitState: string | null | undefined) => {
    if (utilization == null || (summary.governing && summary.governing.utilization >= utilization)) return;
    summary.governing = { memberId, utilization, limitState: limitState ?? 'unknown' };
  };
  for (const [memberId, member] of Object.entries(result.members)) {
    if (member.state === 'slack') summary.slackCables += 1;
    consider(memberId, member.utilization, member.governingLimitState);
    for (const connection of Object.values(member.connections ?? {}))
      consider(memberId, connection.utilization, connection.governingLimitState);
  }

  summary.reactions = Object.entries(result.foundations)
    .map(([foundationId, foundation]) => ({
      foundationId,
      nodeId: foundation.nodeId,
      vertical: foundation.reaction ? foundation.reaction[2] / NEWTONS_PER_KILONEWTON : null,
    }))
    .sort((a, b) => a.foundationId.localeCompare(b.foundationId));
  return summary;
}
