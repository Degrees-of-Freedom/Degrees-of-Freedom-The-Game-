import { nodeKey, parseNodeKey, type GridPoint, type Member } from "./model";
import type { TurnState } from "./turns";
import { isReleaseCatalogue } from "./cardCatalogue";
import { attachmentId, attachmentPoint, isInteriorSite, type AttachmentSite, type InteriorSite } from "./attachmentSites";

export type Quarter = 1 | 2 | 3;
export interface QuarterPort {
  id: string;
  memberId: number;
  quarter: Quarter;
  point: GridPoint;
  available: boolean;
}

const quarters = [1, 2, 3] as const;

/** Loads remember the physical tip they were played on. Attaching that tip later
 * moves its force to the shared analytical node without rewriting its history. */
export function analysisLoadJoint(state: TurnState, target: string): string {
  const aliases = new Map([...state.board.connections, ...state.draft.connections]
    .map(c => [attachmentId(c.memberId, c.end), c.jointId]));
  const visited = new Set<string>();
  // Connections follow declared identity, never coordinate coincidence. New
  // collars can target a quarter that itself aliases an older receiving joint.
  while (aliases.has(target) && !visited.has(target)) {
    visited.add(target);
    target = aliases.get(target)!;
  }
  return target;
}

/** Authoritative targets in the active private draft. A loose tip carries its
 * own identity even when other unattached tips occupy the same coordinates. */
export function loadTargets(state: TurnState): {id: string; point: string; label: string}[] {
  if (!isReleaseCatalogue(state.catalogue)) return turnJoints(state)
    .filter(j => !systemTarget(state, j.id)).map(j => ({id: j.id, point: j.point ?? j.id, label: j.id}));
  const members = [...state.board.members, ...state.draft.members];
  const excluded = new Set(state.board.joints.filter(j => j.foundationOwner || j.system).map(j => j.id));
  for (const setup of state.board.members.filter(m => !m.cardId && !m.system)) {
    excluded.add(setup.a);
    excluded.add(setup.b);
  }
  const targets: {id:string; point:string; label:string}[] = [];
  for (const member of members) {
    if (!member.cardId || member.system) continue;
    const add = (id: string, point: string, station: string) => {
      if (parseNodeKey(point)[2] <= 0 || excluded.has(analysisLoadJoint(state, id))) return;
      targets.push({id, point, label: `Member ${member.id} · ${station} · (${point})`});
    };
    add(`endpoint:${member.id}:a`, member.a, "end A");
    for (const port of originalPorts(member)) if (port.available) add(port.id, nodeKey(...port.point), port.quarter * 25 + "%");
    add(`endpoint:${member.id}:b`, member.b, "end B");
  }
  return targets;
}

/** Collect committed and newly activated interfaces for rules and analysis. */
export function turnJoints(state: TurnState): TurnState["board"]["joints"] {
  const joints = new Map(state.board.joints.map((joint) => [joint.id, joint]));
  const members = [...state.board.members, ...state.draft.members];
  for (const { jointId } of state.draft.connections) {
    if (joints.has(jointId)) continue;
    const port = findPort(members, jointId);
    joints.set(jointId, port ? { id: jointId, point: nodeKey(...port.point) } : { id: jointId });
  }
  for (const connection of [...state.board.connections, ...state.draft.connections]) {
    if (!isInteriorSite(connection.end)) continue;
    const member = members.find(m => m.id === connection.memberId);
    if (!member) continue;
    const id = attachmentId(member.id, connection.end);
    // Preserve the source's physical identity alongside the canonical target.
    // Analysis decides how an explicitly fixed collar aliases these DOFs.
    joints.set(id, {id, point:attachmentPoint(member, connection.end)});
  }
  if (isReleaseCatalogue(state.catalogue)) {
    // Rebuild activated load-only tips every time: when a later connector is
    // fitted the old loose analytical node no longer exists.
    for (const id of joints.keys()) if (id.startsWith("endpoint:")) joints.delete(id);
    for (const load of [...state.board.loads, ...state.draft.loads]) {
      const id = analysisLoadJoint(state, load.jointId);
      if (joints.has(id)) continue;
      const port = findPort(members, id);
      const tip = /^endpoint:([1-9]\d*):(a|b)$/.exec(id);
      const member = tip && members.find(m => m.id === Number(tip[1]));
      if (port) joints.set(id, {id, point: nodeKey(...port.point)});
      else if (tip && member) joints.set(id, {id, point: member[tip[2] as "a" | "b"]});
    }
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
  members: readonly Member[], member: Member & { endTargets?: Partial<Record<"a" | "b", string>>;
    interiorTargets?: Partial<Record<InteriorSite, string>> }, end: AttachmentSite,
) {
  if (isInteriorSite(end)) {
    const target = member.interiorTargets?.[end];
    return target ? [target] : [];
  }
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
