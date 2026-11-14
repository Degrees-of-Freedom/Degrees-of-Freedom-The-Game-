import { nodeKey, parseNodeKey, type GameModel, type GridPoint, type Level } from "./model";
import { memberIssue } from "./placementRules";

export type BayFace = {
  corners: [GridPoint, GridPoint, GridPoint, GridPoint];
  normalAxis: number;
};
export function bayFaces(model: GameModel, size: GridPoint): BayFace[] {
  const edgeKey = (a: string, b: string) => (a < b ? a + ":" + b : b + ":" + a);
  const edges = new Set(model.members.map(({ a, b }) => edgeKey(a, b)));
  const corners = new Set(model.members.flatMap(({ a, b }) => [a, b]));
  const faces: BayFace[] = [];
  for (const key of corners) {
    const a = parseNodeKey(key);
    for (const [first, second] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      const b: GridPoint = [...a],
        c: GridPoint = [...a],
        d: GridPoint = [...a];
      b[first] += size[first];
      c[second] += size[second];
      d[first] += size[first];
      d[second] += size[second];
      const bk = nodeKey(...b),
        ck = nodeKey(...c),
        dk = nodeKey(...d);
      if (
        !edges.has(edgeKey(key, bk)) ||
        !edges.has(edgeKey(key, ck)) ||
        !edges.has(edgeKey(bk, dk)) ||
        !edges.has(edgeKey(ck, dk))
      )
        continue;
      faces.push({ corners: [a, b, c, d], normalAxis: 3 - first - second });
    }
  }
  return faces;
}

/** A completed four-edge bay panel can be braced even when the neighboring bay is incomplete. */
export function bayBraceCandidates(
  model: GameModel,
  size: GridPoint,
): [GridPoint, GridPoint][] {
  const candidates = bayFaces(model, size).flatMap(
    ({ corners: [a, b, c, d] }): [GridPoint, GridPoint][] => [
      [a, d],
      [b, c],
    ],
  );
  return candidates.filter(([a, b]) => {
    const ak = nodeKey(...a),
      bk = nodeKey(...b);
    return !model.members.some(
      (member) =>
        (member.a === ak && member.b === bk) ||
        (member.a === bk && member.b === ak),
    );
  });
}

/** Cycle a panel's two diagonals while leaving its edges and other panels alone. */
export function cycleBayBrace(level: Level, model: GameModel, face: BayFace):
  { ok: true; model: GameModel } | { ok: false; reason: string } {
  const [a, b, c, d] = face.corners;
  const diagonals: [GridPoint, GridPoint][] = [[a, d], [b, c]];
  const present = diagonals.map(([from, to]) => {
    const start = nodeKey(...from), end = nodeKey(...to);
    return model.members.find((m) => m.a === start && m.b === end || m.a === end && m.b === start);
  });
  const remove = present[0] && present[1] ? present : present[0] ? [present[0]] : [];
  const add = present[0] && present[1] ? null : diagonals[present[0] ? 1 : 0];
  const removedIds = new Set(remove.map((member) => member?.id));
  const members = model.members.filter(({ id }) => !removedIds.has(id));
  let nextId = model.nextId;
  if (add) {
    const [from, to] = add;
    const issue = memberIssue(level, { ...model, members }, from, to, "shs");
    if (issue) return { ok: false, reason: issue };
    members.push({ id: nextId++, a: nodeKey(...from), b: nodeKey(...to), type: "shs" });
  }
  return { ok: true, model: { ...model, members, nextId } };
}
