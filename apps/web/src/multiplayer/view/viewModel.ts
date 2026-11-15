import type { DraftEdit, MemberView, MultiplayerViewData, QuarterPort, Vec3 } from './types';

export const familyLabel = (family: MemberView['family']): string => ({
  member: 'Axial / bending member', cable: 'Tension-only cable',
  'spring-025': 'Spring · 0.25 k₀', 'spring-05': 'Spring · 0.5 k₀',
})[family];
export const spanLength = (a: Vec3, b: Vec3): number => Math.hypot(...a.map((v, i) => b[i] - v));
export const formatPoint = (p: Vec3): string => p.map(v => Number(v.toFixed(3))).join(', ');
export const canEditMember = (m: MemberView): boolean => m.phase === 'draft' && !m.setupLocked;

export function quarterPorts(id: string, start: Vec3, end: Vec3): readonly QuarterPort[] {
  return ([0.25, 0.5, 0.75] as const).map(fraction => ({
    id: `${id}@${fraction}`, parentId: id, fraction,
    position: start.map((v, i) => v + (end[i] - v) * fraction) as [number, number, number],
  }));
}

/** Coarse UI guard only. Session 1 remains the authority for card/clash/attachment rules. */
export function draftEditIssue(member: MemberView, edit: DraftEdit, board: MultiplayerViewData['board']): string | null {
  if (!canEditMember(member)) return 'Committed and setup properties are read-only.';
  if (edit.end.some(v => !Number.isFinite(v))) return 'Enter three finite coordinates.';
  if (edit.end.some((v, i) => v < 0 || v > [board.width, board.depth, board.height][i])) return 'Endpoint is outside the published board bounds.';
  const length = spanLength(member.start, edit.end);
  if (length <= 1e-8) return 'A member must have a positive span.';
  if (length > member.maxLength + 1e-8) return `The printed maximum is ${member.maxLength} game units.`;
  return null;
}

export function freshness(data: MultiplayerViewData): string {
  const checkpoint = data.checkpoint;
  if (!checkpoint) return 'Current structure not yet analyzed.';
  if (checkpoint.modelRevision !== data.revision) return `Last analyzed at turn ${checkpoint.turn} — current structure not yet analyzed.`;
  if (!checkpoint.valid) return `Checkpoint ${checkpoint.turn}: results unavailable or unresolved.`;
  return `Checkpoint turn ${checkpoint.turn} · ${checkpoint.provenance}`;
}
