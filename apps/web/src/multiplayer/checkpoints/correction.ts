/**
 * Minimum local correction of one replayed state.
 *
 * "Minimum" is a documented deterministic search over a bounded local
 * candidate set, not a proof of a globally smallest edit:
 *
 * 1. Stability first, then strength. Each phase adds one restraint at a time
 *    and keeps a candidate only if a full solve shows it helps.
 * 2. Candidates come in three tiers, and a later tier is consulted only when
 *    the earlier one has nothing left that helps:
 *    `rotation-end` (lock a released rotation of a beam end), then
 *    `rotation-joint` (hold a joint's rotation), then `translation-joint`
 *    (hold a joint's translation, the system-only restraint of MR11).
 * 3. Candidates are limited to the diagnosed scope: the unstable components,
 *    or the joints of the overloaded members. Joints that move in the
 *    reported mechanism shapes are tried first; ties break by id.
 * 4. Once the goal is reached, every added restraint is removed again on
 *    trial, newest first, and stays removed if the goal still holds. What
 *    remains is irreducible: no single restraint can be dropped.
 * 5. Every acceptance is a complete solve of the whole corrected model, so
 *    stability, equilibrium, compatibility and capacities are checked on the
 *    full affected structure, not on a local patch.
 *
 * If a phase cannot reach its goal, its restraints are discarded and the
 * scope is reported unresolved. Nothing else is ever tried: no member,
 * foundation, load change or section upgrade exists in the candidate set.
 */

import type { Vector3 } from '@dof/solver-contract';
import type { StepIssues } from './issues';
import { restraintId } from './model';
import type { Axis, CheckpointLimits, CheckpointModel, SafetyRestraint, SafetyRestraintTarget, UnresolvedScope } from './types';

/** A solved state, as the correction search sees it. */
export interface SolvedState {
  failed: boolean;
  issues: StepIssues;
}

export interface CorrectionEnvironment<S extends SolvedState> {
  model: CheckpointModel;
  /** Corrections already in force. */
  corrections: readonly SafetyRestraint[];
  /** Solve the model with the given corrections. May throw to stop the run. */
  evaluate(corrections: readonly SafetyRestraint[]): Promise<S>;
  make(target: SafetyRestraintTarget, reason: SafetyRestraint['reason']): SafetyRestraint;
  limits: CheckpointLimits;
  down: Vector3;
}

export interface CorrectionOutcome<S extends SolvedState> {
  added: SafetyRestraint[];
  /** The state with `added` in force; the start state when nothing was added. */
  solved: S;
  unresolved: Pick<UnresolvedScope, 'code' | 'memberIds' | 'nodeIds' | 'detail'>[];
}

interface Measure { mechanisms: number; unknown: number; overloads: number; peak: number; failed: boolean }

function measure(state: SolvedState): Measure {
  const { components, overloads } = state.issues;
  return {
    failed: state.failed,
    mechanisms: components.reduce((sum, c) => sum + c.mechanisms, 0),
    unknown: components.filter(c => c.state === 'unknown').length,
    overloads: overloads.length,
    peak: overloads.reduce((peak, o) => Math.max(peak, o.utilization), 0),
  };
}

const TIERS = ['rotation-end', 'rotation-joint', 'translation-joint'] as const;
const AXES: Axis[] = [0, 1, 2];

interface Scope {
  memberIds: Set<string>;
  nodeIds: Set<string>;
  /** Larger means the joint or axis is tried earlier. */
  weight(nodeId: string, component: number): number;
}

function instabilityScope(state: SolvedState): Scope {
  const memberIds = new Set<string>(), nodeIds = new Set<string>();
  const amplitude = new Map<string, number>();
  for (const issue of state.issues.components) {
    if (issue.state !== 'unstable') continue;
    issue.component.memberIds.forEach(id => memberIds.add(id));
    issue.component.nodeIds.forEach(id => nodeIds.add(id));
    for (const mode of issue.component.modes) {
      for (const [nodeId, shape] of Object.entries(mode.displacements)) {
        shape.forEach((value, component) => {
          const key = `${nodeId}:${component}`;
          amplitude.set(key, Math.max(amplitude.get(key) ?? 0, Math.abs(value)));
        });
      }
    }
  }
  return { memberIds, nodeIds, weight: (nodeId, component) => amplitude.get(`${nodeId}:${component}`) ?? 0 };
}

function overloadScope(state: SolvedState, model: CheckpointModel, down: Vector3): Scope {
  const nodeIds = new Set(state.issues.overloads.flatMap(o => o.nodeIds));
  const memberIds = new Set(model.members.filter(m => nodeIds.has(m.start.nodeId) || nodeIds.has(m.end.nodeId)).map(m => m.id));
  // Along gravity first: that is where a held joint relieves a member most.
  return { memberIds, nodeIds, weight: (_nodeId, component) => (component < 3 ? Math.abs(down[component]) : 0) };
}

function candidates(tier: typeof TIERS[number], scope: Scope, model: CheckpointModel, taken: Set<string>): SafetyRestraintTarget[] {
  const founded = new Set(model.foundations.map(f => f.nodeId));
  const ranked: { target: SafetyRestraintTarget; weight: number }[] = [];
  if (tier === 'rotation-end') {
    for (const member of model.members) {
      if (member.kind !== 'beam' || !scope.memberIds.has(member.id)) continue;
      for (const end of ['start', 'end'] as const) {
        if (!scope.nodeIds.has(member[end].nodeId)) continue;
        for (const axis of AXES) {
          if (member[end].mask[axis]) continue;
          const moves = Math.max(...[0, 1, 2, 3, 4, 5].map(component => scope.weight(member[end].nodeId, component)));
          ranked.push({ target: { kind: tier, memberId: member.id, end, axis }, weight: moves });
        }
      }
    }
  } else {
    const offset = tier === 'rotation-joint' ? 3 : 0;
    for (const nodeId of scope.nodeIds) {
      if (founded.has(nodeId)) continue;
      for (const axis of AXES) ranked.push({ target: { kind: tier, nodeId, axis }, weight: scope.weight(nodeId, offset + axis) });
    }
  }
  return ranked
    .filter(({ target }) => !taken.has(restraintId(target)))
    .sort((a, b) => b.weight - a.weight || restraintId(a.target).localeCompare(restraintId(b.target)))
    .map(({ target }) => target);
}

/** Find and verify the restraints one replayed state needs. See the file comment. */
export async function correct<S extends SolvedState>(start: S, env: CorrectionEnvironment<S>): Promise<CorrectionOutcome<S>> {
  const origin = measure(start);
  const unresolved: CorrectionOutcome<S>['unresolved'] = [];
  let added: SafetyRestraint[] = [];
  let solved = start;

  /** Add restraints until `goal` holds; restore the entry state if it cannot. */
  async function phase(
    reason: SafetyRestraint['reason'],
    scopeOf: (state: S) => Scope,
    goal: (m: Measure) => boolean,
    improves: (m: Measure, current: Measure) => boolean,
    takeFirst: boolean,
  ): Promise<boolean> {
    const entry = { added, solved };
    const mine: SafetyRestraint[] = [];
    for (const tier of TIERS) {
      while (!goal(measure(solved)) && mine.length < env.limits.maxRestraintsPerTurn) {
        const current = measure(solved);
        const taken = new Set([...env.corrections, ...added].map(c => c.id));
        let best: { restraint: SafetyRestraint; state: S; measure: Measure } | undefined;
        for (const target of candidates(tier, scopeOf(solved), env.model, taken)) {
          const restraint = env.make(target, reason);
          const state = await env.evaluate([...env.corrections, ...added, restraint]);
          const m = measure(state);
          if (!improves(m, current)) continue;
          if (!best || m.overloads < best.measure.overloads || (m.overloads === best.measure.overloads && m.peak < best.measure.peak)) best = { restraint, state, measure: m };
          if (takeFirst || goal(m)) break;
        }
        if (!best) break;
        mine.push(best.restraint);
        added = [...added, best.restraint];
        solved = best.state;
      }
      if (goal(measure(solved))) break;
    }
    if (!goal(measure(solved))) {
      ({ added, solved } = entry);
      return false;
    }
    // Drop every restraint the goal does not need, newest (highest tier) first.
    for (const restraint of [...mine].reverse()) {
      const without = added.filter(c => c !== restraint);
      const state = await env.evaluate([...env.corrections, ...without]);
      if (goal(measure(state))) { added = without; solved = state; }
    }
    return true;
  }

  const sound = (m: Measure) => !m.failed && m.unknown <= origin.unknown;
  if (origin.mechanisms > 0) {
    const scope = instabilityScope(start);
    const stable = await phase(
      'instability', instabilityScope,
      m => sound(m) && m.mechanisms === 0,
      (m, current) => sound(m) && m.mechanisms < current.mechanisms,
      true,
    );
    if (!stable) {
      unresolved.push({
        code: 'instability-not-corrected', memberIds: [...scope.memberIds].sort(), nodeIds: [...scope.nodeIds].sort(),
        detail: 'No permitted set of local safety restraints within the work limit gave a verified stable structure. The move is kept.',
      });
    }
  }
  if (measure(solved).mechanisms === 0 && measure(solved).overloads > 0) {
    const scope = overloadScope(solved, env.model, env.down);
    const strong = await phase(
      'overload', state => overloadScope(state, env.model, env.down),
      m => sound(m) && m.mechanisms === 0 && m.overloads === 0,
      (m, current) => sound(m) && m.mechanisms === 0 && (m.overloads < current.overloads || (m.overloads === current.overloads && m.peak < current.peak * (1 - 1e-9))),
      false,
    );
    if (!strong) {
      unresolved.push({
        code: 'overload-not-corrected', memberIds: [...scope.memberIds].sort(), nodeIds: [...scope.nodeIds].sort(),
        detail: 'No permitted set of local safety restraints within the work limit removed the overload. Sections are not upgraded; the move is kept.',
      });
    }
  }
  return { added, solved, unresolved };
}
