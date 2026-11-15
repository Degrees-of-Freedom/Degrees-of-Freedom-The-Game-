/**
 * Eligible issues of one analysed model, and their comparison across two
 * consecutive replay states.
 *
 * Two issue kinds can cost a point: a verified unstable component and a
 * verified strength overload. A `marginal` component is stable and is not an
 * issue. A component the solver could not classify is unknown evidence: it
 * is reported, never blamed on anyone.
 */

import type { AnalysisComponent, DetailedAnalysisResult } from '@dof/solver-contract';
import type { CheckpointTolerances, IssueRecord } from './types';

export interface ComponentIssue {
  component: AnalysisComponent;
  state: 'ok' | 'unstable' | 'unknown';
  /** Independent mechanisms and spins of an unstable component, at least one. */
  mechanisms: number;
  /** The solver gave results, but this module's own force balance check failed. */
  equilibriumFailed: boolean;
}

/**
 * Independent check of a solved component: the solver reports convergence,
 * and all its restraint reactions (player foundations and safety restraints
 * together) balance the applied force within the tolerance.
 */
export function equilibriumVerified(component: AnalysisComponent, tolerances: CheckpointTolerances): boolean {
  const { appliedForce, reactionForce, convergence } = component;
  if (!reactionForce || !convergence.converged) return false;
  const imbalance = Math.hypot(...appliedForce.map((force, axis) => force + reactionForce[axis]));
  return imbalance <= tolerances.equilibrium * Math.max(1, Math.hypot(...appliedForce));
}

export interface Overload {
  key: string;
  memberId: string;
  utilization: number;
  nodeIds: string[];
}

export interface StepIssues {
  components: ComponentIssue[];
  /** Component of every member, for matching across states. */
  byMember: Map<string, ComponentIssue>;
  /** Utilisation of every member and connection that has a verified value. */
  utilization: Map<string, number>;
  overloads: Overload[];
}

export function readIssues(result: DetailedAnalysisResult, tolerances: CheckpointTolerances, memberNodes: (memberId: string) => string[]): StepIssues {
  const components = result.components.map((component): ComponentIssue => {
    const balanced = equilibriumVerified(component, tolerances);
    const state = component.status === 'unstable' ? 'unstable'
      : component.status === 'unknown' || !component.resultsValid || !balanced ? 'unknown' : 'ok';
    return { component, state, equilibriumFailed: state === 'unknown' && component.resultsValid && !balanced, mechanisms: state === 'unstable' ? Math.max(1, component.counts.mechanisms + component.counts.spinModes) : 0 };
  });
  const byMember = new Map<string, ComponentIssue>();
  for (const issue of components) for (const id of issue.component.memberIds) byMember.set(id, issue);
  const utilization = new Map<string, number>(), overloads: Overload[] = [];
  const note = (key: string, memberId: string, value: number | null | undefined) => {
    if (typeof value !== 'number') return;
    utilization.set(key, value);
    if (value > 1 + tolerances.overload) overloads.push({ key, memberId, utilization: value, nodeIds: memberNodes(memberId) });
  };
  for (const memberId of Object.keys(result.members).sort()) {
    const member = result.members[memberId];
    if (byMember.get(memberId)?.state !== 'ok') continue;
    note(`member:${memberId}`, memberId, member.utilization);
    note(`connection:${memberId}:start`, memberId, member.connections?.start.utilization);
    note(`connection:${memberId}:end`, memberId, member.connections?.end.utilization);
  }
  return { components, byMember, utilization, overloads };
}

/** Whether a state has anything a correction could address. */
export const hasIssues = (issues: StepIssues) => issues.overloads.length > 0 || issues.components.some(c => c.state === 'unstable');

/** A value that changes whenever the set or size of issues changes. */
export function issueSignature(issues: StepIssues): string {
  return JSON.stringify([
    issues.components.filter(c => c.state !== 'ok').map(c => [c.state, c.mechanisms, c.component.memberIds, c.component.nodeIds]),
    issues.overloads.map(o => o.key),
  ]);
}

export interface Attribution {
  /** Verified new or worsened issues. */
  issues: IssueRecord[];
  /** Scopes where blame could not be established either way. */
  unknown: { memberIds: string[]; nodeIds: string[]; detail: string }[];
}

/**
 * Issues of `after` that are new or worse than in `before`, the explicit
 * baseline of the preceding replay state. An issue that was already present
 * and has not grown is not repeated. Where the baseline of a scope is
 * unknown, nothing is attributed.
 */
export function attribute(before: StepIssues | null, after: StepIssues, tolerances: CheckpointTolerances): Attribution {
  const issues: IssueRecord[] = [], unknown: Attribution['unknown'] = [];
  for (const current of after.components) {
    const { memberIds, nodeIds } = current.component;
    if (current.state === 'unknown') {
      unknown.push({ memberIds, nodeIds, detail: `Component could not be classified (${current.component.reasonCodes.join(', ') || 'no reason given'}).` });
      continue;
    }
    if (current.state !== 'unstable') continue;
    if (!before) { unknown.push({ memberIds, nodeIds, detail: 'No baseline to compare an unstable component with.' }); continue; }
    const earlier = new Set(memberIds.map(id => before.byMember.get(id)).filter((c): c is ComponentIssue => !!c));
    if ([...earlier].some(c => c.state === 'unknown')) { unknown.push({ memberIds, nodeIds, detail: 'The baseline of this component is unknown.' }); continue; }
    const previous = [...earlier].reduce((sum, c) => sum + c.mechanisms, 0);
    if (current.mechanisms > previous) {
      issues.push({
        kind: 'instability', change: previous === 0 ? 'new' : 'worsened',
        key: `component:${[...memberIds].sort()[0] ?? [...nodeIds].sort()[0] ?? current.component.id}`,
        memberIds, nodeIds, before: previous === 0 ? null : previous, after: current.mechanisms,
      });
    }
  }
  for (const overload of after.overloads) {
    const scope = { memberIds: [overload.memberId], nodeIds: overload.nodeIds };
    if (!before) { unknown.push({ ...scope, detail: 'No baseline to compare an overload with.' }); continue; }
    const earlier = before.byMember.get(overload.memberId);
    const previous = before.utilization.get(overload.key);
    if (earlier && earlier.state !== 'ok') { unknown.push({ ...scope, detail: 'The baseline forces of this member are unavailable.' }); continue; }
    const wasOverloaded = previous !== undefined && previous > 1 + tolerances.overload;
    if (!wasOverloaded) issues.push({ kind: 'overload', change: 'new', key: overload.key, ...scope, before: previous ?? null, after: overload.utilization });
    else if (overload.utilization > previous * (1 + tolerances.worsened)) issues.push({ kind: 'overload', change: 'worsened', key: overload.key, ...scope, before: previous, after: overload.utilization });
  }
  return { issues, unknown };
}
