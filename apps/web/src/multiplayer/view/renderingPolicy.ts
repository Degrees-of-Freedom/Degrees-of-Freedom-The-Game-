import { buildPrimaryFlow, type FlowSegmentEvidence, type PrimaryFlowResult } from './flow';
import type { MemberView, MultiplayerViewData, Vec3 } from './types';

const forceTolerance = 1e-8;
const pointTolerance = 1e-7;
interface SpanInterval { readonly start: number; readonly end: number }
const finite = (point: Vec3): boolean => point.every(Number.isFinite);
const distanceSquared = (a: Vec3, b: Vec3): number => a.reduce((sum, value, axis) => sum + (value - b[axis]) ** 2, 0);

/**
 * Resolve explicit endpoint IDs only. Quarter joint aliases must be authored as
 * port.nodeId or supplied in data.joints and referenced by segment evidence;
 * geometric coincidence alone never creates a new connection. Conflicting
 * positions for one identity are omitted instead of silently choosing a value.
 */
export function sceneFlowPositions(data: MultiplayerViewData): ReadonlyMap<string, Vec3> {
  const positions = new Map<string, Vec3>();
  const conflicts = new Set<string>();
  const add = (id: string, point: Vec3): void => {
    if (!id || conflicts.has(id)) return;
    const old = positions.get(id);
    if (!finite(point) || old && distanceSquared(old, point) > pointTolerance ** 2) {
      conflicts.add(id); positions.delete(id); return;
    }
    positions.set(id, point);
  };
  for (const joint of data.joints) add(joint.id, joint.position);
  for (const member of data.members) {
    add(member.startNode, member.start); add(member.endNode, member.end);
    for (const port of member.quarterPorts) {
      add(port.id, port.position);
      if (port.nodeId) add(port.nodeId, port.position);
    }
  }
  return positions;
}

function spanParameter(member: MemberView, point: Vec3): number | null {
  if (!finite(member.start) || !finite(member.end) || !finite(point)) return null;
  const lengthSquared = distanceSquared(member.start, member.end);
  if (!(lengthSquared > pointTolerance ** 2)) return null;
  const t = point.reduce((sum, value, axis) => sum + (value - member.start[axis]) * (member.end[axis] - member.start[axis]), 0) / lengthSquared;
  if (t < -pointTolerance || t > 1 + pointTolerance) return null;
  const projected: Vec3 = [
    member.start[0] + t * (member.end[0] - member.start[0]),
    member.start[1] + t * (member.end[1] - member.start[1]),
    member.start[2] + t * (member.end[2] - member.start[2]),
  ];
  return distanceSquared(projected, point) <= pointTolerance ** 2 * Math.max(1, lengthSquared) ? Math.max(0, Math.min(1, t)) : null;
}

/**
 * Apply presentation scope checks before harmonic interpretation. Valid analytical
 * subdivisions remain separate, including quarter-node aliases. Positive-length
 * overlap is invalid scope: a whole-member result and a split result cannot both
 * contribute arrows or graph conductance. Shared adjacent endpoints are allowed.
 * Results never
 * fall back to a fabricated whole-member action. Unknown/missing segment coverage
 * is represented by invalid placeholders, making the affected component ambiguous.
 * A valid selected-load scope must still provide all member segments (zero actions
 * included); intentionally omitted evidence is not interpreted as zero.
 *
 * Cable compression is invalid diagnostic evidence, never a normal animated path.
 * Callers should report it from the original checkpoint's signed axial data; this
 * returned flow intentionally marks it unknown and therefore non-directional.
 */
export function sceneFlow(data: MultiplayerViewData): PrimaryFlowResult {
  const checkpoint = data.checkpoint;
  if (!checkpoint) return buildPrimaryFlow({ modelRevision: data.revision, segments: [], sources: [], supports: [] });
  const positions = sceneFlowPositions(data);
  const members = new Map(data.members.map(member => [member.id, member]));
  const memberCounts = new Map<string, number>();
  for (const member of data.members) memberCounts.set(member.id, (memberCounts.get(member.id) ?? 0) + 1);
  const segmentCounts = new Map<string, number>();
  for (const segment of checkpoint.segments) segmentCounts.set(segment.id, (segmentCounts.get(segment.id) ?? 0) + 1);
  const intervals = new Map<string, SpanInterval[]>();
  const incompleteMembers = new Set<string>();
  const normalized: FlowSegmentEvidence[] = checkpoint.segments.map(segment => {
    const member = members.get(segment.memberId);
    const a = positions.get(segment.a), b = positions.get(segment.b);
    const ta = member && a ? spanParameter(member, a) : null;
    const tb = member && b ? spanParameter(member, b) : null;
    const cableCompression = member?.family === 'cable' && segment.axial !== undefined && Number.isFinite(segment.axial) && segment.axial < -forceTolerance;
    const valid = segment.valid !== false && member?.phase === 'committed' && memberCounts.get(segment.memberId) === 1
      && segmentCounts.get(segment.id) === 1 && ta !== null && tb !== null && Math.abs(ta - tb) > pointTolerance
      && Number.isFinite(segment.magnitude) && segment.magnitude >= 0 && !cableCompression;
    if (valid && ta !== null && tb !== null) {
      const ranges = intervals.get(segment.memberId) ?? [];
      ranges.push({ start: Math.min(ta, tb), end: Math.max(ta, tb) }); intervals.set(segment.memberId, ranges);
    }
    if (!valid && member) incompleteMembers.add(member.id);
    return { ...segment, valid };
  });
  const overlappingMembers = new Set<string>();
  for (const [memberId, ranges] of intervals) {
    ranges.sort((a, b) => a.start - b.start);
    let coveredEnd = -Infinity;
    for (const range of ranges) {
      if (range.start < coveredEnd - pointTolerance) overlappingMembers.add(memberId);
      coveredEnd = Math.max(coveredEnd, range.end);
    }
  }
  if (overlappingMembers.size > 0) {
    normalized.forEach((segment, index) => {
      if (!overlappingMembers.has(segment.memberId)) return;
      normalized[index] = { ...segment, valid: false };
      incompleteMembers.add(segment.memberId);
    });
  }
  const usedIds = new Set(normalized.map(segment => segment.id));
  const addMissing = (member: MemberView, a: string, b: string, index: number): void => {
    let id = `missing:${member.id}:${index}`;
    while (usedIds.has(id)) id += ':';
    usedIds.add(id);
    normalized.push({ id, memberId: member.id, a, b, magnitude: 0, valid: false });
  };
  for (const member of data.members) {
    if (member.phase !== 'committed') continue;
    let covered = 0;
    for (const { start, end } of intervals.get(member.id) ?? []) {
      if (start > covered + pointTolerance) break;
      covered = Math.max(covered, end);
    }
    if (covered >= 1 - pointTolerance && !incompleteMembers.has(member.id)) continue;
    addMissing(member, member.startNode, member.endNode, 0);
    // Touch every supplied subsegment as well, so an isolated middle interval
    // cannot appear verified while its unknown end spans are silently discarded.
    let index = 1;
    for (const segment of checkpoint.segments) {
      if (segment.memberId === member.id) addMissing(member, segment.a, segment.b, index++);
    }
  }
  return buildPrimaryFlow({
    modelRevision: data.revision, checkpoint, segments: normalized,
    sources: checkpoint.sources, supports: checkpoint.supports, forceTolerance,
  });
}
