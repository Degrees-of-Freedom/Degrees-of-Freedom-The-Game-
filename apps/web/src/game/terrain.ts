import { type Level, type GridPoint } from './model';
export function terrainCell(
  level: Level,
  i: number,
  j: number,
): { h: number; water: boolean } | null {
  if (i < 0 || j < 0 || i >= level.nx || j >= level.ny) return null;
  const lake = (level.lakes ?? []).some(
    ([a, b, c, d]) => i >= a && i <= b && j >= c && j <= d,
  );
  if (level.type !== 'bridge') return { h: 0, water: lake };
  return {
    h: i < level.cliffL! || i >= level.cliffR! ? level.cliffH! : 0,
    water: lake || (i >= level.water![0] && i <= level.water![1]),
  };
}
export function groundK(level: Level, i: number, j: number): number {
  return Math.max(
    ...[-1, 0].flatMap((di) =>
      [-1, 0].map((dj) => terrainCell(level, i + di, j + dj)?.h ?? -99),
    ),
  );
}
export function nodeValid(level: Level, [i, j, k]: GridPoint): boolean {
  return (
    [i, j, k].every(Number.isInteger) &&
    i >= 0 &&
    j >= 0 &&
    k >= 0 &&
    i <= level.nx &&
    j <= level.ny &&
    k <= level.nz &&
    k >= groundK(level, i, j)
  );
}
export function canFound(level: Level, [i, j, k]: GridPoint): boolean {
  return (
    nodeValid(level, [i, j, k]) &&
    k === groundK(level, i, j) &&
    [-1, 0].some((di) =>
      [-1, 0].some((dj) => {
        const c = terrainCell(level, i + di, j + dj);
        return !!c && c.h === k && !c.water;
      }),
    )
  );
}
export function groundAtPoint(level: Level, x: number, y: number): number {
  const coords = (v: number) =>
    Math.abs(v - Math.round(v)) < 1e-6
      ? [Math.round(v) - 1, Math.round(v)]
      : [Math.floor(v)];
  const heights = coords(x).flatMap((i) =>
    coords(y)
      .map((j) => terrainCell(level, i, j)?.h)
      .filter((h): h is number => h !== undefined),
  );
  return heights.length ? Math.min(...heights) : 0;
}
