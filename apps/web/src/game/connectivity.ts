import { allNodeKeys, CELL_SIZE, parseNodeKey, type GameModel } from "./model";
import { turnJoints, type TurnState } from "./turns";

export interface ConnectivityReport {
  groundedMembers: Set<number>;
  unsupportedMembers: number[];
  unsupportedNodes: string[];
  memberCount: number;
  lengthMetres: number;
  totalLoadKilonewtons: number;
}

function reachable(
  edges: Map<string, string[]>,
  supports: string[],
): Set<string> {
  const reached = new Set(supports);
  const queue = [...reached];
  for (let i = 0; i < queue.length; i++) {
    for (const next of edges.get(queue[i]) ?? []) {
      if (reached.has(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  return reached;
}

/** Count topological paths only. Connection laws, loading and stability need separate analysis. */
export function analyzeConnectivity(
  model: GameModel,
  turn?: TurnState | null,
): ConnectivityReport {
  const edges = new Map<string, string[]>();
  function link(a: string, b: string) {
    edges.set(a, [...(edges.get(a) ?? []), b]);
    edges.set(b, [...(edges.get(b) ?? []), a]);
  }
  const memberEnd = (id: number, end: "a" | "b") => `member-${id}-${end}`;
  const nodes = turn
    ? turnJoints(turn).map(({ id }) => id)
    : allNodeKeys(model);
  for (const member of model.members) {
    link(
      turn ? memberEnd(member.id, "a") : member.a,
      turn ? memberEnd(member.id, "b") : member.b,
    );
  }
  if (turn) {
    for (const connection of [
      ...turn.board.connections,
      ...turn.draft.connections,
    ]) {
      link(memberEnd(connection.memberId, connection.end), connection.jointId);
    }
  }
  const supports = turn
    ? turn.board.joints
        .filter(({ foundationOwner }) => foundationOwner)
        .map(({ id }) => id)
    : Object.keys(model.attrs).filter((key) => model.attrs[key].found);
  const reached = reachable(edges, supports);
  const groundedMembers = new Set<number>();
  const unsupportedMembers: number[] = [];
  let lengthMetres = 0;
  for (const member of model.members) {
    const a = parseNodeKey(member.a),
      b = parseNodeKey(member.b);
    lengthMetres +=
      CELL_SIZE * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    if (reached.has(turn ? memberEnd(member.id, "a") : member.a))
      groundedMembers.add(member.id);
    else unsupportedMembers.push(member.id);
  }
  return {
    groundedMembers,
    unsupportedMembers,
    unsupportedNodes: nodes.filter((key) => !reached.has(key)),
    memberCount: model.members.length,
    lengthMetres,
    totalLoadKilonewtons: Object.values(model.attrs).reduce(
      (sum, { load }) => sum + Math.abs(load ?? 0),
      0,
    ),
  };
}
