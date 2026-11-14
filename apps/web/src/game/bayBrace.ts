import { nodeKey, parseNodeKey, type GameModel, type GridPoint } from './model';

/** A completed four-edge bay panel can be braced even when the neighboring bay is incomplete. */
export function bayBraceCandidates(model: GameModel, size: GridPoint): [GridPoint, GridPoint][] {
  const edgeKey = (a: string, b: string) => a < b ? a + ':' + b : b + ':' + a;
  const edges = new Set(model.members.map(({ a, b }) => edgeKey(a, b)));
  const corners = new Set(model.members.flatMap(({ a, b }) => [a, b]));
  const candidates: [GridPoint, GridPoint][] = [];
  for (const key of corners) {
    const a = parseNodeKey(key);
    for (const [first, second] of [[0, 1], [0, 2], [1, 2]]) {
      const b: GridPoint = [...a], c: GridPoint = [...a], d: GridPoint = [...a];
      b[first] += size[first];
      c[second] += size[second];
      d[first] += size[first];
      d[second] += size[second];
      const bk = nodeKey(...b), ck = nodeKey(...c), dk = nodeKey(...d);
      if (!edges.has(edgeKey(key, bk)) || !edges.has(edgeKey(key, ck)) ||
          !edges.has(edgeKey(bk, dk)) || !edges.has(edgeKey(ck, dk))) continue;
      if (!edges.has(edgeKey(key, dk))) candidates.push([a, d]);
      if (!edges.has(edgeKey(bk, ck))) candidates.push([b, c]);
    }
  }
  return candidates;
}
