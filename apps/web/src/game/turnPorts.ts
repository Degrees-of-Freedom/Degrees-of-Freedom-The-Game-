import { nodeKey, parseNodeKey, type GridPoint, type Member } from "./model";
import type { TurnState } from "./turns";

export type Quarter = 1 | 2 | 3;
export interface QuarterPort {
  id: string;
  memberId: number;
  quarter: Quarter;
  point: GridPoint;
  available: boolean;
}

const quarters = [1, 2, 3] as const;

/** Collect committed and newly activated interfaces for rules and analysis. */
export function turnJoints(state: TurnState): TurnState["board"]["joints"] {
  const joints = new Map(state.board.joints.map((joint) => [joint.id, joint]));
  const members = [...state.board.members, ...state.draft.members];
  for (const { jointId } of state.draft.connections) {
    if (joints.has(jointId)) continue;
    const port = findPort(members, jointId);
    joints.set(jointId, port ? { id: jointId, point: nodeKey(...port.point) } : { id: jointId });
  }
  return [...joints.values()];
}

/** A port always belongs to the dealt parent, never to one of its analytical pieces. */
export function originalPorts(member: Member): QuarterPort[] {
  const a = parseNodeKey(member.a), b = parseNodeKey(member.b);
  return quarters.map((quarter) => {
    const at = (i: number) => a[i] + (b[i] - a[i]) * quarter / 4;
    return {
      id: `port:${member.id}:${quarter}`, memberId: member.id, quarter,
      point: [at(0), at(1), at(2)],
      available: member.type !== "cable" || (member.restLengthM ?? 0) > 0,
    };
  });
}

export function findPort(members: readonly Member[], target: string): QuarterPort | undefined {
  const match = /^port:([1-9]\d*):([123])$/.exec(target);
  if (!match) return undefined;
  const parent = members.find(member => member.id === Number(match[1]));
  return parent && originalPorts(parent)[Number(match[2]) - 1];
}

/** A neutral-only fitting, anchor or original port on a prop can be
 * inspected. A separate player joint at the same coordinates keeps its ID. */
export function systemTarget(state: TurnState, id: string) {
  if (state.board.joints.some(j => j.id === id && j.system)) return true;
  const port = findPort(state.board.members, id);
  return !!port && state.board.members.some(m => m.id === port.memberId && m.system);
}

export function targetCoordinate(members: readonly Member[], target: string): string {
  const port = findPort(members, target);
  return port ? nodeKey(...port.point) : target;
}

export function portLabel(port: QuarterPort) {
  return `Member ${port.memberId} · ${port.quarter * 25}% · (${port.point.join(", ")})`;
}

/** Several independent parents can occupy the same point in space. Keep their
 * target identities distinct and put the original selection first. */
export function connectionLocations(
  members: readonly Member[], member: Member & { endTargets?: Partial<Record<"a" | "b", string>> }, end: "a" | "b",
) {
  const targets = new Set<string>();
  const preferred = member.endTargets?.[end];
  if (preferred) targets.add(preferred);
  if (parseNodeKey(member[end]).every(Number.isInteger)) targets.add(member[end]);
  for (const parent of members) {
    if (parent.id === member.id) continue;
    for (const port of originalPorts(parent)) {
      if (port.available && nodeKey(...port.point) === member[end]) targets.add(port.id);
    }
  }
  return [...targets];
}
