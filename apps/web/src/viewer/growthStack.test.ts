import { describe, expect, it } from "vitest";
import {
  buildStack,
  createStackSelector,
  stepIndex,
  type StackCandidate,
} from "./growthStack";

const c = (
  item: string,
  sx: number,
  sy: number,
  depth: number,
  at = { x: 100, y: 100 },
): StackCandidate<string> => ({
  item,
  sx,
  sy,
  depth,
  dist: Math.hypot(sx - at.x, sy - at.y),
});

describe("growth target stacks", () => {
  it("is empty when nothing is within reach", () => {
    expect(buildStack([c("a", 130, 100, 0.5)])).toEqual([]);
  });

  it("orders a stack front to back and keeps only targets within 3.5 px of the nearest", () => {
    const stack = buildStack([
      c("far", 101, 100, 0.9),
      c("near", 100, 101, 0.2),
      c("mid", 102, 100, 0.5),
      c("apart", 108, 100, 0.1), // 8 px away: a different stack
    ]);
    expect(stack.map((s) => s.item)).toEqual(["near", "mid", "far"]);
  });

  it("prefers the camera-nearest target even when another is closer to the pointer", () => {
    const stack = buildStack([c("pointer-closest", 100, 100, 0.8), c("front", 102, 100, 0.1)]);
    expect(stack[0].item).toBe("front");
  });

  it("wraps when stepping", () => {
    expect(stepIndex(0, 3, 1)).toBe(1);
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
    expect(stepIndex(0, 0, 1)).toBe(0);
  });

  it("keeps the choice for the same stack and resets for another, a new start or a cancel", () => {
    const selector = createStackSelector();
    expect(selector.choose(["a", "b", "c"], "0,0,0")).toBe(0);
    expect(selector.size).toBe(3);
    expect(selector.step(1)).toBe(1);
    expect(selector.choose(["c", "a", "b"], "0,0,0")).toBe(1);
    expect(selector.choose(["a", "d"], "0,0,0")).toBe(0);
    selector.step(1);
    expect(selector.choose(["a", "d"], "1,0,0")).toBe(0);
    selector.step(1);
    selector.reset();
    expect(selector.size).toBe(0);
    expect(selector.choose(["a", "d"], "1,0,0")).toBe(0);
  });
});
