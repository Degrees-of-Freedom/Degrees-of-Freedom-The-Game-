import type { GridPoint } from "../game/model";
import type { KeepOutZone } from "./types";

/** Samples per member when testing it against a zone (grid units are metres / 2). */
const SEGMENT_SAMPLES = 40;

export function pointInZone(zone: KeepOutZone, p: readonly number[]): boolean {
  return p.every((v, i) => v >= zone.min[i] - 1e-9 && v <= zone.max[i] + 1e-9);
}

/** The zone a lattice node lies in, if any. */
export function nodeZone(zones: readonly KeepOutZone[], p: GridPoint): KeepOutZone | undefined {
  return zones.find((z) => pointInZone(z, p));
}

/** The first zone the straight member from `a` to `b` passes through, if any. */
export function memberZone(
  zones: readonly KeepOutZone[],
  a: GridPoint,
  b: GridPoint,
): KeepOutZone | undefined {
  if (!zones.length) return undefined;
  for (let n = 0; n <= SEGMENT_SAMPLES; n++) {
    const t = n / SEGMENT_SAMPLES;
    const p = [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t);
    const hit = zones.find((z) => pointInZone(z, p));
    if (hit) return hit;
  }
  return undefined;
}
