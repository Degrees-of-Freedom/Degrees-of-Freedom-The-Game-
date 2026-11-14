import { nodeKey, type GameModel, type Level } from './model';
function randomLoads(
  level: Level,
  random: () => number = Math.random,
): [number, number, number, number][] {
  const count = 3 + Math.floor(random() * 3),
    loads: [number, number, number, number][] = [];
  for (let tries = 0; loads.length < count && tries < 500; tries++) {
    const i = 2 + Math.floor(random() * (level.nx - 3)),
      j = 2 + Math.floor(random() * (level.ny - 3)),
      k = 2 + Math.floor(random() * 5);
    if (
      loads.some(
        ([a, b, c]) =>
          Math.max(Math.abs(a - i), Math.abs(b - j), Math.abs(c - k)) < 3,
      )
    )
      continue;
    loads.push([i, j, k, 20 + 10 * Math.floor(random() * 5)]);
  }
  return loads;
}
export function initialModel(level: Level): GameModel {
  const model: GameModel = { members: [], attrs: {}, nextId: 1 };
  if (level.type === 'bridge')
    for (const y of level.ys!)
      for (const x of [level.cliffL!, level.cliffR!])
        model.attrs[nodeKey(x, y, level.cliffH!)] = {
          found: true,
          locked: true,
        };
  if (level.type === 'pickup')
    for (const [i, j, k, f] of level.random
      ? randomLoads(level)
      : (level.loads ?? []))
      model.attrs[nodeKey(i, j, k)] = { load: f, locked: true, target: true };
  return model;
}
