import { CANTILEVER_CATALOGUE } from "./cardCatalogue";
import { attachmentQuarter, type AttachmentSite, type InteriorContact } from "./attachmentSites";
import { nodeKey, parseNodeKey, type GridPoint } from "./model";
import { originalPorts, portLabel, systemTarget, targetCoordinate } from "./turnPorts";
import { activeTurnHand, boardLimits, stageElement, type TurnState } from "./turns";

export type PlacementPlane = "horizontal" | "xz" | "yz";
export interface ElementPlacementState {
  turn: TurnState | null;
  selectedCardId: string | null;
  chainStart: string | null;
  attachmentSite: AttachmentSite;
  placementPlane: PlacementPlane;
}
export interface ElementPlacement {
  a: string;
  b: string;
  contact?: InteriorContact;
}
export interface PlacementCandidate extends ElementPlacement {
  point: GridPoint;
  key: string;
}

/** Existing intentional interfaces, never a geometrically inferred connection. */
export function placementAnchorTargets(turn: TurnState): {id: string; point: GridPoint; label: string}[] {
  const targets = new Map<string, {id: string; point: GridPoint; label: string}>();
  for (const joint of turn.board.joints) {
    if (joint.system || systemTarget(turn, joint.id)) continue;
    const point = parseNodeKey(joint.point ?? targetCoordinate(turn.board.members, joint.id));
    if (!point.every(Number.isFinite)) continue;
    targets.set(joint.id, {id: joint.id, point, label: `Joint (${point.join(", ")})${joint.foundationOwner ? " · foundation" : ""}`});
  }
  for (const member of turn.board.members) {
    if (member.system) continue;
    for (const port of originalPorts(member)) {
      if (port.available && !systemTarget(turn, port.id))
        targets.set(port.id, {id: port.id, point: port.point, label: portLabel(port)});
    }
  }
  return [...targets.values()];
}

/** Derive both tips from a pinned original interface. The picked tip is B,
 * except when End B is pinned, in which case the user chooses tip A. */
export function placementFromTip(state: ElementPlacementState, tip: GridPoint, target?: string): ElementPlacement | {issue: string} {
  const turn = state.turn;
  const card = turn && activeTurnHand(turn).find(c => c.id === state.selectedCardId);
  if (!turn || card?.kind !== "element" || !state.chainStart) return {issue: "Choose an element and its start point."};
  if (!tip.every(Number.isFinite)) return {issue: "Choose a finite tip position."};
  const origin = parseNodeKey(targetCoordinate(turn.board.members, state.chainStart));
  const quarter = attachmentQuarter(state.attachmentSite);
  let placement: ElementPlacement;
  if (quarter === 0) placement = {a: state.chainStart, b: target ?? nodeKey(...tip)};
  else if (quarter === 4) placement = {a: target ?? nodeKey(...tip), b: state.chainStart};
  else {
    if (turn.catalogue !== CANTILEVER_CATALOGUE || card.type === "cable" || card.type === "spring" || card.assembly)
      return {issue: "Interior support is available for frame beams in new Shared table matches."};
    if (!placementAnchorTargets(turn).some(anchor => anchor.id === state.chainStart))
      return {issue: "Choose an existing joint or original quarter port for the support."};
    const q = quarter / 4;
    const start = origin.map((value, axis) => (value - q * tip[axis]) / (1 - q)) as GridPoint;
    // Rational station arithmetic must not nudge the pin or round an off-grid tip.
    // Canonicalize only numerical noise at an already integral grid coordinate.
    const exact = start.map(value => Math.abs(value - Math.round(value)) < 1e-10 ? Math.round(value) : value) as GridPoint;
    let a = nodeKey(...exact);
    if (!exact.every(Number.isInteger)) {
      const ports = turn.board.members.filter(member => !member.system).flatMap(originalPorts)
        .filter(port => port.available && nodeKey(...port.point) === a && !systemTarget(turn, port.id));
      if (!ports.length) return {issue: "Both tips must land on the grid or original ports. Choose another reach or attachment point."};
      if (ports.length > 1) return {issue: "The other tip meets several original ports. Choose both port identities in Precise placement."};
      a = ports[0].id;
    }
    placement = {a, b: target ?? nodeKey(...tip), contact: {quarter, target: state.chainStart}};
  }
  const result = stageElement(turn, card.id, placement.a, placement.b, placement.contact);
  return result.ok ? placement : {issue: result.reason};
}

let cache: {turn: TurnState; card: string | null; anchor: string; site: AttachmentSite; plane: PlacementPlane; candidates: PlacementCandidate[]} | undefined;

/** A bounded plane of exact candidates, validated by the same rules as a play. */
export function placementCandidates(state: ElementPlacementState): PlacementCandidate[] {
  if (!state.turn || !state.chainStart) return [];
  if (cache && cache.turn === state.turn && cache.card === state.selectedCardId && cache.anchor === state.chainStart &&
      cache.site === state.attachmentSite && cache.plane === state.placementPlane) return cache.candidates;
  const turn = state.turn;
  const anchor = parseNodeKey(targetCoordinate(turn.board.members, state.chainStart));
  const bounds = boardLimits(turn);
  const fixedAxis = state.placementPlane === "xz" ? 1 : state.placementPlane === "yz" ? 0 : 2;
  const candidates: PlacementCandidate[] = [];
  function add(point: GridPoint, target?: string) {
    if (Math.abs(point[fixedAxis] - anchor[fixedAxis]) > 1e-10) return;
    const placement = placementFromTip(state, point, target);
    if (!("issue" in placement)) candidates.push({...placement, point, key: target ?? nodeKey(...point)});
  }
  // Iterate a single slice rather than the entire 3D board on every hover.
  const axes = [0, 1, 2].filter(axis => axis !== fixedAxis);
  for (let u = 0; u <= bounds[axes[0]]; u++) for (let v = 0; v <= bounds[axes[1]]; v++) {
    const point = [...anchor] as GridPoint;
    point[axes[0]] = u; point[axes[1]] = v;
    if (point.every(Number.isInteger)) add(point);
  }
  for (const member of turn.board.members) if (!member.system) {
    for (const port of originalPorts(member)) if (port.available) add(port.point, port.id);
  }
  cache = {turn, card: state.selectedCardId, anchor: state.chainStart, site: state.attachmentSite, plane: state.placementPlane, candidates};
  return candidates;
}
