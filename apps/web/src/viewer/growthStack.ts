/**
 * Choosing among growth targets that project onto almost the same pixel.
 *
 * Pure logic, no three.js or store access, so it can be unit tested.
 */

export interface StackCandidate<T> {
  item: T;
  /** Screen position in pixels. */
  sx: number;
  sy: number;
  /** Normalised device depth; smaller is nearer the camera. */
  depth: number;
  /** Distance from the pointer in pixels. */
  dist: number;
}

/** Pointer reach for any target, as before. */
export const REACH_PX = 12;
/** Targets this close (on screen) to the nearest one form a stack. */
export const STACK_PX = 3.5;

/**
 * Targets within `reach` of the pointer, reduced to the stack around the one
 * nearest the pointer: every candidate within `stackPx` of it on screen,
 * ordered from the nearest to the farthest from the camera. Empty when
 * nothing is within reach. Ties in depth keep the pointer-closer one first.
 */
export function buildStack<T>(
  candidates: StackCandidate<T>[],
  reach = REACH_PX,
  stackPx = STACK_PX,
): StackCandidate<T>[] {
  let nearest: StackCandidate<T> | null = null;
  for (const c of candidates)
    if (c.dist < reach && (!nearest || c.dist < nearest.dist)) nearest = c;
  if (!nearest) return [];
  const anchor = nearest;
  return candidates
    .filter((c) => Math.hypot(c.sx - anchor.sx, c.sy - anchor.sy) <= stackPx)
    .sort((a, b) => a.depth - b.depth || a.dist - b.dist);
}

/** Step through a stack, wrapping at both ends. */
export function stepIndex(index: number, count: number, delta: number): number {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}

/**
 * Remembers which entry of the current stack the player chose. The choice is
 * dropped when the pointer reaches a different stack, the start point changes,
 * or growing is cancelled (`reset`).
 */
export function createStackSelector() {
  let identity = "";
  let index = 0;
  let count = 0;
  return {
    /** Register the stack under the pointer; returns the chosen index. */
    choose(keys: string[], start: string | null): number {
      const next = `${start ?? ""}|${[...keys].sort().join(";")}`;
      if (next !== identity) {
        identity = next;
        index = 0;
      }
      count = keys.length;
      return index;
    },
    step(delta: number): number {
      index = stepIndex(index, count, delta);
      return index;
    },
    /** Number of overlapping targets under the pointer (0 when idle). */
    get size() {
      return count;
    },
    get index() {
      return index;
    },
    reset() {
      identity = "";
      index = 0;
      count = 0;
    },
  };
}
