import { nodeKey, parseNodeKey, type GameModel, type GridPoint } from "./model";

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
