/**
 * Translation of a checkpoint model and its system corrections into the
 * solver contract.
 *
 * The original model and the corrections stay separate layers. The corrected
 * analysis model differs from the original one in exactly two ways: released
 * rotations of beam ends that a safety restraint locks, and solver-level
 * restraint entries for joint safety restraints. Nodes, members, sections,
 * loads and player foundations are never added, removed or changed;
 * `correctionInvariantViolations` checks that.
 */

import type { AnalysisFoundation, AnalysisMember, AnalysisModel, AnalysisSection, ConnectionLaws } from '@dof/solver-contract';
import type { CheckpointMember, CheckpointModel, SafetyRestraint, SafetyRestraintTarget } from './types';

/** Solver id of the restraint entry that carries a joint's safety restraints. */
export const safetyEntryId = (nodeId: string) => `safety-restraint:${nodeId}`;
/** Nominal area of a spring's axial section; only `E·A/L` matters. */
const SPRING_AREA = 1e-4;

export function restraintId(target: SafetyRestraintTarget): string {
  return target.kind === 'rotation-end'
    ? `safety:${target.kind}:${target.memberId}:${target.end}:${target.axis}`
    : `safety:${target.kind}:${target.nodeId}:${target.axis}`;
}

function distance(model: CheckpointModel, member: CheckpointMember): number {
  const at = (id: string) => model.nodes.find(node => node.id === id)?.position;
  const a = at(member.start.nodeId), b = at(member.end.nodeId);
  return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) : NaN;
}

export interface Translation {
  /** `<revision>` or `<revision>+<restraint ids>`: the exact model analysed. */
  modelId: string;
  model: AnalysisModel;
  /** Corrections in force in this model. */
  applied: SafetyRestraint[];
  /** Corrections whose target does not exist in this model. */
  missing: SafetyRestraint[];
}

/**
 * Build the analysis model of `model` with `corrections` in force.
 *
 * A spring becomes an axial two-way bar whose section gives `E·A/L` equal to
 * the authored stiffness at the placed length, so the stiffness does not
 * change with the span. A joint that carries a player foundation is already
 * fully fixed, so a joint safety restraint there has no effect and is omitted.
 */
export function toAnalysisModel(model: CheckpointModel, corrections: readonly SafetyRestraint[]): Translation {
  const nodeIds = new Set(model.nodes.map(node => node.id));
  const membersById = new Map(model.members.map(member => [member.id, member]));
  const founded = new Set(model.foundations.map(foundation => foundation.nodeId));
  const applied: SafetyRestraint[] = [], missing: SafetyRestraint[] = [];
  const locked = new Map<string, Set<number>>();
  const held = new Map<string, boolean[]>();
  for (const correction of [...corrections].sort((a, b) => a.id.localeCompare(b.id))) {
    const target = correction.target;
    if (target.kind === 'rotation-end') {
      if (membersById.get(target.memberId)?.kind !== 'beam') { missing.push(correction); continue; }
      const key = `${target.memberId}:${target.end}`;
      locked.set(key, (locked.get(key) ?? new Set()).add(target.axis));
    } else {
      if (!nodeIds.has(target.nodeId)) { missing.push(correction); continue; }
      if (!founded.has(target.nodeId)) {
        const flags = held.get(target.nodeId) ?? Array<boolean>(6).fill(false);
        flags[(target.kind === 'rotation-joint' ? 3 : 0) + target.axis] = true;
        held.set(target.nodeId, flags);
      }
    }
    applied.push(correction);
  }

  const sections: AnalysisSection[] = model.sections.map(section => ({ ...section }));
  const members: AnalysisMember[] = model.members.map((member) => {
    const base = { id: member.id, startNodeId: member.start.nodeId, endNodeId: member.end.nodeId, ...(member.orientation && { orientation: member.orientation }) };
    if (member.kind === 'spring') {
      const length = distance(model, member);
      const sectionId = `spring:${member.id}`;
      sections.push({ id: sectionId, E: member.stiffness * length / SPRING_AREA, A: SPRING_AREA, ...(member.capacity && { capacity: member.capacity }) });
      return { ...base, kind: 'brace', sectionId };
    }
    if (member.kind === 'cable') return { ...base, kind: 'cable', sectionId: member.sectionId };
    const laws = (end: 'start' | 'end'): ConnectionLaws => {
      const extra = locked.get(`${member.id}:${end}`);
      const rotation = (axis: number) => (member[end].mask[axis] || extra?.has(axis) ? 'rigid' : 'free');
      return ['rigid', 'rigid', 'rigid', rotation(0), rotation(1), rotation(2)];
    };
    return { ...base, kind: 'beam', sectionId: member.sectionId, start: { laws: laws('start') }, end: { laws: laws('end') } };
  });
  const foundations: AnalysisFoundation[] = [
    ...model.foundations.map(({ id, nodeId }) => ({ id, nodeId, restrained: [true, true, true, true, true, true] as const })),
    ...[...held].sort(([a], [b]) => a.localeCompare(b)).map(([nodeId, flags]) => ({
      id: safetyEntryId(nodeId), nodeId,
      restrained: [flags[0], flags[1], flags[2], flags[3], flags[4], flags[5]] as const,
    })),
  ];
  const modelId = applied.length ? `${model.revision}+${applied.map(c => c.id).join('|')}` : model.revision;
  return {
    modelId, applied, missing,
    model: {
      version: modelId,
      nodes: model.nodes.map(({ id, position }) => ({ id, position })),
      sections, members, foundations,
      loads: model.loads.map(({ id, nodeId, force }) => ({ id, nodeId, force })),
    },
  };
}

/**
 * Ways in which `corrected` differs from `original` beyond what a safety
 * restraint may do. An empty list means no column, prop, member, foundation,
 * node, load or section was added, removed or altered, and no original
 * restraint was relaxed.
 */
export function correctionInvariantViolations(original: AnalysisModel, corrected: AnalysisModel): string[] {
  const problems: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (!same(original.nodes, corrected.nodes)) problems.push('nodes changed');
  if (!same(original.sections, corrected.sections)) problems.push('sections changed');
  if (!same(original.loads, corrected.loads)) problems.push('loads changed');
  if (original.members.length !== corrected.members.length) problems.push('member count changed');
  original.members.forEach((member, index) => {
    const other = corrected.members[index];
    if (!other) return;
    const strip = ({ start: _start, end: _end, ...rest }: AnalysisMember) => rest;
    if (!same(strip(member), strip(other))) problems.push(`member ${member.id} changed`);
    for (const end of ['start', 'end'] as const) {
      const before = member[end]?.laws, after = other[end]?.laws;
      if (!same(member[end]?.capacity, other[end]?.capacity)) problems.push(`member ${member.id} ${end} capacity changed`);
      for (let i = 0; i < 6; i++) {
        const was = before?.[i] ?? 'rigid', now = after?.[i] ?? 'rigid';
        // The only permitted change is a released rotation becoming rigid.
        if (!same(was, now) && !(i >= 3 && was === 'free' && now === 'rigid')) problems.push(`member ${member.id} ${end} law ${i} changed`);
      }
    }
  });
  const originalFoundations = new Map(original.foundations.map(f => [f.id, f]));
  const kept = corrected.foundations.filter(f => originalFoundations.has(f.id));
  if (kept.length !== original.foundations.length || kept.some(f => !same(f, originalFoundations.get(f.id)))) problems.push('player foundations changed');
  for (const extra of corrected.foundations.filter(f => !originalFoundations.has(f.id))) {
    if (extra.id !== safetyEntryId(extra.nodeId)) problems.push(`unexpected restraint entry ${extra.id}`);
  }
  return problems;
}
